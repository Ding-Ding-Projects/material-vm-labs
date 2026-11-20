'use strict';
// Pure helpers for the local Ollama manager: request validation for the main-process boundary,
// NDJSON stream splitting, and the conservative hardware-fit verdict. No network, no Electron, so
// tests/system-suites.test.mjs can exercise every rule here directly.

const BASE = Object.freeze({ host: '127.0.0.1', port: 11434 });
const DOWNLOAD_PAGE = 'https://ollama.com/download';
const LIMITS = Object.freeze({
  messages: 200, content: 100000, images: 4, imageB64: 20 * 1024 * 1024, system: 20000,
  response: 8 * 1024 * 1024, line: 1024 * 1024,
});

// Ollama model references look like "llama3.2", "llama3.2:3b", "library/qwen3:8b-q4_K_M" or
// "hf.co/owner/repo:Q4_K_M". Anything else (spaces, "..", leading slash, control characters) is refused.
function validModel(name) {
  if (typeof name !== 'string') return false;
  if (name.length < 1 || name.length > 200) return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9._\-/:]*$/.test(name)) return false;
  if (name.includes('..') || name.includes('//') || name.endsWith('/') || name.endsWith(':')) return false;
  return (name.match(/:/g) || []).length <= 1;
}

const OPTION_RULES = {
  temperature: { min: 0, max: 2, int: false },
  top_p: { min: 0, max: 1, int: false },
  top_k: { min: 1, max: 1000, int: true },
  num_ctx: { min: 256, max: 1048576, int: true },
  num_predict: { min: -2, max: 1000000, int: true },
  repeat_penalty: { min: 0, max: 5, int: false },
  seed: { min: -2147483648, max: 2147483647, int: true },
};

function cleanOptions(opts) {
  const out = {};
  if (opts == null) return out;
  if (typeof opts !== 'object' || Array.isArray(opts)) throw new Error('Model options must be an object.');
  for (const [k, v] of Object.entries(opts)) {
    const r = OPTION_RULES[k];
    if (!r) throw new Error(`Unknown model option "${k}".`);
    if (v === '' || v == null) continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < r.min || n > r.max || (r.int && !Number.isInteger(n))) throw new Error(`Option ${k} must be ${r.int ? 'a whole number' : 'a number'} from ${r.min} to ${r.max}.`);
    out[k] = n;
  }
  return out;
}

function validateChat(req) {
  if (!req || typeof req !== 'object') throw new Error('A chat request is required.');
  if (!validModel(req.model)) throw new Error('Pick an installed model first.');
  if (!Array.isArray(req.messages) || !req.messages.length) throw new Error('A chat needs at least one message.');
  if (req.messages.length > LIMITS.messages) throw new Error(`A chat can send at most ${LIMITS.messages} messages.`);
  const messages = [];
  if (req.system != null && req.system !== '') {
    if (typeof req.system !== 'string' || req.system.length > LIMITS.system) throw new Error(`The system prompt must be text of at most ${LIMITS.system} characters.`);
    messages.push({ role: 'system', content: req.system });
  }
  for (const m of req.messages) {
    if (!m || !['user', 'assistant'].includes(m.role)) throw new Error('Each message must come from the user or the assistant.');
    if (typeof m.content !== 'string' || m.content.length > LIMITS.content) throw new Error(`Each message must be text of at most ${LIMITS.content} characters.`);
    const msg = { role: m.role, content: m.content };
    if (m.images != null) {
      if (!Array.isArray(m.images) || m.images.length > LIMITS.images) throw new Error(`A message can carry at most ${LIMITS.images} images.`);
      for (const im of m.images) if (typeof im !== 'string' || im.length > LIMITS.imageB64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(im)) throw new Error('Each image must be plain base64 under 20 MB.');
      if (m.images.length) msg.images = m.images.slice();
    }
    messages.push(msg);
  }
  return { model: req.model, messages, stream: true, options: cleanOptions(req.options) };
}

// Split a streamed NDJSON body into parsed objects, keeping the unfinished tail.
function makeLineSplitter(onObject) {
  let tail = '';
  return {
    push(chunk) {
      tail += chunk;
      if (tail.length > LIMITS.line && !tail.includes('\n')) throw new Error('A streamed line was larger than 1 MB.');
      const parts = tail.split('\n'); tail = parts.pop();
      for (const p of parts) { const s = p.trim(); if (s) onObject(JSON.parse(s)); }
    },
    end() { const s = tail.trim(); tail = ''; if (s) onObject(JSON.parse(s)); },
  };
}

// "8.0B" -> 8e9, "135M" -> 1.35e8. Returns null when the published value cannot be read.
function parseParamSize(s) {
  const m = /^\s*([0-9]+(?:\.[0-9]+)?)\s*([KMBT])\s*$/i.exec(String(s || ''));
  if (!m) return null;
  return Number(m[1]) * { K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[m[2].toUpperCase()];
}

const GiB = 1024 ** 3;
const fmtGiB = (b) => (b / GiB).toFixed(1) + ' GB';

// Conservative fit: the model's real blob size plus a context overhead, against detected memory.
// Without detected GPU memory the best verdict is "Runs with limits"; missing size gives "Unknown".
// The name of a model is never read.
function fitVerdict(model, sys, settings) {
  const overhead = Math.max(0, Number((settings && settings.contextOverheadBytes) != null ? settings.contextOverheadBytes : GiB));
  const evidence = [];
  const assumptions = [`Context and runtime overhead assumed at ${fmtGiB(overhead)} (change it in settings).`];
  const size = Number(model && model.size);
  const ram = Number(sys && sys.totalRam);
  const vram = Number(sys && sys.vram);
  const at = new Date().toISOString();
  if (!Number.isFinite(size) || size <= 0) return { verdict: 'Unknown', evidence: ['Ollama did not report this model\'s download size.'], assumptions, at };
  evidence.push(`Model files: ${fmtGiB(size)} as reported by Ollama.`);
  const d = (model && model.details) || {};
  if (d.parameter_size) evidence.push(`Parameters: ${d.parameter_size} (published metadata).`);
  if (d.quantization_level) evidence.push(`Quantization: ${d.quantization_level} (published metadata).`);
  if (!Number.isFinite(ram) || ram <= 0) return { verdict: 'Unknown', evidence: evidence.concat('System memory could not be read.'), assumptions, at };
  evidence.push(`System memory: ${fmtGiB(ram)}.`);
  const need = size * 1.2 + overhead;
  evidence.push(`Estimated working memory: ${fmtGiB(need)} (files x 1.2 plus overhead).`);
  if (Number.isFinite(vram) && vram > 0) {
    evidence.push(`GPU memory: ${fmtGiB(vram)}.`);
    if (need <= vram * 0.9) return { verdict: 'Runs well', evidence, assumptions, at };
    if (need <= vram + ram * 0.5) return { verdict: 'Runs with limits', evidence: evidence.concat('Part of the model would run from system memory, which is slower.'), assumptions, at };
  } else {
    evidence.push('GPU memory was not detected, so this verdict assumes the model runs from system memory.');
  }
  if (need <= ram * 0.75) return { verdict: 'Runs with limits', evidence, assumptions, at };
  return { verdict: 'Unlikely', evidence: evidence.concat('The estimate exceeds three quarters of system memory.'), assumptions, at };
}

module.exports = { BASE, DOWNLOAD_PAGE, LIMITS, validModel, cleanOptions, validateChat, makeLineSplitter, parseParamSize, fitVerdict };
