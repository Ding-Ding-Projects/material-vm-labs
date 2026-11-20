'use strict';
// Regex core: parsing, plain-English explanation tree, diagnostics, replacement templates, an
// instrumented step tracer, static flavour notes and conversion, code generation and the jobs the
// isolated worker runs (match, replace, split, test cases, trace, benchmark, growth, GREP).
// The JavaScript engine of this runtime is the only engine that is executed. Every other flavour is
// a static note and is labelled that way. Works in the renderer (window.MVLRegex), in the worker
// (self.MVLRegex through importScripts) and in Node (module.exports) for tests.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MVLRegex = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const LIMITS = {
    pattern: 5000, subject: 200000, matches: 5000, replacePieces: 1000, splitParts: 5000,
    traceSubject: 500, traceSteps: 20000, traceLog: 3000, testCases: 200,
    grepFiles: 200, grepFileChars: 5000000, grepTotalChars: 20000000, grepResults: 5000,
    benchPatterns: 3, benchBudgetMs: 1200, growthMaxSize: 1 << 16
  };
  const FLAG_ORDER = 'dgimsuvy';
  const FLAG_INFO = {
    d: 'Generate match indices for every capture group (hasIndices).',
    g: 'Global: find every match instead of only the first.',
    i: 'Ignore case: letters match in either case.',
    m: 'Multiline: ^ and $ also match at line breaks.',
    s: 'Dot all: the dot also matches line breaks.',
    u: 'Unicode: code points, \\u{...} and \\p{...} properties, stricter syntax.',
    v: 'Unicode sets: like u, plus set operations and string properties in classes.',
    y: 'Sticky: a match must start exactly at lastIndex.'
  };
  const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

  function normFlags(f) {
    const set = new Set(String(f || '').split(''));
    if (set.has('u') && set.has('v')) set.delete('u');
    return FLAG_ORDER.split('').filter((c) => set.has(c)).join('');
  }
  function compile(pattern, flags) {
    if (typeof pattern !== 'string') throw new TypeError('The pattern must be text.');
    if (pattern.length > LIMITS.pattern) throw new RangeError('The pattern is longer than ' + LIMITS.pattern + ' characters.');
    return new RegExp(pattern, normFlags(flags));
  }
  function validate(pattern, flags) {
    try { compile(pattern, flags); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
  }
  function engineInfo() {
    let v8 = '';
    try { if (typeof process !== 'undefined' && process.versions && process.versions.v8) v8 = 'V8 ' + process.versions.v8; } catch { /* not in Node */ }
    if (!v8 && typeof navigator !== 'undefined') { const m = /Chrome\/([\d.]+)/.exec(navigator.userAgent || ''); if (m) v8 = 'V8 from Chromium ' + m[1]; }
    const has = (f) => { try { new RegExp('', f); return true; } catch { return false; } };
    const feat = (src, f) => { try { new RegExp(src, f); return true; } catch { return false; } };
    return {
      name: 'JavaScript (ECMAScript RegExp)', version: v8 || 'version not reported by this runtime',
      flags: FLAG_ORDER.split('').filter(has),
      features: {
        lookbehind: feat('(?<=a)b'), namedGroups: feat('(?<n>a)\\k<n>'), unicodeProperties: feat('\\p{L}', 'u'),
        setNotation: feat('[\\p{L}--[a-z]]', 'v'), modifiers: feat('(?i:a)b'), duplicateNames: feat('(?<n>a)|(?<n>b)')
      }
    };
  }

  // ---------- parser ----------
  function countGroups(src) {
    let n = 0, inClass = 0;
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (c === '\\') { i++; continue; }
      if (inClass) { if (c === '[') inClass++; else if (c === ']') inClass--; continue; }
      if (c === '[') { inClass = 1; continue; }
      if (c === '(') { if (src[i + 1] !== '?') n++; else if (src[i + 2] === '<' && src[i + 3] !== '=' && src[i + 3] !== '!') n++; }
    }
    return n;
  }
  function isHex(s) { return /^[0-9a-fA-F]+$/.test(s); }

  function parse(src, flags) {
    flags = normFlags(flags);
    const uni = /[uv]/.test(flags), vmode = flags.includes('v');
    const total = countGroups(src);
    let i = 0, groupNo = 0;
    const names = {};
    const fail = (msg, at) => { const e = new SyntaxError(msg); e.at = at == null ? i : at; throw e; };
    const cp = (at) => (uni ? src.codePointAt(at) : src.charCodeAt(at));
    const cpLen = (at) => (uni && src.codePointAt(at) > 0xffff ? 2 : 1);

    function alt() {
      const start = i; const alts = [seq()];
      while (src[i] === '|') { i++; alts.push(seq()); }
      return alts.length === 1 ? alts[0] : { type: 'alt', start, end: i, alts };
    }
    function seq() {
      const start = i; const items = [];
      while (i < src.length && src[i] !== '|' && src[i] !== ')') items.push(quant(atom()));
      return { type: 'seq', start, end: i, items };
    }
    function quantAt() {
      const c = src[i];
      if (c === '*') return { min: 0, max: Infinity, len: 1 };
      if (c === '+') return { min: 1, max: Infinity, len: 1 };
      if (c === '?') return { min: 0, max: 1, len: 1 };
      if (c === '{') {
        const m = /^\{(\d+)(?:(,)(\d*))?\}/.exec(src.slice(i, i + 40));
        if (m) return { min: +m[1], max: m[2] ? (m[3] === '' ? Infinity : +m[3]) : +m[1], len: m[0].length };
      }
      return null;
    }
    function quant(node) {
      const q = quantAt();
      if (!q) return node;
      if (node.type === 'assert' && /^[\^$]|\\[bB]$/.test(node.raw)) fail('Nothing to repeat: an anchor cannot be repeated.', node.start);
      i += q.len;
      let lazy = false;
      if (src[i] === '?') { lazy = true; i++; }
      if (q.max < q.min) fail('The numbers in {' + q.min + ',' + q.max + '} are out of order.', node.start);
      return { type: 'quant', start: node.start, end: i, min: q.min, max: q.max, lazy, body: node };
    }
    function atom() {
      const start = i; const c = src[i];
      if (c === '^' || c === '$') { i++; return { type: 'assert', kind: c, start, end: i, raw: c }; }
      if (c === '.') { i++; return { type: 'dot', start, end: i, raw: '.' }; }
      if (c === '(') return group();
      if (c === '[') return cls();
      if (c === '\\') return escape(false);
      if (c === '*' || c === '+' || c === '?') fail('Nothing to repeat before "' + c + '".');
      if (c === '{' && quantAt()) fail('Nothing to repeat before "{".');
      if (uni && (c === '{' || c === '}' || c === ']')) fail('A lone "' + c + '" must be escaped with the u or v flag.');
      const len = cpLen(i); const code = cp(i); i += len;
      return { type: 'char', kind: 'literal', code, start, end: i, raw: src.slice(start, i) };
    }
    function group() {
      const start = i; i++;
      let kind = 'capture', name = null, mods = null;
      if (src[i] === '?') {
        const t = src.slice(i, i + 3);
        if (t.startsWith('?:')) { kind = 'noncap'; i += 2; }
        else if (t.startsWith('?=')) { kind = 'lookahead'; i += 2; }
        else if (t.startsWith('?!')) { kind = 'neglookahead'; i += 2; }
        else if (t === '?<=') { kind = 'lookbehind'; i += 3; }
        else if (t === '?<!') { kind = 'neglookbehind'; i += 3; }
        else if (t.startsWith('?<')) {
          const m = /^\?<([$_\p{ID_Start}][$_\u200c\u200d\p{ID_Continue}]*)>/u.exec(src.slice(i));
          if (!m) fail('A group name must be a valid identifier between < and >.');
          kind = 'named'; name = m[1]; i += m[0].length;
        } else {
          const m = /^\?([ims]*)(?:-([ims]*))?:/.exec(src.slice(i));
          if (!m) fail('Unknown group syntax after "(?".');
          kind = 'modifiers'; mods = { on: m[1], off: m[2] || '' }; i += m[0].length;
        }
      }
      let index = null;
      if (kind === 'capture' || kind === 'named') { index = ++groupNo; if (name) (names[name] = names[name] || []).push(index); }
      const body = alt();
      if (src[i] !== ')') fail('A group opened here is never closed.', start);
      i++;
      return { type: 'group', kind, name, index, mods, start, end: i, raw: src.slice(start, i), body };
    }
    function escapeChar(inClass) {
      // returns a char node for character escapes, or null
      const start = i; const c = src[i + 1];
      const mk = (code, kind) => ({ type: 'char', kind, code, start, end: i, raw: src.slice(start, i) });
      const simple = { t: 9, n: 10, v: 11, f: 12, r: 13 };
      if (c in simple) { i += 2; return mk(simple[c], 'control'); }
      if (c === 'b' && inClass) { i += 2; return mk(8, 'control'); }
      if (c === '0' && !/[0-9]/.test(src[i + 2] || '')) { i += 2; return mk(0, 'control'); }
      if (c === 'x' && isHex(src.slice(i + 2, i + 4)) && src.slice(i + 2, i + 4).length === 2) { i += 4; return mk(parseInt(src.slice(i - 2, i), 16), 'hex'); }
      if (c === 'u') {
        if (uni && src[i + 2] === '{') { const e = src.indexOf('}', i); const h = src.slice(i + 3, e); if (e < 0 || !isHex(h) || parseInt(h, 16) > 0x10ffff) fail('Invalid \\u{...} code point escape.'); i = e + 1; return mk(parseInt(h, 16), 'unicode'); }
        const h = src.slice(i + 2, i + 6);
        if (h.length === 4 && isHex(h)) {
          let code = parseInt(h, 16); i += 6;
          if (uni && code >= 0xd800 && code <= 0xdbff && src[i] === '\\' && src[i + 1] === 'u') { const h2 = src.slice(i + 2, i + 6); const lo = parseInt(h2, 16); if (h2.length === 4 && isHex(h2) && lo >= 0xdc00 && lo <= 0xdfff) { code = 0x10000 + ((code - 0xd800) << 10) + (lo - 0xdc00); i += 6; } }
          return mk(code, 'unicode');
        }
        if (uni) fail('Invalid \\u escape.');
      }
      if (c === 'c' && /[A-Za-z]/.test(src[i + 2] || '')) { i += 3; return mk(src.charCodeAt(i - 1) % 32, 'control'); }
      if (!uni && /[0-7]/.test(c || '')) {
        const m = /^[0-7]{1,3}/.exec(src.slice(i + 1)); let s = m[0]; if (parseInt(s, 8) > 255) s = s.slice(0, 2);
        i += 1 + s.length; return mk(parseInt(s, 8), 'octal');
      }
      if (c === undefined) fail('The pattern ends with a lone backslash.');
      if (uni && !/[\^$\\.*+?()[\]{}|/]/.test(c) && !(inClass && c === '-')) fail('"\\' + c + '" is not a valid escape with the u or v flag.');
      const len = uni ? (src.codePointAt(i + 1) > 0xffff ? 2 : 1) : 1;
      i += 1 + len; return mk(uni ? src.codePointAt(start + 1) : src.charCodeAt(start + 1), 'escaped');
    }
    function escape(inClass) {
      const start = i; const c = src[i + 1];
      if (!inClass && (c === 'b' || c === 'B')) { i += 2; return { type: 'assert', kind: '\\' + c, start, end: i, raw: src.slice(start, i) }; }
      if ('dDwWsS'.includes(c || '#')) { i += 2; return { type: 'shorthand', letter: c, start, end: i, raw: src.slice(start, i) }; }
      if (uni && (c === 'p' || c === 'P') && src[i + 2] === '{') {
        const e = src.indexOf('}', i); if (e < 0) fail('Unclosed \\p{...} property.');
        const name = src.slice(i + 3, e); i = e + 1;
        return { type: 'property', negated: c === 'P', name, start, end: i, raw: src.slice(start, i) };
      }
      if (!inClass && c === 'k' && (uni || Object.keys(names).length || /\(\?<[^=!]/.test(src))) {
        const m = /^\\k<([^>]+)>/.exec(src.slice(i));
        if (!m) fail('\\k must be followed by <name>.');
        i += m[0].length; return { type: 'backref', name: m[1], start, end: i, raw: src.slice(start, i) };
      }
      if (!inClass && /[1-9]/.test(c || '')) {
        const m = /^\d+/.exec(src.slice(i + 1));
        let num = +m[0];
        if (num <= total) { i += 1 + m[0].length; return { type: 'backref', index: num, start, end: i, raw: src.slice(start, i) }; }
        if (uni) fail('\\' + num + ' refers to a group that does not exist.');
        // Annex B: read as octal or identity escape
        if (c === '8' || c === '9') { i += 2; return { type: 'char', kind: 'escaped', code: c.charCodeAt(0), start, end: i, raw: src.slice(start, i), note: 'No group ' + num + ' exists, so this is read as the literal "' + c + '".' }; }
        const node = escapeChar(inClass); node.note = 'No group ' + num + ' exists, so this is read as an octal character escape.'; return node;
      }
      if (vmode && inClass && c === 'q' && src[i + 2] === '{') {
        const e = src.indexOf('}', i); if (e < 0) fail('Unclosed \\q{...} string literal.');
        i = e + 1; return { type: 'qstring', start, end: i, raw: src.slice(start, i), text: src.slice(start + 3, e) };
      }
      return escapeChar(inClass);
    }
    function cls() {
      const start = i; i++;
      let negated = false;
      if (src[i] === '^') { negated = true; i++; }
      const items = [];
      while (i < src.length && src[i] !== ']') {
        if (vmode && src[i] === '[') { items.push(cls()); continue; }
        if (vmode && (src.startsWith('&&', i) || src.startsWith('--', i))) { items.push({ type: 'setop', op: src.slice(i, i + 2), start: i, end: i + 2, raw: src.slice(i, i + 2) }); i += 2; continue; }
        const a = classAtom();
        if (src[i] === '-' && src[i + 1] !== ']' && i + 1 < src.length && !(vmode && src[i + 1] === '-')) {
          const save = i; i++;
          const b = classAtom();
          if (a.type !== 'char' || b.type !== 'char') { if (uni) fail('A class range needs single characters at both ends.', save); items.push(a, { type: 'char', kind: 'literal', code: 45, start: save, end: save + 1, raw: '-' }, b); continue; }
          if (a.code > b.code) fail('The range ' + src.slice(a.start, b.end) + ' is out of order.', a.start);
          items.push({ type: 'range', from: a, to: b, start: a.start, end: b.end, raw: src.slice(a.start, b.end) });
        } else items.push(a);
      }
      if (src[i] !== ']') fail('A character class opened here is never closed.', start);
      i++;
      return { type: 'class', negated, items, start, end: i, raw: src.slice(start, i) };
    }
    function classAtom() {
      const start = i;
      if (src[i] === '\\') return escape(true);
      const len = cpLen(i); const code = cp(i); i += len;
      return { type: 'char', kind: 'literal', code, start, end: i, raw: src.slice(start, i) };
    }

    const ast = alt();
    if (i < src.length) fail(src[i] === ')' ? 'There is a ")" without a matching "(".' : 'Unexpected "' + src[i] + '".');
    annotate(ast);
    return { ast, groups: groupNo, names, flags };
  }
  // Records which capture groups each node contains, for capture reset on repetition.
  function annotate(node) {
    let lo = Infinity, hi = -Infinity;
    const kids = children(node);
    for (const k of kids) { const r = annotate(k); if (r) { lo = Math.min(lo, r[0]); hi = Math.max(hi, r[1]); } }
    if (node.type === 'group' && node.index) { lo = Math.min(lo, node.index); hi = Math.max(hi, node.index); }
    node.caps = lo <= hi ? [lo, hi] : null;
    return node.caps;
  }
  function children(n) {
    if (n.type === 'alt') return n.alts;
    if (n.type === 'seq') return n.items;
    if (n.type === 'group' || n.type === 'quant') return [n.body];
    if (n.type === 'class') return n.items;
    return [];
  }
  function walk(n, fn, parent) { fn(n, parent); for (const k of children(n)) walk(k, fn, n); }

  // ---------- explanation ----------
  const CHAR_NAMES = { 0: 'the null character', 8: 'backspace', 9: 'a tab', 10: 'a line feed (newline)', 11: 'a vertical tab', 12: 'a form feed', 13: 'a carriage return', 32: 'a space', 160: 'a no-break space' };
  function hex(code) { return 'U+' + code.toString(16).toUpperCase().padStart(4, '0'); }
  function charName(code) {
    if (CHAR_NAMES[code]) return CHAR_NAMES[code] + ' (' + hex(code) + ')';
    if (code < 32 || (code >= 0x7f && code < 0xa0)) return 'the control character ' + hex(code);
    if (code >= 0xd800 && code <= 0xdfff) return 'the lone surrogate ' + hex(code);
    return '"' + String.fromCodePoint(code) + '"' + (code > 126 ? ' (' + hex(code) + ')' : '');
  }
  const SHORT = {
    d: 'a digit 0 to 9', D: 'any character that is not a digit 0 to 9',
    w: 'a word character (A to Z, a to z, 0 to 9 or underscore)', W: 'any character that is not a word character',
    s: 'a whitespace character (space, tab, line breaks and Unicode spaces)', S: 'any character that is not whitespace'
  };
  function quantText(q) {
    let t;
    if (q.min === 0 && q.max === Infinity) t = 'zero or more times';
    else if (q.min === 1 && q.max === Infinity) t = 'one or more times';
    else if (q.min === 0 && q.max === 1) t = 'optionally (zero or one time)';
    else if (q.max === Infinity) t = q.min + ' or more times';
    else if (q.min === q.max) t = 'exactly ' + q.min + (q.min === 1 ? ' time' : ' times');
    else t = 'between ' + q.min + ' and ' + q.max + ' times';
    if (q.min === q.max) return t;
    return t + (q.lazy ? ', as few as possible (lazy)' : ', as many as possible (greedy, giving back as needed)');
  }
  function describe(n, ctx) {
    const ic = ctx.flags.includes('i');
    switch (n.type) {
      case 'alt': return 'Match one of ' + n.alts.length + ' alternatives, tried left to right';
      case 'seq': return n.items.length ? 'Match these ' + n.items.length + ' items in order' : 'Match the empty string (an empty alternative)';
      case 'char': return 'Match ' + charName(n.code) + (ic && String.fromCodePoint(n.code).toLowerCase() !== String.fromCodePoint(n.code).toUpperCase() ? ' in either case' : '') + (n.note ? '. ' + n.note : '');
      case 'lit': return 'Match the text "' + n.text + '"' + (ic ? ' in any case' : '');
      case 'dot': return ctx.flags.includes('s') ? 'Match any single character, including line breaks' : 'Match any single character except line breaks (line feed, carriage return, U+2028, U+2029)';
      case 'shorthand': return 'Match ' + SHORT[n.letter] + (/[wW]/.test(n.letter) && ic && /[uv]/.test(ctx.flags) ? ' (with i and u, also the Kelvin sign and long s)' : '');
      case 'property': return 'Match one character ' + (n.negated ? 'without' : 'with') + ' the Unicode property ' + n.name;
      case 'class': return (n.negated ? 'Match one character that is NOT in this set' : 'Match one character from this set') + (n.items.length ? '' : ' (the set is empty, so this ' + (n.negated ? 'matches any character' : 'can never match') + ')');
      case 'range': return 'A character from ' + charName(n.from.code) + ' to ' + charName(n.to.code);
      case 'setop': return n.op === '&&' ? 'Intersection: keep only characters in both sides' : 'Subtraction: remove the characters on the right';
      case 'qstring': return 'The string alternatives "' + n.text.split('|').join('", "') + '"';
      case 'assert':
        if (n.kind === '^') return ctx.flags.includes('m') ? 'Assert the start of a line (zero width)' : 'Assert the start of the text (zero width)';
        if (n.kind === '$') return ctx.flags.includes('m') ? 'Assert the end of a line (zero width)' : 'Assert the end of the text (zero width)';
        if (n.kind === '\\b') return 'Assert a word boundary (zero width)';
        return 'Assert a position that is not a word boundary (zero width)';
      case 'backref': {
        if (n.name) return 'Match the same text that the group named "' + n.name + '" captured' + (ic ? ', ignoring case' : '');
        return 'Match the same text that group ' + n.index + ' captured' + (ic ? ', ignoring case' : '') + '. If that group did not take part, this matches the empty string';
      }
      case 'group':
        switch (n.kind) {
          case 'capture': return 'Capture group ' + n.index;
          case 'named': return 'Capture group ' + n.index + ' named "' + n.name + '"';
          case 'noncap': return 'Group without capturing';
          case 'lookahead': return 'Lookahead: assert that what follows matches (zero width)';
          case 'neglookahead': return 'Negative lookahead: assert that what follows does NOT match (zero width)';
          case 'lookbehind': return 'Lookbehind: assert that what precedes matches (zero width)';
          case 'neglookbehind': return 'Negative lookbehind: assert that what precedes does NOT match (zero width)';
          case 'modifiers': return 'Group with modifiers' + (n.mods.on ? ': turn on ' + n.mods.on.split('').join(', ') : '') + (n.mods.off ? (n.mods.on ? ', ' : ': ') + 'turn off ' + n.mods.off.split('').join(', ') : '');
        }
        break;
      case 'quant': return 'Repeat the item below ' + quantText(n);
    }
    return n.type;
  }
  // Explanation tree: { text, raw, start, end, type, children }. Literal runs are merged for reading.
  function explain(pattern, flags) {
    const p = parse(pattern, flags);
    const ctx = { flags: p.flags, src: pattern };
    function node(n) {
      let kids = children(n);
      if (n.type === 'seq') kids = mergeLits(kids, pattern);
      if (n.type === 'seq' && kids.length === 1) return node(kids[0]);
      const out = { type: n.type, text: describe(n, ctx), raw: pattern.slice(n.start, n.end), start: n.start, end: n.end, children: kids.map(node) };
      if (n.type === 'alt') out.children.forEach((c, k) => { c.text = 'Alternative ' + (k + 1) + ': ' + c.text; });
      return out;
    }
    let tree = node(p.ast);
    if (tree.type === 'seq' && tree.children.length === 1) tree = tree.children[0];
    return { tree, groups: p.groups, names: p.names, flags: p.flags };
  }
  function mergeLits(items, src) {
    const out = []; let run = [];
    const flush = () => {
      if (run.length > 1) out.push({ type: 'lit', start: run[0].start, end: run[run.length - 1].end, text: run.map((c) => String.fromCodePoint(c.code)).join(''), raw: src.slice(run[0].start, run[run.length - 1].end) });
      else if (run.length) out.push(run[0]);
      run = [];
    };
    for (const it of items) { if (it.type === 'char' && it.code >= 32 && it.code !== 127 && !it.note) run.push(it); else { flush(); out.push(it); } }
    flush();
    return out;
  }
  function explainText(tree, depth) {
    depth = depth || 0;
    const pad = '  '.repeat(depth);
    return pad + '- ' + (tree.raw ? '`' + tree.raw + '` ' : '') + tree.text + '\n' + tree.children.map((c) => explainText(c, depth + 1)).join('');
  }
  // Deepest explanation node that contains a source offset, for caret to tree selection.
  function nodeAt(tree, offset) {
    let best = null;
    (function visit(n, path) { if (offset >= n.start && offset <= n.end && n.end > n.start) { best = path; n.children.forEach((c, k) => visit(c, path.concat(k))); } })(tree, []);
    return best;
  }

  // ---------- diagnostics ----------
  function canMatchEmpty(n) {
    switch (n.type) {
      case 'alt': return n.alts.some(canMatchEmpty);
      case 'seq': return n.items.every(canMatchEmpty);
      case 'quant': return n.min === 0 || canMatchEmpty(n.body);
      case 'group': return n.kind.indexOf('look') >= 0 || canMatchEmpty(n.body);
      case 'assert': case 'backref': return true;
      default: return false;
    }
  }
  function diagnose(pattern, flags) {
    const out = [];
    const v = validate(pattern, flags);
    if (!v.ok) { out.push({ level: 'error', text: 'The JavaScript engine rejects this pattern: ' + v.error }); return out; }
    let p;
    try { p = parse(pattern, flags); } catch (e) { out.push({ level: 'warn', text: 'The engine accepts this pattern but the explainer could not read it at position ' + e.at + ': ' + e.message }); return out; }
    walk(p.ast, (n) => {
      if (n.type === 'quant' && n.max > 1) {
        let inner = null;
        walk(n.body, (x) => { if (!inner && x !== n.body && x.type === 'quant' && x.max > 1 && x.max !== x.min) inner = x; });
        if (n.body.type === 'quant' && !inner) inner = n.body;
        if (inner && (n.max === Infinity || n.max > 10)) out.push({ level: 'risk', start: n.start, end: n.end, text: 'Nested repetition: "' + pattern.slice(n.start, n.end) + '" repeats something that itself repeats. On text that almost matches this can take exponential time (catastrophic backtracking). Make the inner part unambiguous or test it with Benchmark growth.' });
        const body = n.body.type === 'group' ? n.body.body : n.body;
        if (body.type === 'alt' && n.max === Infinity) {
          const raws = body.alts.map((a) => pattern.slice(a.start, a.end));
          for (let a = 0; a < raws.length; a++) for (let b = 0; b < raws.length; b++) if (a !== b && raws[a] && raws[b].startsWith(raws[a]) && !/[\\[(.]/.test(raws[a])) { out.push({ level: 'risk', start: n.start, end: n.end, text: 'Overlapping alternatives inside a repetition ("' + raws[a] + '" and "' + raws[b] + '") can be tried in many combinations. Order or merge them.' }); a = b = raws.length; }
        }
        if (canMatchEmpty(n.body) && n.max === Infinity) out.push({ level: 'info', start: n.start, end: n.end, text: '"' + pattern.slice(n.start, n.end) + '" repeats something that can match nothing. The engine stops an empty repetition, but the pattern is probably not what you meant.' });
      }
      if (n.type === 'char' && n.note) out.push({ level: 'warn', start: n.start, end: n.end, text: n.note });
      if (n.type === 'backref' && n.name && !p.names[n.name]) out.push({ level: 'error', start: n.start, end: n.end, text: 'No group is named "' + n.name + '".' });
      if (n.type === 'backref' && n.index) {
        let defined = false;
        walk(p.ast, (g) => { if (g.type === 'group' && g.index === n.index && g.end <= n.start) defined = true; });
        if (!defined) out.push({ level: 'info', start: n.start, end: n.end, text: 'Group ' + n.index + ' has not finished when this backreference is reached, so it always matches the empty string.' });
      }
    });
    if (canMatchEmpty(p.ast)) out.push({ level: 'info', text: 'This pattern can match an empty string. Zero-width matches are listed at each position, and a search moves on one character after each one.' });
    const f = normFlags(flags);
    if (!/[uv]/.test(f) && /[\ud800-\udbff][\udc00-\udfff]/.test(pattern)) out.push({ level: 'warn', text: 'The pattern contains characters outside the Basic Multilingual Plane (such as emoji) without the u or v flag, so they are treated as two separate code units.' });
    if (f.includes('y') && f.includes('g')) out.push({ level: 'info', text: 'With both g and y, every match must start exactly where the previous one ended.' });
    return out;
  }
  function riskOf(pattern, flags) { return diagnose(pattern, flags).filter((d) => d.level === 'risk'); }

  // ---------- replacement templates (JavaScript String.prototype.replace syntax) ----------
  function parseTemplate(tpl, groups, names) {
    const toks = []; let lit = '';
    const push = (t) => { if (lit) { toks.push({ type: 'text', text: lit }); lit = ''; } toks.push(t); };
    const hasNames = names && Object.keys(names).length > 0;
    for (let i = 0; i < tpl.length; i++) {
      const c = tpl[i];
      if (c !== '$' || i === tpl.length - 1) { lit += c; continue; }
      const d = tpl[i + 1];
      if (d === '$') { push({ type: 'dollar', raw: '$$', text: 'A literal dollar sign' }); i++; continue; }
      if (d === '&') { push({ type: 'match', raw: '$&', text: 'The whole match' }); i++; continue; }
      if (d === '`') { push({ type: 'before', raw: '$`', text: 'The text before the match' }); i++; continue; }
      if (d === "'") { push({ type: 'after', raw: "$'", text: 'The text after the match' }); i++; continue; }
      if (/\d/.test(d)) {
        const two = tpl.slice(i + 1, i + 3);
        if (/^\d\d$/.test(two) && +two >= 1 && +two <= groups) { push({ type: 'group', index: +two, raw: '$' + two, text: 'The text of group ' + (+two) }); i += 2; continue; }
        if (+d >= 1 && +d <= groups) { push({ type: 'group', index: +d, raw: '$' + d, text: 'The text of group ' + d }); i++; continue; }
        lit += c; continue;
      }
      if (d === '<' && hasNames) {
        const e = tpl.indexOf('>', i);
        if (e > 0) { const nm = tpl.slice(i + 2, e); push({ type: 'named', name: nm, raw: tpl.slice(i, e + 1), text: names[nm] ? 'The text of the group named "' + nm + '"' : 'No group is named "' + nm + '", so this inserts nothing' }); i = e; continue; }
      }
      lit += c;
    }
    if (lit) toks.push({ type: 'text', text: lit });
    return toks;
  }
  function expandTemplate(toks, m, subject, names) {
    let out = '';
    for (const t of toks) {
      if (t.type === 'text') out += t.text;
      else if (t.type === 'dollar') out += '$';
      else if (t.type === 'match') out += m[0];
      else if (t.type === 'before') out += subject.slice(0, m.index);
      else if (t.type === 'after') out += subject.slice(m.index + m[0].length);
      else if (t.type === 'group') out += m[t.index] == null ? '' : m[t.index];
      else if (t.type === 'named') out += m.groups && m.groups[t.name] != null ? m.groups[t.name] : '';
    }
    return out;
  }

  // ---------- instrumented step tracer ----------
  // Walks the parsed pattern with backtracking and logs every step. Single characters, classes,
  // anchors and boundaries are each decided by the real engine (a one-item RegExp), so case folding,
  // Unicode properties and line terminators follow the engine. Lookbehind and modifier groups are
  // handed to the engine as one opaque step. The final result is compared with the engine's own match.
  const LIMIT = { limit: true };
  function trace(pattern, flags, subject, opts) {
    opts = opts || {};
    flags = normFlags(flags);
    if (subject.length > LIMITS.traceSubject) throw new RangeError('The debugger traces at most ' + LIMITS.traceSubject + ' characters of subject text.');
    const p = parse(pattern, flags);
    const maxSteps = Math.min(opts.maxSteps || LIMITS.traceSteps, LIMITS.traceSteps);
    const maxLog = Math.min(opts.maxLog || LIMITS.traceLog, LIMITS.traceLog);
    const uni = /[uv]/.test(flags);
    const base = flags.replace(/[dgy]/g, '');
    const cache = new Map();
    const rxFor = (src, f) => { const k = f + '/' + src; let r = cache.get(k); if (!r) { r = new RegExp(src, f); cache.set(k, r); } return r; };
    const notes = new Set();
    let steps = 0, attempt = 0; const log = [];
    function note(op, n, pos, text) {
      steps++;
      if (steps > maxSteps) throw LIMIT;
      if (log.length < maxLog) log.push({ n: steps, attempt, op, start: n ? n.start : -1, end: n ? n.end : -1, pos, text });
    }
    const chAt = (pos) => (pos >= subject.length ? null : uni ? String.fromCodePoint(subject.codePointAt(pos)) : subject[pos]);
    const sticky = (src, pos) => { const r = rxFor(src, base + 'y'); r.lastIndex = pos; const m = r.exec(subject); return m ? r.lastIndex : -1; };
    const reset = (caps, range) => { if (!range) return caps; const c = caps.slice(); for (let g = range[0]; g <= range[1]; g++) c[g] = undefined; return c; };

    function m(n, pos, caps, k) {
      switch (n.type) {
        case 'seq': return seq(n.items, 0, pos, caps, k);
        case 'alt':
          for (let a = 0; a < n.alts.length; a++) {
            note('try', n.alts[a], pos, 'Try alternative ' + (a + 1));
            const r = m(n.alts[a], pos, caps, k); if (r) return r;
            note('backtrack', n.alts[a], pos, 'Alternative ' + (a + 1) + ' failed; back up');
          }
          return null;
        case 'char': case 'dot': case 'class': case 'shorthand': case 'property': {
          const ch = chAt(pos);
          if (ch !== null && rxFor('^(?:' + pattern.slice(n.start, n.end) + ')$', base).test(ch)) { note('match', n, pos, 'Matched ' + JSON.stringify(ch)); return k(pos + ch.length, caps); }
          note('fail', n, pos, ch === null ? 'End of text reached' : 'Did not match ' + JSON.stringify(ch));
          return null;
        }
        case 'assert': {
          if (sticky(pattern.slice(n.start, n.end), pos) >= 0) { note('match', n, pos, 'Zero-width assertion holds'); return k(pos, caps); }
          note('fail', n, pos, 'Zero-width assertion fails'); return null;
        }
        case 'backref': {
          const idx = n.index || (p.names[n.name] || []).find((g) => caps[g]) || (p.names[n.name] || [])[0];
          const c = caps[idx];
          if (!c) { note('match', n, pos, 'Group ' + idx + ' has not captured, so this matches empty'); return k(pos, caps); }
          const text = subject.slice(c[0], c[1]);
          const end = flags.includes('i') ? sticky(escapeRegex(text), pos) : (subject.startsWith(text, pos) ? pos + text.length : -1);
          if (end >= 0) { note('match', n, pos, 'Repeated ' + JSON.stringify(text)); return k(end, caps); }
          note('fail', n, pos, 'Expected ' + JSON.stringify(text) + ' again'); return null;
        }
        case 'group': return group(n, pos, caps, k);
        case 'quant': return rep(n, pos, 0, caps, k);
      }
      throw new Error('The tracer cannot step through a ' + n.type + ' node.');
    }
    function seq(items, j, pos, caps, k) { if (j === items.length) return k(pos, caps); return m(items[j], pos, caps, (p2, c2) => seq(items, j + 1, p2, c2, k)); }
    function group(n, pos, caps, k) {
      if (n.kind === 'capture' || n.kind === 'named' || n.kind === 'noncap') {
        note('enter', n, pos, n.index ? 'Enter group ' + n.index : 'Enter group');
        return m(n.body, pos, caps, (p2, c2) => {
          if (!n.index) return k(p2, c2);
          const c3 = c2.slice(); c3[n.index] = [pos, p2];
          note('capture', n, p2, 'Group ' + n.index + ' captured ' + JSON.stringify(subject.slice(pos, p2)));
          return k(p2, c3);
        });
      }
      if (n.kind === 'lookahead' || n.kind === 'neglookahead') {
        note('enter', n, pos, 'Look ahead');
        const r = m(n.body, pos, caps, (p2, c2) => ({ caps: c2 }));
        if (n.kind === 'lookahead') { if (r) { note('match', n, pos, 'Lookahead holds'); return k(pos, r.caps); } note('fail', n, pos, 'Lookahead fails'); return null; }
        if (r) { note('fail', n, pos, 'Negative lookahead found a match, so it fails'); return null; }
        note('match', n, pos, 'Negative lookahead holds'); return k(pos, caps);
      }
      // lookbehind and modifier groups: decided by the engine as a single step
      notes.add(n.kind === 'modifiers' ? 'Modifier groups are decided by the engine as one step; backtracking into them is not traced.' : 'Lookbehind is decided by the engine as one step (the engine reads it right to left).');
      if (n.caps || /\\(?:[1-9]|k<)/.test(n.raw)) notes.add('A group decided by the engine contains captures or backreferences, so captures inside it are not traced.');
      const end = sticky(n.kind === 'modifiers' ? n.raw : n.raw, pos);
      if (end >= 0) { note('match', n, pos, 'Engine step succeeded'); return k(end, caps); }
      note('fail', n, pos, 'Engine step failed'); return null;
    }
    function rep(n, pos, count, caps, k) {
      const more = () => {
        if (count >= n.max) return null;
        note('repeat', n, pos, 'Try repetition ' + (count + 1));
        return m(n.body, pos, reset(caps, n.body.caps || n.caps), (p2, c2) => {
          if (p2 === pos && count >= n.min) { note('fail', n, pos, 'Empty repetition stopped'); return null; }
          return rep(n, p2, count + 1, c2, k);
        });
      };
      const stop = () => { if (count < n.min) return null; note('leave', n, pos, 'Continue after ' + count + ' repetition' + (count === 1 ? '' : 's')); return k(pos, caps); };
      let r;
      if (n.lazy) { r = stop(); if (r) return r; r = more(); }
      else { r = more(); if (r) return r; if (count < n.max && count >= n.min) note('backtrack', n, pos, 'Give back: try with ' + count); r = stop(); }
      return r;
    }

    const start = Math.max(0, Math.min(subject.length, opts.from || 0));
    let result = null, truncated = '';
    try {
      for (let s = start; s <= subject.length;) {
        attempt++;
        note('attempt', null, s, 'Attempt a match starting at position ' + s);
        const r = m(p.ast, s, new Array(p.groups + 1), (end, caps) => ({ end, caps }));
        if (r) { result = { index: s, end: r.end, caps: r.caps.map((c) => c || null).slice(1) }; break; }
        if (flags.includes('y')) break;
        s += uni && s < subject.length && subject.codePointAt(s) > 0xffff ? 2 : 1;
      }
    } catch (e) {
      if (e === LIMIT) truncated = 'Stopped after ' + maxSteps + ' steps. The trace is incomplete; the step count alone shows heavy backtracking.';
      else if (e instanceof RangeError) truncated = 'The trace went too deep for this runtime (' + e.message + '). Use a shorter subject.';
      else throw e;
    }
    const er = rxFor(pattern, base + (flags.includes('y') ? 'y' : 'g')); er.lastIndex = start;
    const em = er.exec(subject);
    const engine = em ? { index: em.index, end: em.index + em[0].length, caps: null } : null;
    if (em) { const ri = rxFor(pattern, base + 'd' + (flags.includes('y') ? 'y' : 'g')); ri.lastIndex = start; const md = ri.exec(subject); engine.caps = md.indices.slice(1).map((x) => (x ? [x[0], x[1]] : null)); }
    let agree = null;
    if (!truncated) {
      agree = (!result && !engine) || (!!result && !!engine && result.index === engine.index && result.end === engine.end && (notes.size > 0 || JSON.stringify(result.caps) === JSON.stringify(engine.caps)));
    }
    return { steps, log, logTruncated: steps > log.length, attempts: attempt, match: result, engine, agree, truncated, notes: [...notes] };
  }

  // ---------- escaping and code generation ----------
  function escapeRegex(s) { return String(s).replace(/[\\^$.*+?()[\]{}|/-]/g, '\\$&'); }
  function jsString(s) { return JSON.stringify(s).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'); }
  const LANGS = {
    javascript: 'JavaScript', python: 'Python (re)', csharp: 'C# (.NET)', java: 'Java', go: 'Go (regexp)', php: 'PHP (preg)'
  };
  function codeFor(lang, action, pattern, flags, replacement) {
    flags = normFlags(flags);
    const conv = lang === 'javascript' ? { text: pattern, changes: [], blockers: [] } : convert(pattern, flags, { python: 'python', csharp: 'dotnet', java: 'java', go: 'go', php: 'pcre2' }[lang]);
    const rconv = replacement == null ? null : convertReplacement(replacement, { python: 'python', csharp: 'dotnet', java: 'java', go: 'go', php: 'pcre2', javascript: 'js' }[lang]);
    const P = conv.text; const R = rconv ? rconv.text : '';
    const fi = flags.includes('i'), fm = flags.includes('m'), fs = flags.includes('s');
    let code = '';
    if (lang === 'javascript') {
      const f = action === 'all' || action === 'replace' ? normFlags(flags + 'g') : flags.replace('g', '');
      const rx = 'const re = new RegExp(' + jsString(pattern) + ', ' + jsString(f) + ');\n';
      code = rx + ({ match: 'const m = re.exec(subject);\nif (m) console.log(m.index, m[0], m.slice(1));', all: 'for (const m of subject.matchAll(re)) console.log(m.index, m[0], m.slice(1));', replace: 'const result = subject.replace(re, ' + jsString(replacement || '') + ');', split: 'const parts = subject.split(re);' })[action];
    } else if (lang === 'python') {
      const fl = [fi && 're.IGNORECASE', fm && 're.MULTILINE', fs && 're.DOTALL'].filter(Boolean).join(' | ') || '0';
      code = 'import re\n\npattern = re.compile(' + jsString(P) + ', ' + fl + ')\n' + ({ match: 'm = pattern.search(subject)\nif m:\n    print(m.start(), m.group(0), m.groups())', all: 'for m in pattern.finditer(subject):\n    print(m.start(), m.group(0), m.groups())', replace: 'result = pattern.sub(' + jsString(R) + ', subject)', split: 'parts = pattern.split(subject)' })[action];
    } else if (lang === 'csharp') {
      const fl = [fi && 'RegexOptions.IgnoreCase', fm && 'RegexOptions.Multiline', fs && 'RegexOptions.Singleline'].filter(Boolean).join(' | ') || 'RegexOptions.None';
      const lit = (s) => '@"' + s.replace(/"/g, '""') + '"';
      code = 'using System.Text.RegularExpressions;\n\nvar re = new Regex(' + lit(P) + ', ' + fl + ', TimeSpan.FromSeconds(1));\n' + ({ match: 'var m = re.Match(subject);\nif (m.Success) Console.WriteLine($"{m.Index} {m.Value}");', all: 'foreach (Match m in re.Matches(subject)) Console.WriteLine($"{m.Index} {m.Value}");', replace: 'var result = re.Replace(subject, ' + lit(R) + ');', split: 'var parts = re.Split(subject);' })[action];
    } else if (lang === 'java') {
      const fl = [fi && 'Pattern.CASE_INSENSITIVE', fm && 'Pattern.MULTILINE', fs && 'Pattern.DOTALL'].filter(Boolean).join(' | ') || '0';
      code = 'import java.util.regex.*;\n\nPattern re = Pattern.compile(' + jsString(P) + ', ' + fl + ');\n' + ({ match: 'Matcher m = re.matcher(subject);\nif (m.find()) System.out.println(m.start() + " " + m.group());', all: 'Matcher m = re.matcher(subject);\nwhile (m.find()) System.out.println(m.start() + " " + m.group());', replace: 'String result = re.matcher(subject).replaceAll(' + jsString(R) + ');', split: 'String[] parts = re.split(subject, -1);' })[action];
    } else if (lang === 'go') {
      const inl = (fi ? 'i' : '') + (fm ? 'm' : '') + (fs ? 's' : '');
      const full = (inl ? '(?' + inl + ')' : '') + P;
      const lit = full.includes('`') ? jsString(full) : '`' + full + '`';
      code = 'import "regexp"\n\nre := regexp.MustCompile(' + lit + ')\n' + ({ match: 'loc := re.FindStringSubmatchIndex(subject)\nfmt.Println(loc)', all: 'for _, m := range re.FindAllStringSubmatch(subject, -1) {\n\tfmt.Println(m)\n}', replace: 'result := re.ReplaceAllString(subject, ' + jsString(R) + ')', split: 'parts := re.Split(subject, -1)' })[action];
    } else if (lang === 'php') {
      const q = (s) => "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
      const rx = q('~' + P.replace(/~/g, '\\~') + '~' + (fi ? 'i' : '') + (fm ? 'm' : '') + (fs ? 's' : '') + (/[uv]/.test(flags) ? 'u' : ''));
      code = '<?php\n$re = ' + rx + ';\n' + ({ match: 'if (preg_match($re, $subject, $m, PREG_OFFSET_CAPTURE)) print_r($m);', all: 'preg_match_all($re, $subject, $m, PREG_SET_ORDER);\nprint_r($m);', replace: '$result = preg_replace($re, ' + q(R) + ', $subject);', split: '$parts = preg_split($re, $subject);' })[action];
    }
    const warn = conv.blockers.concat(conv.changes, rconv ? rconv.blockers.concat(rconv.changes) : []);
    return { code, notes: warn };
  }

  // ---------- flavours: static notes, never executed here ----------
  const FLAVORS = {
    js: { name: 'JavaScript (this engine)', executed: true },
    pcre2: { name: 'PCRE2 (PHP, R, many tools)' }, python: { name: 'Python re' }, dotnet: { name: '.NET' },
    java: { name: 'Java java.util.regex' }, go: { name: 'Go regexp (RE2)' }, posix: { name: 'POSIX ERE (grep -E, awk)' }
  };
  // yes, no, or diff (supported with different syntax or meaning). Reviewed 2026-11-20 from each
  // engine's public documentation; these are static notes, not test results.
  const MATRIX = {
    lookahead: { label: 'Lookahead (?= ) (?! )', pcre2: 'yes', python: 'yes', dotnet: 'yes', java: 'yes', go: 'no', posix: 'no' },
    lookbehind: { label: 'Lookbehind (?<= ) (?<! )', pcre2: ['diff', 'Older PCRE2 requires each alternative to have a fixed length.'], python: ['diff', 'Python re requires a fixed width.'], dotnet: 'yes', java: ['diff', 'Java requires a bounded maximum length.'], go: 'no', posix: 'no' },
    named: { label: 'Named group (?<name> )', pcre2: 'yes', python: ['diff', 'Python re writes it (?P<name> ).'], dotnet: 'yes', java: 'yes', go: ['diff', 'Go accepts (?P<name> ) and, since Go 1.22, (?<name> ).'], posix: 'no' },
    namedref: { label: 'Named backreference \\k<name>', pcre2: 'yes', python: ['diff', 'Python re writes it (?P=name).'], dotnet: 'yes', java: 'yes', go: 'no', posix: 'no' },
    backref: { label: 'Numbered backreference \\1', pcre2: 'yes', python: 'yes', dotnet: 'yes', java: 'yes', go: 'no', posix: ['diff', 'Backreferences are defined for POSIX basic expressions; ERE tools vary.'] },
    lazy: { label: 'Lazy quantifiers *? +? ??', pcre2: 'yes', python: 'yes', dotnet: 'yes', java: 'yes', go: 'yes', posix: 'no' },
    property: { label: 'Unicode property \\p{ }', pcre2: 'yes', python: ['no', 'Python re has no \\p; the third-party regex module does.'], dotnet: ['diff', '.NET supports general categories and named blocks (\\p{IsGreek}), not script names.'], java: ['diff', 'Java names scripts and blocks differently (\\p{IsGreek}, \\p{InGreek}).'], go: ['diff', 'Go accepts categories and scripts without Script= prefixes.'], posix: 'no' },
    dotall: { label: 'Dot matches line breaks (s)', pcre2: 'yes', python: ['diff', 'Use re.DOTALL.'], dotnet: ['diff', 'Use RegexOptions.Singleline.'], java: ['diff', 'Use Pattern.DOTALL.'], go: 'yes', posix: ['diff', 'Behaviour depends on the tool.'] },
    multiline: { label: 'Multiline anchors (m)', pcre2: 'yes', python: ['diff', 'Use re.MULTILINE.'], dotnet: 'yes', java: ['diff', 'Use Pattern.MULTILINE.'], go: 'yes', posix: ['diff', 'Anchors usually work per line already.'] },
    sticky: { label: 'Sticky matching (y)', pcre2: ['diff', 'Use \\G or an anchored match.'], python: ['diff', 'Use pattern.match(text, pos).'], dotnet: ['diff', 'Use \\G.'], java: ['diff', 'Use \\G or lookingAt().'], go: 'no', posix: 'no' },
    indices: { label: 'Capture indices (d)', pcre2: ['diff', 'Offsets are returned by the API.'], python: ['diff', 'Use m.span(n).'], dotnet: ['diff', 'Use Group.Index.'], java: ['diff', 'Use m.start(n).'], go: ['diff', 'Use FindStringSubmatchIndex.'], posix: 'no' },
    sets: { label: 'Class set operations (v)', pcre2: ['diff', 'Recent PCRE2 versions use a different extended class syntax.'], python: 'no', dotnet: ['diff', '.NET has subtraction only: [a-z-[aeiou]].'], java: ['diff', 'Java has intersection only: [a-z&&[^aeiou]].'], go: 'no', posix: 'no' },
    modifiers: { label: 'Modifier groups (?i: )', pcre2: 'yes', python: 'yes', dotnet: 'yes', java: 'yes', go: ['diff', 'Go supports i, m, s and U.'], posix: 'no' },
    shorthand: { label: '\\d \\w \\s meaning', pcre2: 'yes', python: ['diff', 'For text, \\d and \\w also match non-ASCII digits and letters.'], dotnet: ['diff', '\\d and \\w are Unicode-aware unless ECMAScript mode is on.'], java: 'yes', go: 'yes', posix: ['diff', 'Use [[:digit:]], [[:alnum:]_] and [[:space:]].'] },
    wordb: { label: 'Word boundary \\b', pcre2: 'yes', python: 'yes', dotnet: 'yes', java: 'yes', go: ['diff', 'ASCII word characters only.'], posix: ['diff', 'Not standard; some tools use \\< \\> or [[:<:]].'] }
  };
  function features(pattern, flags) {
    const f = normFlags(flags); const out = new Set();
    let p; try { p = parse(pattern, f); } catch { return { list: [], parsed: false }; }
    walk(p.ast, (n) => {
      if (n.type === 'group') { if (n.kind === 'lookahead' || n.kind === 'neglookahead') out.add('lookahead'); if (n.kind === 'lookbehind' || n.kind === 'neglookbehind') out.add('lookbehind'); if (n.kind === 'named') out.add('named'); if (n.kind === 'modifiers') out.add('modifiers'); }
      if (n.type === 'backref') out.add(n.name ? 'namedref' : 'backref');
      if (n.type === 'quant' && n.lazy) out.add('lazy');
      if (n.type === 'property') out.add('property');
      if (n.type === 'shorthand') out.add('shorthand');
      if (n.type === 'setop' || n.type === 'qstring') out.add('sets');
      if (n.type === 'assert' && /\\b/i.test(n.kind)) out.add('wordb');
      if (n.type === 'dot' && f.includes('s')) out.add('dotall');
      if (n.type === 'assert' && /[\^$]/.test(n.kind) && f.includes('m')) out.add('multiline');
    });
    if (f.includes('y')) out.add('sticky');
    if (f.includes('d')) out.add('indices');
    if (f.includes('v')) out.add('sets');
    return { list: [...out], parsed: true };
  }
  function compare(pattern, flags) {
    const ft = features(pattern, flags);
    const rows = ft.list.map((id) => {
      const r = MATRIX[id]; const cells = {};
      for (const fl of Object.keys(FLAVORS)) {
        if (fl === 'js') { cells.js = { status: 'yes', note: 'Executed by this engine.' }; continue; }
        const v = r[fl]; cells[fl] = Array.isArray(v) ? { status: v[0], note: v[1] } : { status: v, note: '' };
      }
      return { id, label: r.label, cells };
    });
    return { flavors: FLAVORS, rows, parsed: ft.parsed, reviewed: '2026-11-20', basis: 'Static notes from public engine documentation. Only JavaScript is executed here.' };
  }
  // Converts the JavaScript pattern text for a target flavour. Never executes the result.
  function convert(pattern, flags, target) {
    const f = normFlags(flags); const changes = []; const blockers = [];
    let p; try { p = parse(pattern, f); } catch (e) { return { text: pattern, changes, blockers: ['The pattern could not be read: ' + e.message] }; }
    const edits = [];
    walk(p.ast, (n) => {
      if (n.type === 'group') {
        if (n.kind === 'named' && target === 'python') { edits.push([n.start, n.start + 3 + n.name.length + 1, '(?P<' + n.name + '>']); changes.push('Named group (?<' + n.name + '>) becomes (?P<' + n.name + '>).'); }
        if ((n.kind.indexOf('look') >= 0) && (target === 'go' || target === 'posix')) blockers.push('Lookaround ' + n.raw.slice(0, 12) + ' has no equivalent in ' + FLAVORS[target].name + '.');
        if (n.kind === 'named' && target === 'posix') blockers.push('POSIX has no named groups.');
        if (n.kind === 'noncap' && target === 'posix') { edits.push([n.start, n.start + 3, '(']); changes.push('Non-capturing group becomes a plain group, which shifts group numbers.'); }
      }
      if (n.type === 'backref') {
        if (target === 'go') blockers.push('Go has no backreferences (' + pattern.slice(n.start, n.end) + ').');
        else if (n.name && target === 'python') { edits.push([n.start, n.end, '(?P=' + n.name + ')']); changes.push('\\k<' + n.name + '> becomes (?P=' + n.name + ').'); }
        else if (n.name && target === 'posix') blockers.push('POSIX has no named backreferences.');
      }
      if (n.type === 'property' && (target === 'python' || target === 'posix')) blockers.push(pattern.slice(n.start, n.end) + ' is not supported by ' + FLAVORS[target].name + '.');
      if (n.type === 'property' && (target === 'dotnet' || target === 'java')) changes.push('Check the property name ' + n.name + ': ' + FLAVORS[target].name + ' names scripts and blocks differently.');
      if (n.type === 'quant' && n.lazy && target === 'posix') blockers.push('POSIX has no lazy quantifiers.');
      if (n.type === 'shorthand' && target === 'posix') { edits.push([n.start, n.end, { d: '[[:digit:]]', D: '[^[:digit:]]', w: '[[:alnum:]_]', W: '[^[:alnum:]_]', s: '[[:space:]]', S: '[^[:space:]]' }[n.letter]]); changes.push('\\' + n.letter + ' becomes a POSIX bracket class.'); }
      if (n.type === 'shorthand' && target === 'python' && /[dwDW]/.test(n.letter)) changes.push('In Python, \\' + n.letter + ' is Unicode-aware for text; add re.ASCII to keep the JavaScript meaning.');
      if (n.type === 'setop' || n.type === 'qstring') blockers.push('Set operation ' + n.raw + ' has no direct equivalent in ' + FLAVORS[target].name + '.');
    });
    if (f.includes('y')) changes.push('The sticky flag has no inline form; anchor with \\G or match at a position in ' + FLAVORS[target].name + '.');
    if (f.includes('s') && target === 'posix') blockers.push('POSIX ERE has no dot-all switch.');
    edits.sort((a, b) => b[0] - a[0]);
    let text = pattern;
    for (const [s, e, r] of edits) text = text.slice(0, s) + r + text.slice(e);
    if (target === 'go' && /\\u[0-9a-fA-F]{4}|\\u\{/.test(text)) { text = text.replace(/\\u\{([0-9a-fA-F]+)\}|\\u([0-9a-fA-F]{4})/g, (m0, a, b) => '\\x{' + (a || b) + '}'); changes.push('\\u escapes become \\x{...}.'); }
    if ((target === 'pcre2' || target === 'java') && /\\u\{/.test(text)) { text = text.replace(/\\u\{([0-9a-fA-F]+)\}/g, '\\x{$1}'); changes.push('\\u{...} becomes \\x{...}.'); }
    if (target === 'pcre2' && /\\u[0-9a-fA-F]{4}/.test(text)) { text = text.replace(/\\u([0-9a-fA-F]{4})/g, '\\x{$1}'); changes.push('\\uXXXX becomes \\x{XXXX}.'); }
    return { text, changes: [...new Set(changes)], blockers: [...new Set(blockers)], verified: false };
  }
  function convertReplacement(tpl, target) {
    const toks = parseTemplate(tpl, 99, { _any: [1] });
    const changes = [], blockers = [];
    const map = {
      python: { group: (t) => '\\g<' + t.index + '>', named: (t) => '\\g<' + t.name + '>', match: () => '\\g<0>', dollar: () => '$', text: (t) => t.text.replace(/\\/g, '\\\\') },
      dotnet: { group: (t) => '${' + t.index + '}', named: (t) => '${' + t.name + '}', match: () => '$&', dollar: () => '$$', before: () => '$`', after: () => "$'" },
      java: { group: (t) => '$' + t.index, named: (t) => '${' + t.name + '}', match: () => '$0', dollar: () => '\\$', text: (t) => t.text.replace(/\\/g, '\\\\') },
      go: { group: (t) => '${' + t.index + '}', named: (t) => '${' + t.name + '}', match: () => '${0}', dollar: () => '$$' },
      pcre2: { group: (t) => '${' + t.index + '}', named: (t) => '${' + t.name + '}', match: () => '$0', dollar: () => '$$' },
      js: {}, posix: {}
    }[target] || {};
    let out = '';
    for (const t of toks) {
      if (target === 'js' || !map) { out += t.raw || t.text; continue; }
      const fn = map[t.type];
      if (fn) out += fn(t);
      else if (t.type === 'text') out += t.text;
      else { blockers.push(t.raw + ' (' + t.text.toLowerCase() + ') has no equivalent in ' + (FLAVORS[target] ? FLAVORS[target].name : target) + ' replacement text.'); out += t.raw; }
    }
    if (target !== 'js' && out !== tpl) changes.push('Replacement references were rewritten for ' + (FLAVORS[target] ? FLAVORS[target].name : target) + '.');
    return { text: out, changes, blockers };
  }

  // ---------- parameterised library entries ----------
  function paramNames(pattern) { const s = new Set(); pattern.replace(/%([A-Za-z_][A-Za-z0-9_]{0,30})%/g, (m0, n) => { s.add(n); return m0; }); return [...s]; }
  function fillParams(pattern, values, mode) {
    return pattern.replace(/%([A-Za-z_][A-Za-z0-9_]{0,30})%/g, (m0, n) => {
      if (!values || !(n in values)) throw new Error('No value was given for the parameter %' + n + '%.');
      const v = String(values[n]);
      return mode && mode[n] === 'raw' ? v : escapeRegex(v);
    });
  }

  // ---------- library and session export / import ----------
  function validateImport(obj) {
    if (!obj || typeof obj !== 'object') throw new Error('The file is not a regex workbench export.');
    if (obj.kind !== 'mvl-regex' || obj.version !== 1) throw new Error('The file is not a version 1 regex workbench export.');
    const items = Array.isArray(obj.items) ? obj.items : [];
    if (items.length > 500) throw new Error('An import can hold at most 500 patterns.');
    return items.map((it, k) => {
      if (!it || typeof it.pattern !== 'string' || it.pattern.length > LIMITS.pattern) throw new Error('Item ' + (k + 1) + ' has no valid pattern.');
      const flags = normFlags(typeof it.flags === 'string' ? it.flags.replace(/[^dgimsuvy]/g, '') : '');
      const str = (x, n) => (typeof x === 'string' ? x.slice(0, n) : '');
      const tests = Array.isArray(it.tests) ? it.tests.slice(0, LIMITS.testCases).filter((t) => t && typeof t.text === 'string').map((t) => ({ text: t.text.slice(0, 2000), expect: t.expect === false ? false : true })) : [];
      return { name: str(it.name, 120) || 'Imported pattern ' + (k + 1), description: str(it.description, 1000), pattern: it.pattern, flags, replacement: str(it.replacement, 2000), tests };
    });
  }

  // ---------- jobs run inside the isolated worker ----------
  function bounded(subject) { const s = String(subject == null ? '' : subject); if (s.length > LIMITS.subject) throw new RangeError('The subject text is longer than ' + LIMITS.subject + ' characters.'); return s; }
  function allMatches(rx, subject, max) {
    const out = []; const uni = rx.unicode || rx.unicodeSets;
    const global = rx.global || rx.sticky;
    rx.lastIndex = 0;
    let truncated = false;
    while (true) {
      const m = rx.exec(subject);
      if (!m) break;
      if (out.length >= max) { truncated = true; break; }
      out.push(m);
      if (!global) break;
      if (m[0] === '') rx.lastIndex = m.index + (uni && subject.codePointAt(m.index) > 0xffff ? 2 : 1);
    }
    return { list: out, truncated };
  }
  function runJob(job, progress) {
    const op = job && job.op;
    const flags = normFlags(job.flags);
    const t0 = now();
    if (op === 'match') {
      const subject = bounded(job.subject);
      const rx = compile(job.pattern, normFlags(flags + 'd'));
      const r = allMatches(rx, subject, Math.min(job.max || LIMITS.matches, LIMITS.matches));
      const names = rx.source ? Object.keys(r.list[0] && r.list[0].groups || {}) : [];
      return {
        matches: r.list.map((m) => ({ index: m.index, end: m.index + m[0].length, text: m[0], groups: m.indices.slice(1).map((x, k) => (x ? { start: x[0], end: x[1], text: m[k + 1] } : null)), named: m.groups ? Object.fromEntries(Object.keys(m.groups).map((n) => [n, m.groups[n] == null ? null : m.groups[n]])) : null })),
        truncated: r.truncated, names, ms: now() - t0
      };
    }
    if (op === 'replace') {
      const subject = bounded(job.subject);
      const tpl = String(job.replacement == null ? '' : job.replacement).slice(0, 10000);
      const rx = compile(job.pattern, flags);
      const result = subject.replace(rx, tpl);
      const p = parse(job.pattern, flags);
      const toks = parseTemplate(tpl, p.groups, p.names);
      const r = allMatches(compile(job.pattern, flags), subject, LIMITS.replacePieces);
      let rebuilt = '', last = 0;
      const pieces = r.list.map((m) => { const out = expandTemplate(toks, m, subject, p.names); rebuilt += subject.slice(last, m.index) + out; last = m.index + m[0].length; return { index: m.index, end: last, from: m[0], to: out }; });
      rebuilt += subject.slice(last);
      return { result, pieces, truncated: r.truncated, verified: !r.truncated && rebuilt === result, template: toks, count: r.list.length, ms: now() - t0 };
    }
    if (op === 'split') {
      const subject = bounded(job.subject);
      const lim = job.limit == null || job.limit === '' ? undefined : Math.max(0, Math.min(LIMITS.splitParts, job.limit | 0));
      const parts = subject.split(compile(job.pattern, flags), lim === undefined ? LIMITS.splitParts + 1 : lim);
      const truncated = lim === undefined && parts.length > LIMITS.splitParts;
      return { parts: truncated ? parts.slice(0, LIMITS.splitParts) : parts, truncated, ms: now() - t0 };
    }
    if (op === 'tests') {
      const cases = (job.cases || []).slice(0, LIMITS.testCases);
      const rx = compile(job.pattern, flags.replace(/[gy]/g, ''));
      return { results: cases.map((c) => { const got = rx.test(String(c.text)); return { text: c.text, expect: !!c.expect, got, pass: got === !!c.expect }; }), ms: now() - t0 };
    }
    if (op === 'trace') return trace(job.pattern, flags, String(job.subject || ''), { from: job.from | 0 });
    if (op === 'bench') {
      const subject = bounded(job.subject);
      const pats = (job.patterns || []).slice(0, LIMITS.benchPatterns);
      const budget = Math.min(job.budgetMs || LIMITS.benchBudgetMs, LIMITS.benchBudgetMs);
      const each = budget / Math.max(1, pats.length);
      return {
        results: pats.map((pt) => {
          const rx = compile(pt.pattern, normFlags(pt.flags).replace(/[gy]/g, ''));
          let runs = 0, matched = null; const s0 = now();
          do { matched = rx.exec(subject) !== null; runs++; } while (now() - s0 < each && runs < 1e7);
          const total = now() - s0;
          return { pattern: pt.pattern, flags: normFlags(pt.flags), runs, totalMs: total, perRunMs: total / runs, matched };
        }), budgetMs: budget
      };
    }
    if (op === 'growth') {
      const rx = compile(job.pattern, flags.replace(/[gy]/g, ''));
      const unit = String(job.unit || 'a').slice(0, 100) || 'a';
      const prefix = String(job.prefix || '').slice(0, 1000), suffix = String(job.suffix || '').slice(0, 1000);
      const budget = Math.min(job.budgetMs || LIMITS.benchBudgetMs, LIMITS.benchBudgetMs);
      const series = []; const s0 = now(); let size = 1; let stopped = '';
      while (size <= LIMITS.growthMaxSize) {
        const subject = prefix + unit.repeat(size) + suffix;
        const t = now(); const matched = rx.test(subject); const ms = now() - t;
        series.push({ size, length: subject.length, ms, matched });
        if (progress) progress({ size, length: subject.length, ms, matched });
        if (now() - s0 > budget) { stopped = 'Stopped at the time budget of ' + budget + ' ms.'; break; }
        if (ms > budget / 4) { stopped = 'Stopped because one run took ' + ms.toFixed(1) + ' ms.'; break; }
        size = size < 16 ? size + 1 : size * 2;
      }
      return { series, stopped, verdict: growthVerdict(series) };
    }
    if (op === 'grep') {
      const files = (job.files || []).slice(0, LIMITS.grepFiles);
      const rx = compile(job.pattern, normFlags(flags + 'g'));
      const max = Math.min(job.max || LIMITS.grepResults, LIMITS.grepResults);
      const results = []; const perFile = []; let total = 0; let truncated = false;
      for (const f of files) {
        const text = String(f.text || '');
        if (text.length > LIMITS.grepFileChars) { perFile.push({ name: f.name, count: 0, skipped: 'Larger than ' + LIMITS.grepFileChars + ' characters' }); continue; }
        total += text.length;
        if (total > LIMITS.grepTotalChars) { perFile.push({ name: f.name, count: 0, skipped: 'The total size limit was reached' }); truncated = true; continue; }
        const lineStarts = [0]; for (let k = 0; k < text.length; k++) if (text[k] === '\n') lineStarts.push(k + 1);
        const r = allMatches(rx, text, max - results.length + 1);
        let count = 0;
        for (const m of r.list) {
          if (results.length >= max) { truncated = true; break; }
          let lo = 0, hi = lineStarts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= m.index) lo = mid; else hi = mid - 1; }
          const ls = lineStarts[lo]; const le = text.indexOf('\n', ls); const line = text.slice(ls, le < 0 ? text.length : le).replace(/\r$/, '');
          results.push({ file: f.name, line: lo + 1, col: m.index - ls + 1, text: line.slice(0, 400), match: m[0].slice(0, 200), at: m.index - ls });
          count++;
        }
        perFile.push({ name: f.name, count });
        if (truncated) break;
      }
      return { results, perFile, truncated, ms: now() - t0 };
    }
    throw new Error('Unknown job: ' + op);
  }
  function growthVerdict(series) {
    const big = series.filter((s) => s.ms > 0.05);
    if (big.length < 3) return 'Too fast to measure growth on this input: every run took under 0.05 ms.';
    const a = big[big.length - 3], b = big[big.length - 1];
    const sizeRatio = b.size / a.size, timeRatio = b.ms / Math.max(a.ms, 0.001);
    if (b.size - a.size <= 4 && timeRatio > 1.8) return 'Time grows exponentially with input length: a few more characters multiplied the time by ' + timeRatio.toFixed(1) + '.';
    if (timeRatio > sizeRatio * sizeRatio * 0.8) return 'Time grows faster than the square of the input length (factor ' + timeRatio.toFixed(1) + ' for ' + sizeRatio.toFixed(1) + ' times the input).';
    if (timeRatio > sizeRatio * 2) return 'Time grows faster than linearly (factor ' + timeRatio.toFixed(1) + ' for ' + sizeRatio.toFixed(1) + ' times the input).';
    return 'Time grows roughly linearly with input length.';
  }

  // ---------- isolated runner with a time budget ----------
  // factory() returns a browser Worker or a Node worker_threads Worker running regex-worker.js.
  // A job that exceeds its budget terminates the worker; the next job starts a fresh one.
  function createRunner(factory, defaults) {
    const budgetDefault = (defaults && defaults.budgetMs) || 1500;
    let w = null, pending = null, seq = 0;
    function finish(res) { if (!pending) return; const p = pending; pending = null; clearTimeout(p.timer); p.resolve(res); }
    function spawn() {
      w = factory();
      const onMsg = (data) => { if (pending && data && data.id === pending.id) { if (data.progress) { if (pending.onProgress) pending.onProgress(data.progress); } else finish(data); } };
      const onErr = (e) => { const msg = (e && (e.message || e.toString())) || 'The worker stopped.'; kill(); finish({ ok: false, error: 'The isolated worker failed: ' + msg }); };
      if (typeof w.on === 'function') { w.on('message', onMsg); w.on('error', onErr); }
      else { w.onmessage = (e) => onMsg(e.data); w.onerror = (e) => { if (e.preventDefault) e.preventDefault(); onErr(e); }; }
    }
    function kill() { if (w) { try { w.terminate(); } catch { /* already gone */ } w = null; } }
    return {
      run(job, budgetMs, onProgress) {
        if (pending) { kill(); finish({ ok: false, cancelled: true, error: 'Replaced by a newer run.' }); }
        if (!w) { try { spawn(); } catch (e) { w = null; return Promise.resolve({ ok: false, unavailable: true, error: 'The isolated worker could not start here (' + e.message + '), so nothing was run. Patterns are never run on the interface thread instead.' }); } }
        const id = ++seq; const budget = budgetMs || budgetDefault;
        return new Promise((resolve) => {
          pending = { id, resolve, onProgress, timer: setTimeout(() => { kill(); finish({ ok: false, timeout: true, error: 'Stopped after ' + budget + ' ms. The pattern took too long on this text, which usually means catastrophic backtracking. The isolated worker was stopped and the interface stayed responsive.' }); }, budget) };
          try { w.postMessage(Object.assign({}, job, { id })); } catch (e) { finish({ ok: false, error: 'The job could not be sent: ' + e.message }); }
        });
      },
      cancel() { if (pending) { kill(); finish({ ok: false, cancelled: true, error: 'Cancelled.' }); } },
      dispose() { this.cancel(); kill(); },
      busy: () => !!pending
    };
  }

  function codePoints(text, max) {
    const out = []; let n = 0;
    for (const ch of String(text)) {
      if (n++ >= (max || 200)) break;
      const c = ch.codePointAt(0);
      const bytes = typeof TextEncoder !== 'undefined' ? [...new TextEncoder().encode(ch)].map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ') : '';
      out.push({ ch, cp: hex(c), utf8: bytes, utf16: ch.length === 2 ? ch.charCodeAt(0).toString(16).toUpperCase() + ' ' + ch.charCodeAt(1).toString(16).toUpperCase() : c.toString(16).toUpperCase().padStart(4, '0') });
    }
    return out;
  }
  function lineEndings(text) {
    const crlf = (text.match(/\r\n/g) || []).length;
    const lf = (text.match(/\n/g) || []).length - crlf;
    const cr = (text.match(/\r(?!\n)/g) || []).length;
    return { crlf, lf, cr };
  }

  return {
    LIMITS, FLAG_INFO, FLAG_ORDER, LANGS, FLAVORS, MATRIX,
    normFlags, compile, validate, engineInfo, parse, explain, explainText, nodeAt, diagnose, riskOf,
    parseTemplate, expandTemplate, trace, escapeRegex, codeFor, compare, convert, convertReplacement,
    features, paramNames, fillParams, validateImport, runJob, createRunner, codePoints, lineEndings, growthVerdict
  };
});
