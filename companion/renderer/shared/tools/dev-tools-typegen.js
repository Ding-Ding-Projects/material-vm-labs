'use strict';
// Developer tools engine: a strict and lenient JSON parser that keeps key order and exact error
// positions, a document model for the JSON editor, a JSONPath subset, type inference that merges
// one or many samples, and type generators for TypeScript, C#, Python, Go, Rust, Java, Kotlin,
// Swift and JSON Schema. Pure functions only: no DOM, no network. Loaded as a classic script in
// the companions (window.MVLTypegen), inside a worker (self.MVLTypegen) and by the node tests
// (module.exports).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MVLTypegen = api;
})(typeof self !== 'undefined' ? self : this, function () {
  // ---------------------------------------------------------------------------------------------
  // Parser. Nodes: { t: 'object', entries: [{ k, v }] } | { t: 'array', items: [] } |
  // { t: 'string', v } | { t: 'number', v, raw } | { t: 'boolean', v } | { t: 'null' }.
  // ---------------------------------------------------------------------------------------------
  function lineCol(text, offset) {
    let line = 1, col = 1;
    for (let i = 0; i < offset && i < text.length; i++) { if (text[i] === '\n') { line++; col = 1; } else col++; }
    return { line, col };
  }
  class ParseError extends Error {
    constructor(message, text, offset) {
      const lc = lineCol(text, offset);
      super(`${message} at line ${lc.line}, column ${lc.col}`);
      this.reason = message; this.offset = offset; this.line = lc.line; this.col = lc.col;
    }
  }

  function parse(text, opts) {
    const lenient = !!(opts && opts.lenient);
    text = String(text == null ? '' : text);
    let i = 0;
    const notes = [];
    const fail = (msg, at) => { throw new ParseError(msg, text, at == null ? i : at); };
    const ws = () => {
      for (;;) {
        const c = text[i];
        if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '﻿') { i++; continue; }
        if (c === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) {
          if (!lenient) fail('Comments are not allowed in strict JSON (turn on lenient import to accept them)');
          if (text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; }
          else { const end = text.indexOf('*/', i + 2); if (end < 0) fail('Unclosed comment'); i = end + 2; }
          continue;
        }
        return;
      }
    };
    const describe = (c) => (c === undefined ? 'the end of the text' : `"${c}"`);
    function value() {
      ws();
      const c = text[i];
      if (c === '{') return object();
      if (c === '[') return array();
      if (c === '"') return { t: 'string', v: string() };
      if (c === '-' || (c >= '0' && c <= '9')) return number();
      if (text.startsWith('true', i)) { i += 4; return { t: 'boolean', v: true }; }
      if (text.startsWith('false', i)) { i += 5; return { t: 'boolean', v: false }; }
      if (text.startsWith('null', i)) { i += 4; return { t: 'null' }; }
      if (c === "'" && lenient) return { t: 'string', v: string("'") };
      return fail(`Expected a value but found ${describe(c)}`);
    }
    function string(q) {
      q = q || '"';
      const start = i; i++;
      let out = '';
      for (;;) {
        const c = text[i];
        if (c === undefined) fail('Unclosed string', start);
        if (c === q) { i++; return out; }
        if (c === '\\') {
          const e = text[i + 1];
          const map = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', "'": "'" };
          if (e === 'u') {
            const h = text.slice(i + 2, i + 6);
            if (!/^[0-9a-fA-F]{4}$/.test(h)) fail('Invalid unicode escape', i);
            out += String.fromCharCode(parseInt(h, 16)); i += 6; continue;
          }
          if (e in map && (e !== "'" || lenient)) { out += map[e]; i += 2; continue; }
          fail('Invalid escape sequence', i);
        }
        if (c < ' ') fail('Control character in string (escape it as \\n, \\t and so on)');
        out += c; i++;
      }
    }
    function number() {
      const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i, i + 400));
      if (!m) fail('Invalid number');
      i += m[0].length;
      return { t: 'number', v: Number(m[0]), raw: m[0] };
    }
    function object() {
      const start = i; i++;
      const entries = []; const seen = new Map();
      ws();
      if (text[i] === '}') { i++; return { t: 'object', entries }; }
      for (;;) {
        ws();
        if (text[i] !== '"' && !(lenient && text[i] === "'")) fail(`Expected a property name in double quotes but found ${describe(text[i])}`);
        const kAt = i;
        const k = string(text[i]);
        ws();
        if (text[i] !== ':') fail(`Expected ":" after the property name but found ${describe(text[i])}`);
        i++;
        const v = value();
        if (seen.has(k)) { notes.push({ message: `Duplicate key "${k}"; the last value is kept`, offset: kAt, ...lineCol(text, kAt) }); entries[seen.get(k)].v = v; }
        else { seen.set(k, entries.length); entries.push({ k, v }); }
        ws();
        if (text[i] === ',') {
          i++; ws();
          if (text[i] === '}') { if (!lenient) fail('Trailing comma before "}" (turn on lenient import to accept it)', i); i++; return { t: 'object', entries }; }
          continue;
        }
        if (text[i] === '}') { i++; return { t: 'object', entries }; }
        if (text[i] === undefined) fail('Unclosed object', start);
        fail(`Expected "," or "}" but found ${describe(text[i])}`);
      }
    }
    function array() {
      const start = i; i++;
      const items = [];
      ws();
      if (text[i] === ']') { i++; return { t: 'array', items }; }
      for (;;) {
        items.push(value());
        ws();
        if (text[i] === ',') {
          i++; ws();
          if (text[i] === ']') { if (!lenient) fail('Trailing comma before "]" (turn on lenient import to accept it)', i); i++; return { t: 'array', items }; }
          continue;
        }
        if (text[i] === ']') { i++; return { t: 'array', items }; }
        if (text[i] === undefined) fail('Unclosed array', start);
        fail(`Expected "," or "]" but found ${describe(text[i])}`);
      }
    }
    try {
      ws();
      if (i >= text.length) fail('The text is empty');
      const node = value();
      ws();
      if (i < text.length) fail(`Unexpected ${describe(text[i])} after the end of the document`);
      return { ok: true, node, notes };
    } catch (e) {
      if (e instanceof ParseError) return { ok: false, error: { message: e.message, reason: e.reason, offset: e.offset, line: e.line, col: e.col } };
      throw e;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Document model helpers.
  // ---------------------------------------------------------------------------------------------
  function fromValue(v) {
    if (v === null || v === undefined) return { t: 'null' };
    if (Array.isArray(v)) return { t: 'array', items: v.map(fromValue) };
    if (typeof v === 'object') return { t: 'object', entries: Object.keys(v).map((k) => ({ k, v: fromValue(v[k]) })) };
    if (typeof v === 'number') return { t: 'number', v, raw: Number.isFinite(v) ? String(v) : '0' };
    if (typeof v === 'boolean') return { t: 'boolean', v };
    return { t: 'string', v: String(v) };
  }
  function toValue(n) {
    switch (n.t) {
      case 'object': { const o = {}; for (const e of n.entries) o[e.k] = toValue(e.v); return o; }
      case 'array': return n.items.map(toValue);
      case 'null': return null;
      default: return n.v;
    }
  }
  const clone = (n) => JSON.parse(JSON.stringify(n));
  function stringify(n, indent) {
    const pad = indent == null ? 2 : indent;
    const nl = pad ? '\n' : '';
    const rec = (x, d) => {
      const ind = pad ? ' '.repeat(pad * (d + 1)) : '';
      const end = pad ? ' '.repeat(pad * d) : '';
      switch (x.t) {
        case 'object':
          if (!x.entries.length) return '{}';
          return '{' + nl + x.entries.map((e) => ind + JSON.stringify(e.k) + (pad ? ': ' : ':') + rec(e.v, d + 1)).join(',' + nl) + nl + end + '}';
        case 'array':
          if (!x.items.length) return '[]';
          return '[' + nl + x.items.map((it) => ind + rec(it, d + 1)).join(',' + nl) + nl + end + ']';
        case 'string': return JSON.stringify(x.v);
        case 'number': return x.raw && Number(x.raw) === x.v ? x.raw : (Number.isFinite(x.v) ? String(x.v) : '0');
        case 'boolean': return x.v ? 'true' : 'false';
        default: return 'null';
      }
    };
    return rec(n, 0);
  }
  function getAt(n, path) {
    let cur = n;
    for (const p of path) {
      if (!cur) return undefined;
      if (cur.t === 'object') { const e = cur.entries.find((x) => x.k === p); cur = e && e.v; }
      else if (cur.t === 'array') cur = cur.items[p];
      else return undefined;
    }
    return cur;
  }
  const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
  function pathToJsonPath(path) {
    return '$' + path.map((p) => (typeof p === 'number' ? `[${p}]` : IDENT.test(p) ? '.' + p : `[${JSON.stringify(p)}]`)).join('');
  }
  function pathToPointer(path) { return path.map((p) => '/' + String(p).replace(/~/g, '~0').replace(/\//g, '~1')).join(''); }
  function stats(n) {
    const s = { object: 0, array: 0, string: 0, number: 0, boolean: 0, null: 0, keys: 0, depth: 0 };
    const rec = (x, d) => {
      s[x.t]++; if (d > s.depth) s.depth = d;
      if (x.t === 'object') { s.keys += x.entries.length; x.entries.forEach((e) => rec(e.v, d + 1)); }
      if (x.t === 'array') x.items.forEach((it) => rec(it, d + 1));
    };
    rec(n, 0);
    s.nodes = s.object + s.array + s.string + s.number + s.boolean + s.null;
    return s;
  }
  function sortKeys(n) {
    if (n.t === 'object') return { t: 'object', entries: n.entries.slice().sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0)).map((e) => ({ k: e.k, v: sortKeys(e.v) })) };
    if (n.t === 'array') return { t: 'array', items: n.items.map(sortKeys) };
    return clone(n);
  }
  function removeNulls(n) {
    if (n.t === 'object') return { t: 'object', entries: n.entries.filter((e) => e.v.t !== 'null').map((e) => ({ k: e.k, v: removeNulls(e.v) })) };
    if (n.t === 'array') return { t: 'array', items: n.items.filter((x) => x.t !== 'null').map(removeNulls) };
    return clone(n);
  }

  // ---------------------------------------------------------------------------------------------
  // JSONPath subset: $, .key, ["key"], [n], [-n], [*], .*, ..key, [a:b]. Returns paths.
  // ---------------------------------------------------------------------------------------------
  function parseJsonPath(q) {
    q = String(q || '').trim();
    if (q[0] !== '$') throw new Error('A JSONPath starts with $');
    const steps = []; let i = 1;
    while (i < q.length) {
      if (q.startsWith('..', i)) {
        i += 2;
        if (q[i] === '*') { steps.push({ deep: true, any: true }); i++; continue; }
        if (q[i] === '[') { const r = bracket(); r.deep = true; steps.push(r); continue; }
        const m = /^[A-Za-z_$][\w$-]*/.exec(q.slice(i)); if (!m) throw new Error(`Expected a name after .. at position ${i + 1}`);
        steps.push({ deep: true, key: m[0] }); i += m[0].length; continue;
      }
      if (q[i] === '.') {
        i++;
        if (q[i] === '*') { steps.push({ any: true }); i++; continue; }
        const m = /^[A-Za-z_$][\w$-]*/.exec(q.slice(i)); if (!m) throw new Error(`Expected a name after . at position ${i + 1}`);
        steps.push({ key: m[0] }); i += m[0].length; continue;
      }
      if (q[i] === '[') { steps.push(bracket()); continue; }
      throw new Error(`Unexpected "${q[i]}" at position ${i + 1}`);
    }
    return steps;
    function bracket() {
      const close = q.indexOf(']', i); if (close < 0) throw new Error(`Unclosed [ at position ${i + 1}`);
      let inner = q.slice(i + 1, close).trim();
      if (/^["']/.test(inner)) {
        const quote = inner[0];
        let end = 1, s = '';
        while (end < inner.length && inner[end] !== quote) { if (inner[end] === '\\') end++; s += inner[end]; end++; }
        // A quoted key may contain "]": find the real closing bracket after the quote.
        const realClose = q.indexOf(']', i + 1 + end + 1);
        i = (realClose < 0 ? close : realClose) + 1;
        return { key: s };
      }
      i = close + 1;
      if (inner === '*') return { any: true };
      let m = /^(-?\d*):(-?\d*)$/.exec(inner);
      if (m) return { slice: [m[1] === '' ? null : Number(m[1]), m[2] === '' ? null : Number(m[2])] };
      m = /^-?\d+$/.exec(inner);
      if (m) return { index: Number(inner) };
      throw new Error(`Unsupported selector [${inner}]`);
    }
  }
  function queryJsonPath(n, q) {
    const steps = parseJsonPath(q);
    let cur = [{ node: n, path: [] }];
    const children = (x) => (x.node.t === 'object' ? x.node.entries.map((e) => ({ node: e.v, path: x.path.concat([e.k]) })) : x.node.t === 'array' ? x.node.items.map((it, j) => ({ node: it, path: x.path.concat([j]) })) : []);
    const descendants = (x) => { const out = [x]; for (const c of children(x)) out.push(...descendants(c)); return out; };
    const apply = (x, st) => {
      if (st.any) return children(x);
      if (st.key != null) { if (x.node.t !== 'object') return []; const e = x.node.entries.find((y) => y.k === st.key); return e ? [{ node: e.v, path: x.path.concat([st.key]) }] : []; }
      if (st.index != null) { if (x.node.t !== 'array') return []; const len = x.node.items.length; const j = st.index < 0 ? len + st.index : st.index; return j >= 0 && j < len ? [{ node: x.node.items[j], path: x.path.concat([j]) }] : []; }
      if (st.slice) {
        if (x.node.t !== 'array') return [];
        const len = x.node.items.length; const norm = (v, d) => (v == null ? d : v < 0 ? Math.max(0, len + v) : Math.min(len, v));
        const a = norm(st.slice[0], 0), b = norm(st.slice[1], len); const out = [];
        for (let j = a; j < b; j++) out.push({ node: x.node.items[j], path: x.path.concat([j]) });
        return out;
      }
      return [];
    };
    for (const st of steps) {
      const next = [];
      for (const x of cur) {
        if (st.deep) { for (const d of descendants(x)) next.push(...apply(d, Object.assign({}, st, { deep: false }))); }
        else next.push(...apply(x, st));
      }
      const seen = new Set();
      cur = next.filter((x) => { const k = JSON.stringify(x.path); if (seen.has(k)) return false; seen.add(k); return true; });
    }
    return cur.map((x) => x.path);
  }

  // ---------------------------------------------------------------------------------------------
  // Inference. A "set" records every kind seen at one position across all samples.
  // ---------------------------------------------------------------------------------------------
  const RX = {
    'date-time': /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?([Zz]|[+-]\d{2}:?\d{2})?$/,
    date: /^\d{4}-\d{2}-\d{2}$/,
    time: /^\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/,
    uuid: /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
    uri: /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s]+$/,
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  };
  const FORMATS = Object.keys(RX);
  function detectFormat(s) { for (const f of FORMATS) if (RX[f].test(s)) return f; return null; }
  const newSet = () => ({ n: 0 });
  function addToSet(set, node) {
    set.n++;
    switch (node.t) {
      case 'null': set.null = (set.null || 0) + 1; break;
      case 'boolean': set.bool = (set.bool || 0) + 1; break;
      case 'number': if (/[.eE]/.test(node.raw || String(node.v)) || !Number.isInteger(node.v)) set.float = (set.float || 0) + 1; else set.int = (set.int || 0) + 1; break;
      case 'string': {
        const s = set.string || (set.string = { n: 0, formats: null, values: new Map(), overflow: false });
        s.n++;
        const f = detectFormat(node.v);
        s.formats = s.n === 1 ? (f ? new Set([f]) : new Set()) : new Set([...s.formats].filter((x) => x === f));
        if (!s.overflow) { s.values.set(node.v, (s.values.get(node.v) || 0) + 1); if (s.values.size > 64) { s.overflow = true; s.values.clear(); } }
        break;
      }
      case 'array': { const a = set.array || (set.array = { n: 0, items: newSet() }); a.n++; for (const it of node.items) addToSet(a.items, it); break; }
      case 'object': {
        const o = set.object || (set.object = { n: 0, props: new Map() }); o.n++;
        for (const e of node.entries) {
          let p = o.props.get(e.k); if (!p) { p = { count: 0, set: newSet() }; o.props.set(e.k, p); }
          p.count++; addToSet(p.set, e.v);
        }
        break;
      }
    }
  }

  // Naming helpers shared by inference and generators.
  function words(s) {
    return String(s).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).filter(Boolean);
  }
  const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  function pascal(s) { const w = words(s); return w.length ? w.map(cap).join('') : ''; }
  function camel(s) { const p = pascal(s); return p.charAt(0).toLowerCase() + p.slice(1); }
  function snake(s) { return words(s).map((w) => w.toLowerCase()).join('_'); }
  function singular(s) {
    if (/ies$/i.test(s) && s.length > 4) return s.slice(0, -3) + 'y';
    if (/(ss|us|is)$/i.test(s)) return s;
    if (/(x|ch|sh)es$/i.test(s)) return s.slice(0, -2);
    if (/s$/i.test(s) && s.length > 2) return s.slice(0, -1);
    return s;
  }

  const DEFAULTS = { topName: 'Root', enums: true, maxEnum: 8, formats: true, maps: true, allOptional: false };

  // infer(samples: node[], options) -> { top, classes, enums, unions, samples }
  function infer(samples, options) {
    const o = Object.assign({}, DEFAULTS, options || {});
    const root = newSet();
    for (const s of samples) addToSet(root, s);
    const classes = []; const enums = []; const used = new Set();
    const uniq = (base) => { let b = pascal(base) || 'Type'; if (/^\d/.test(b)) b = 'T' + b; let n = b, k = 2; while (used.has(n)) n = b + k++; used.add(n); return n; };
    const sigs = new Map();
    function finish(set, nameHint) {
      const kinds = [];
      if (set.bool) kinds.push({ k: 'bool' });
      if (set.int && set.float) kinds.push({ k: 'float' });
      else if (set.int) kinds.push({ k: 'int' });
      else if (set.float) kinds.push({ k: 'float' });
      if (set.string) {
        const s = set.string;
        const fmt = o.formats && s.formats && s.formats.size === 1 ? [...s.formats][0] : null;
        const distinct = s.values.size;
        const enumOk = o.enums && !fmt && !s.overflow && distinct >= 2 && distinct <= o.maxEnum && s.n > distinct && [...s.values.keys()].every((v) => v.length > 0 && v.length <= 40 && /[A-Za-z]/.test(v));
        if (enumOk) {
          const values = [...s.values.keys()];
          const sig = 'E' + JSON.stringify(values.slice().sort());
          let name = sigs.get(sig);
          if (!name) { name = uniq(nameHint); sigs.set(sig, name); enums.push({ name, values }); }
          kinds.push({ k: 'enum', ref: name });
        } else kinds.push(fmt ? { k: 'string', format: fmt } : { k: 'string' });
      }
      if (set.array) kinds.push({ k: 'array', items: finish(set.array.items, singular(nameHint) === nameHint ? nameHint + 'Item' : singular(nameHint)) });
      if (set.object) {
        const ob = set.object;
        const keys = [...ob.props.keys()];
        const looksLikeMap = o.maps && keys.length > 0 && (keys.every((k) => !/^[A-Za-z_]/.test(k)) || (keys.length >= 20 && keys.every((k) => ob.props.get(k).count === 1)));
        if (looksLikeMap) {
          const merged = newSet();
          for (const k of keys) mergeSets(merged, ob.props.get(k).set);
          kinds.push({ k: 'map', values: finish(merged, singular(nameHint) + 'Value') });
        } else {
          const name = uniq(nameHint);
          const cls = { name, props: [] };
          classes.push(cls);
          for (const k of keys) {
            const p = ob.props.get(k);
            cls.props.push({ key: k, type: finish(p.set, k), optional: o.allOptional || p.count < ob.n });
          }
          // Reuse an earlier class with exactly the same shape.
          const sig = 'C' + JSON.stringify(cls.props.map((p) => [p.key, typeKey(p.type), p.optional]));
          const prev = sigs.get(sig);
          if (prev) { classes.splice(classes.indexOf(cls), 1); used.delete(name); kinds.push({ k: 'class', ref: prev }); }
          else { sigs.set(sig, name); kinds.push({ k: 'class', ref: name }); }
        }
      }
      const nullable = !!set.null;
      if (!kinds.length) return { k: set.null ? 'null' : 'any', nullable: false };
      if (kinds.length === 1) return Object.assign(kinds[0], { nullable });
      return { k: 'union', members: kinds.map((x) => Object.assign(x, { nullable: false })), nullable };
    }
    const top = finish(root, o.topName);
    // Classes are listed with the top type first, then in discovery order.
    return { top, classes, enums, sampleCount: samples.length, topName: o.topName };
  }
  function mergeSets(into, from) {
    into.n += from.n;
    for (const k of ['null', 'bool', 'int', 'float']) if (from[k]) into[k] = (into[k] || 0) + from[k];
    if (from.string) {
      const s = into.string || (into.string = { n: 0, formats: null, values: new Map(), overflow: false });
      s.formats = s.n === 0 ? new Set(from.string.formats) : new Set([...s.formats].filter((f) => from.string.formats.has(f)));
      s.n += from.string.n; s.overflow = s.overflow || from.string.overflow;
      if (!s.overflow) for (const [v, c] of from.string.values) s.values.set(v, (s.values.get(v) || 0) + c);
    }
    if (from.array) { const a = into.array || (into.array = { n: 0, items: newSet() }); a.n += from.array.n; mergeSets(a.items, from.array.items); }
    if (from.object) {
      const ob = into.object || (into.object = { n: 0, props: new Map() }); ob.n += from.object.n;
      for (const [k, p] of from.object.props) { let q = ob.props.get(k); if (!q) { q = { count: 0, set: newSet() }; ob.props.set(k, q); } q.count += p.count; mergeSets(q.set, p.set); }
    }
  }
  function typeKey(t) {
    if (!t) return '?';
    const n = t.nullable ? '?' : '';
    if (t.k === 'array') return '[' + typeKey(t.items) + ']' + n;
    if (t.k === 'map') return '{' + typeKey(t.values) + '}' + n;
    if (t.k === 'class' || t.k === 'enum') return t.k + ':' + t.ref + n;
    if (t.k === 'union') return '(' + t.members.map(typeKey).join('|') + ')' + n;
    return t.k + (t.format ? '<' + t.format + '>' : '') + n;
  }
  // A language-neutral description of a type for the inferred-types inspector.
  function describeType(t) {
    const base = (() => {
      switch (t.k) {
        case 'array': return 'list of ' + describeType(t.items);
        case 'map': return 'map of text to ' + describeType(t.values);
        case 'class': return t.ref;
        case 'enum': return t.ref + ' (enum)';
        case 'union': return t.members.map(describeType).join(' or ');
        case 'int': return 'integer';
        case 'float': return 'number';
        case 'bool': return 'boolean';
        case 'string': return t.format ? `text (${t.format})` : 'text';
        case 'null': return 'always null';
        default: return 'any value';
      }
    })();
    return t.nullable ? base + ', or null' : base;
  }

  // ---------------------------------------------------------------------------------------------
  // Generators.
  // ---------------------------------------------------------------------------------------------
  const GEN_DEFAULTS = { naming: 'idiomatic', optionalAs: 'optional', readonly: false, typedHints: true, indent: 4 };
  const RESERVED = {
    typescript: 'break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with',
    csharp: 'abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using virtual void volatile while',
    python: 'False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield',
    go: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var',
    rust: 'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while',
    java: 'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null record',
    kotlin: 'as break class continue do else false for fun if in interface is null object package return super this throw true try typealias typeof val var when while',
    swift: 'associatedtype class deinit enum extension fileprivate func import init inout internal let open operator private protocol public rethrows static struct subscript typealias var break case continue default defer do else fallthrough for guard if in repeat return switch where while as Any catch false is nil super self Self throw throws true try'
  };
  const RES = {}; for (const k of Object.keys(RESERVED)) RES[k] = new Set(RESERVED[k].split(' '));
  const IDIOM = { typescript: 'keep', csharp: 'pascal', python: 'snake', go: 'pascal', rust: 'snake', java: 'camel', kotlin: 'camel', swift: 'camel' };
  function propName(lang, key, naming) {
    let style = naming === 'idiomatic' || !naming ? IDIOM[lang] : naming;
    if (lang === 'go') style = 'pascal'; // Go only serializes exported (capitalised) fields
    let n;
    if (style === 'keep') n = String(key).replace(/[^A-Za-z0-9_]/g, '_');
    else n = style === 'pascal' ? pascal(key) : style === 'snake' ? snake(key) : camel(key);
    if (!n) n = 'field';
    if (/^\d/.test(n)) n = (style === 'pascal' ? 'The' : style === 'snake' ? 'the_' : 'the') + n;
    if (RES[lang] && RES[lang].has(n)) n = lang === 'rust' ? 'r#' + n : lang === 'python' || lang === 'go' ? n + '_' : lang === 'csharp' ? '@' + n : lang === 'kotlin' || lang === 'swift' ? '`' + n + '`' : n + '_';
    return n;
  }
  const bare = (n) => n.replace(/^r#|^@|`/g, '');
  const q = (s) => JSON.stringify(String(s));
  const hintOf = (t) => (t.k === 'string' && t.format ? t.format : t.k === 'array' ? hintOf(t.items) : null);

  // Collect the generated union helper types (Rust and Swift) with stable names.
  function unionName(t, hint) { return pascal(hint) + 'Union'; }

  function generate(lang, ir, options) {
    const o = Object.assign({}, GEN_DEFAULTS, options || {});
    const fn = GENERATORS[lang];
    if (!fn) throw new Error('Unknown language: ' + lang);
    return fn(ir, o).replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim() + '\n';
  }
  const ind = (o, n) => ' '.repeat((o.indent || 4) * (n || 1));
  const enumMember = (v, style) => { let n = style === 'upper' ? snake(v).toUpperCase() : style === 'camel' ? camel(v) : pascal(v); if (!n) n = 'Value'; if (/^\d/.test(n)) n = (style === 'upper' ? 'V_' : 'V') + n; return n; };

  const GENERATORS = {
    typescript(ir, o) {
      const t = (x) => {
        let s;
        switch (x.k) {
          case 'array': { const it = t(x.items); s = (/[|&]/.test(it) ? `(${it})` : it) + '[]'; if (o.readonly) s = 'readonly ' + s; break; }
          case 'map': s = `{ ${o.readonly ? 'readonly ' : ''}[key: string]: ${t(x.values)} }`; break;
          case 'class': case 'enum': s = x.ref; break;
          case 'union': s = x.members.map(t).join(' | '); break;
          case 'int': case 'float': s = 'number'; break;
          case 'bool': s = 'boolean'; break;
          case 'string': s = 'string'; break;
          case 'null': s = 'null'; break;
          default: s = 'unknown';
        }
        return x.nullable ? s + ' | null' : s;
      };
      const out = ['// Generated by Material VM Labs from ' + ir.sampleCount + ' JSON sample' + (ir.sampleCount === 1 ? '' : 's') + '.', ''];
      for (const e of ir.enums) out.push(`export type ${e.name} = ${e.values.map(q).join(' | ')};`, '');
      for (const c of ir.classes) {
        out.push(`export interface ${c.name} {`);
        for (const p of c.props) {
          const key = IDENT.test(p.key) ? p.key : q(p.key);
          const h = hintOf(p.type);
          let ty = t(p.type);
          let opt = '';
          if (p.optional) { if (o.optionalAs === 'nullable') { if (!p.type.nullable) ty += ' | null'; } else opt = '?'; }
          out.push(`${ind(o)}${o.readonly ? 'readonly ' : ''}${key}${opt}: ${ty};${h && o.typedHints ? ' // ' + h : ''}`);
        }
        out.push('}', '');
      }
      if (!ir.top.k || ir.top.k !== 'class') out.push(`export type ${pascal(ir.topName || 'Root') || 'Root'} = ${t(ir.top)};`);
      return out.join('\n');
    },

    csharp(ir, o) {
      const t = (x) => {
        let s, value = true;
        switch (x.k) {
          case 'array': s = `List<${t(x.items)}>`; value = false; break;
          case 'map': s = `Dictionary<string, ${t(x.values)}>`; value = false; break;
          case 'class': s = x.ref; value = false; break;
          case 'enum': s = x.ref; break;
          case 'union': case 'any': case 'null': s = 'JsonElement'; break;
          case 'int': s = 'long'; break;
          case 'float': s = 'double'; break;
          case 'bool': s = 'bool'; break;
          case 'string':
            if (o.typedHints && x.format === 'date-time') s = 'DateTimeOffset';
            else if (o.typedHints && x.format === 'uuid') s = 'Guid';
            else if (o.typedHints && x.format === 'uri') { s = 'Uri'; value = false; }
            else { s = 'string'; value = false; }
            break;
          default: s = 'JsonElement';
        }
        return x.nullable || x.k === 'null' ? s + '?' : s;
      };
      const out = ['// Generated by Material VM Labs. Uses System.Text.Json (.NET 9 or later for enum member names).', 'using System;', 'using System.Collections.Generic;', 'using System.Text.Json;', 'using System.Text.Json.Serialization;', '', 'namespace Generated;', ''];
      for (const e of ir.enums) {
        out.push('[JsonConverter(typeof(JsonStringEnumConverter))]', `public enum ${e.name}`, '{');
        e.values.forEach((v, i) => out.push(`${ind(o)}[JsonStringEnumMemberName(${q(v)})] ${enumMember(v)}${i < e.values.length - 1 ? ',' : ''}`));
        out.push('}', '');
      }
      for (const c of ir.classes) {
        out.push(`public ${o.readonly ? 'sealed record' : 'class'} ${c.name}`, '{');
        for (const p of c.props) {
          let ty = t(p.type); if (p.optional && !ty.endsWith('?')) ty += '?';
          const n = propName('csharp', p.key, o.naming);
          out.push(`${ind(o)}[JsonPropertyName(${q(p.key)})]`);
          out.push(`${ind(o)}public ${ty} ${n === c.name ? n + 'Value' : n} { get; ${o.readonly ? 'init' : 'set'}; }`, '');
        }
        if (out[out.length - 1] === '') out.pop();
        out.push('}', '');
      }
      return out.join('\n');
    },

    python(ir, o) {
      let usesAny = false, usesEnum = false;
      const t = (x) => {
        let s;
        switch (x.k) {
          case 'array': s = `list[${t(x.items)}]`; break;
          case 'map': s = `dict[str, ${t(x.values)}]`; break;
          case 'class': case 'enum': s = x.ref; break;
          case 'union': s = x.members.map(t).join(' | '); break;
          case 'int': s = 'int'; break;
          case 'float': s = 'float'; break;
          case 'bool': s = 'bool'; break;
          case 'string': s = 'str'; break;
          case 'null': s = 'None'; break;
          default: usesAny = true; s = 'Any';
        }
        return x.nullable ? s + ' | None' : s;
      };
      // Converter expression from a JSON value to the declared type.
      const conv = (x, e) => {
        if (x.k === 'class' || x.k === 'enum') { const c = `${x.ref}${x.k === 'class' ? '.from_dict' : ''}(${e})`; return x.nullable ? `${c} if ${e} is not None else None` : c; }
        if (x.k === 'array') { const inner = conv(Object.assign({}, x.items), 'v'); if (inner === 'v') return e; const c = `[${inner} for v in ${e}]`; return x.nullable ? `${c} if ${e} is not None else None` : c; }
        if (x.k === 'map') { const inner = conv(Object.assign({}, x.values), 'v'); if (inner === 'v') return e; const c = `{k: ${inner} for k, v in ${e}.items()}`; return x.nullable ? `${c} if ${e} is not None else None` : c; }
        return e;
      };
      const body = [];
      for (const e of ir.enums) {
        usesEnum = true;
        body.push(`class ${e.name}(Enum):`);
        for (const v of e.values) body.push(`${ind(o)}${enumMember(v, 'upper')} = ${q(v)}`);
        body.push('', '');
      }
      // Classes are emitted in reverse discovery order so that nested classes come first.
      for (const c of ir.classes.slice().reverse()) {
        body.push(`@dataclass${o.readonly ? '(frozen=True)' : ''}`, `class ${c.name}:`);
        const req = c.props.filter((p) => !p.optional), opt = c.props.filter((p) => p.optional);
        if (!c.props.length) body.push(`${ind(o)}pass`);
        for (const p of req.concat(opt)) {
          let ty = t(p.type); if (p.optional && !/(\| None|^None)$/.test(ty)) ty += ' | None';
          const h = hintOf(p.type);
          body.push(`${ind(o)}${propName('python', p.key, o.naming)}: ${ty}${p.optional ? ' = None' : ''}${h && o.typedHints ? '  # ' + h : ''}`);
        }
        body.push('', `${ind(o)}@classmethod`, `${ind(o)}def from_dict(cls, d: dict) -> "${c.name}":`);
        body.push(`${ind(o, 2)}return cls(`);
        for (const p of req.concat(opt)) {
          const get = p.optional ? `d.get(${q(p.key)})` : `d[${q(p.key)}]`;
          let expr = conv(p.type, get);
          if (p.optional && expr !== get) expr = `${conv(Object.assign({}, p.type, { nullable: false }), get)} if ${get} is not None else None`;
          body.push(`${ind(o, 3)}${propName('python', p.key, o.naming)}=${expr},`);
        }
        body.push(`${ind(o, 2)})`, '', '');
      }
      const head = ['# Generated by Material VM Labs. Python 3.10 or later.', 'from __future__ import annotations', '', 'from dataclasses import dataclass'];
      if (usesEnum) head.push('from enum import Enum');
      if (usesAny) head.push('from typing import Any');
      return head.concat(['', '']).concat(body).join('\n');
    },

    go(ir, o) {
      let usesTime = false;
      const t = (x) => {
        let s, ptrable = true;
        switch (x.k) {
          case 'array': s = '[]' + t(x.items); ptrable = false; break;
          case 'map': s = 'map[string]' + t(x.values); ptrable = false; break;
          case 'class': case 'enum': s = x.ref; break;
          case 'union': case 'any': case 'null': s = 'any'; ptrable = false; break;
          case 'int': s = 'int64'; break;
          case 'float': s = 'float64'; break;
          case 'bool': s = 'bool'; break;
          case 'string': if (o.typedHints && x.format === 'date-time') { usesTime = true; s = 'time.Time'; } else s = 'string'; break;
          default: s = 'any'; ptrable = false;
        }
        return x.nullable && ptrable ? '*' + s : s;
      };
      const body = [];
      for (const e of ir.enums) {
        body.push(`type ${e.name} string`, '', 'const (');
        for (const v of e.values) body.push(`\t${e.name}${enumMember(v)} ${e.name} = ${q(v)}`);
        body.push(')', '');
      }
      for (const c of ir.classes) {
        body.push(`type ${c.name} struct {`);
        const rows = c.props.map((p) => {
          let ty = t(p.type);
          if (p.optional && !ty.startsWith('*') && !/^(\[\]|map\[|any$)/.test(ty)) ty = '*' + ty;
          return [propName('go', p.key, o.naming), ty, '`json:' + q(p.key + (p.optional ? ',omitempty' : '')) + '`'];
        });
        const w0 = Math.max(0, ...rows.map((r) => r[0].length)), w1 = Math.max(0, ...rows.map((r) => r[1].length));
        for (const r of rows) body.push(`\t${r[0].padEnd(w0)} ${r[1].padEnd(w1)} ${r[2]}`);
        body.push('}', '');
      }
      const head = ['// Generated by Material VM Labs. Decode with encoding/json.', 'package generated', ''];
      if (usesTime) head.push('import "time"', '');
      return head.concat(body).join('\n');
    },

    rust(ir, o) {
      const unions = new Map();
      const t = (x, hint) => {
        let s;
        switch (x.k) {
          case 'array': s = `Vec<${t(x.items, singular(hint))}>`; break;
          case 'map': s = `HashMap<String, ${t(x.values, hint + 'Value')}>`; break;
          case 'class': case 'enum': s = x.ref; break;
          case 'union': {
            const name = unionName(x, hint);
            if (!unions.has(name)) unions.set(name, x.members.map((m) => [m.k === 'class' || m.k === 'enum' ? m.ref : pascal(m.k === 'int' ? 'integer' : m.k === 'float' ? 'number' : m.k === 'bool' ? 'bool' : m.k === 'string' ? 'string' : m.k === 'array' ? 'list' : m.k === 'map' ? 'map' : 'value'), t(Object.assign({}, m, { nullable: false }), hint)]));
            s = name; break;
          }
          case 'int': s = 'i64'; break;
          case 'float': s = 'f64'; break;
          case 'bool': s = 'bool'; break;
          case 'string': s = 'String'; break;
          default: s = 'serde_json::Value';
        }
        return x.nullable && x.k !== 'any' && x.k !== 'null' ? `Option<${s}>` : s;
      };
      const body = [];
      for (const e of ir.enums) {
        body.push('#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]', `pub enum ${e.name} {`);
        for (const v of e.values) body.push(`${ind(o)}#[serde(rename = ${q(v)})]`, `${ind(o)}${enumMember(v)},`);
        body.push('}', '');
      }
      const structs = [];
      for (const c of ir.classes) {
        const s = ['#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]', `pub struct ${c.name} {`];
        for (const p of c.props) {
          let ty = t(p.type, p.key);
          if (p.optional && !ty.startsWith('Option<') && ty !== 'serde_json::Value') ty = `Option<${ty}>`;
          const n = propName('rust', p.key, o.naming);
          if (bare(n) !== p.key) s.push(`${ind(o)}#[serde(rename = ${q(p.key)})]`);
          if (p.optional) s.push(`${ind(o)}#[serde(default, skip_serializing_if = "${ty === 'serde_json::Value' ? 'serde_json::Value::is_null' : 'Option::is_none'}")]`);
          const h = hintOf(p.type);
          s.push(`${ind(o)}pub ${n}: ${ty},${h && o.typedHints ? ' // ' + h : ''}`);
        }
        s.push('}', '');
        structs.push(...s);
      }
      for (const [name, members] of unions) {
        body.push('#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]', '#[serde(untagged)]', `pub enum ${name} {`);
        for (const [v, ty] of members) body.push(`${ind(o)}${v}(${ty}),`);
        body.push('}', '');
      }
      const all = body.concat(structs).join('\n');
      const head = ['// Generated by Material VM Labs. Requires serde (with derive) and serde_json.', 'use serde::{Deserialize, Serialize};'];
      if (/HashMap</.test(all)) head.push('use std::collections::HashMap;');
      return head.concat(['', all]).join('\n');
    },

    java(ir, o) {
      const imports = new Set(['com.fasterxml.jackson.annotation.JsonProperty']);
      const t = (x, boxed) => {
        switch (x.k) {
          case 'array': imports.add('java.util.List'); return `List<${t(x.items, true)}>`;
          case 'map': imports.add('java.util.Map'); return `Map<String, ${t(x.values, true)}>`;
          case 'class': case 'enum': return x.ref;
          case 'int': return x.nullable || boxed ? 'Long' : 'long';
          case 'float': return x.nullable || boxed ? 'Double' : 'double';
          case 'bool': return x.nullable || boxed ? 'Boolean' : 'boolean';
          case 'string':
            if (o.typedHints && x.format === 'date-time') { imports.add('java.time.OffsetDateTime'); return 'OffsetDateTime'; }
            if (o.typedHints && x.format === 'uuid') { imports.add('java.util.UUID'); return 'UUID'; }
            if (o.typedHints && x.format === 'uri') { imports.add('java.net.URI'); return 'URI'; }
            return 'String';
          default: return 'Object';
        }
      };
      const body = [];
      for (const e of ir.enums) {
        imports.add('com.fasterxml.jackson.annotation.JsonValue');
        body.push(`public enum ${e.name} {`);
        e.values.forEach((v, i) => body.push(`${ind(o)}${enumMember(v, 'upper')}(${q(v)})${i < e.values.length - 1 ? ',' : ';'}`));
        body.push('', `${ind(o)}private final String value;`, `${ind(o)}${e.name}(String value) { this.value = value; }`, `${ind(o)}@JsonValue public String getValue() { return value; }`, '}', '');
      }
      for (const c of ir.classes) {
        const fields = c.props.map((p) => [propName('java', p.key, o.naming), t(Object.assign({}, p.type, { nullable: p.type.nullable || p.optional })), p]);
        if (o.readonly) {
          body.push(`public record ${c.name}(`);
          fields.forEach(([n, ty, p], i) => body.push(`${ind(o)}@JsonProperty(${q(p.key)}) ${ty} ${n}${i < fields.length - 1 ? ',' : ''}`));
          body.push(') {}', '');
        } else {
          body.push(`public class ${c.name} {`);
          for (const [n, ty, p] of fields) body.push(`${ind(o)}@JsonProperty(${q(p.key)})`, `${ind(o)}public ${ty} ${n};`, '');
          if (body[body.length - 1] === '') body.pop();
          body.push('}', '');
        }
      }
      const head = ['// Generated by Material VM Labs. Uses Jackson annotations' + ([...imports].some((x) => x.includes('java.time')) ? '; register JavaTimeModule for dates' : '') + '.', 'package generated;', ''];
      return head.concat([...imports].sort().map((x) => `import ${x};`)).concat(['']).concat(body).join('\n');
    },

    kotlin(ir, o) {
      let usesJson = false;
      const t = (x) => {
        let s;
        switch (x.k) {
          case 'array': s = `List<${t(x.items)}>`; break;
          case 'map': s = `Map<String, ${t(x.values)}>`; break;
          case 'class': case 'enum': s = x.ref; break;
          case 'int': s = 'Long'; break;
          case 'float': s = 'Double'; break;
          case 'bool': s = 'Boolean'; break;
          case 'string': s = 'String'; break;
          default: usesJson = true; s = 'JsonElement';
        }
        return x.nullable || x.k === 'null' ? s + '?' : s;
      };
      const body = [];
      for (const e of ir.enums) {
        body.push('@Serializable', `enum class ${e.name} {`);
        e.values.forEach((v, i) => body.push(`${ind(o)}@SerialName(${q(v)}) ${enumMember(v, 'upper')}${i < e.values.length - 1 ? ',' : ''}`));
        body.push('}', '');
      }
      for (const c of ir.classes) {
        body.push('@Serializable', `data class ${c.name}(`);
        c.props.forEach((p, i) => {
          let ty = t(p.type); if (p.optional && !ty.endsWith('?')) ty += '?';
          const n = propName('kotlin', p.key, o.naming);
          const h = hintOf(p.type);
          body.push(`${ind(o)}${bare(n) !== p.key ? `@SerialName(${q(p.key)}) ` : ''}${o.readonly ? 'val' : 'var'} ${n}: ${ty}${p.optional && o.optionalAs === 'optional' ? ' = null' : ''}${i < c.props.length - 1 ? ',' : ''}${h && o.typedHints ? ' // ' + h : ''}`);
        });
        body.push(')', '');
      }
      const head = ['// Generated by Material VM Labs. Uses kotlinx.serialization.', 'package generated', '', 'import kotlinx.serialization.SerialName', 'import kotlinx.serialization.Serializable'];
      if (usesJson) head.push('import kotlinx.serialization.json.JsonElement');
      return head.concat(['']).concat(body).join('\n');
    },

    swift(ir, o) {
      const unions = new Map(); let usesAny = false, usesDate = false;
      const t = (x, hint) => {
        let s;
        switch (x.k) {
          case 'array': s = `[${t(x.items, singular(hint))}]`; break;
          case 'map': s = `[String: ${t(x.values, hint + 'Value')}]`; break;
          case 'class': case 'enum': s = x.ref; break;
          case 'union': {
            const name = unionName(x, hint);
            if (!unions.has(name)) unions.set(name, x.members.map((m) => [camel(m.k === 'class' || m.k === 'enum' ? m.ref : m.k === 'int' ? 'integer' : m.k === 'float' ? 'double' : m.k === 'bool' ? 'bool' : m.k === 'string' ? 'string' : m.k === 'array' ? 'list' : m.k === 'map' ? 'map' : 'value'), t(Object.assign({}, m, { nullable: false }), hint)]));
            s = name; break;
          }
          case 'int': s = 'Int'; break;
          case 'float': s = 'Double'; break;
          case 'bool': s = 'Bool'; break;
          case 'string':
            if (o.typedHints && x.format === 'uuid') s = 'UUID';
            else if (o.typedHints && x.format === 'uri') s = 'URL';
            else if (o.typedHints && x.format === 'date-time') { usesDate = true; s = 'Date'; }
            else s = 'String';
            break;
          default: usesAny = true; s = 'JSONValue';
        }
        return x.nullable || x.k === 'null' ? s + '?' : s;
      };
      const body = [];
      for (const e of ir.enums) {
        body.push(`enum ${e.name}: String, Codable {`);
        for (const v of e.values) body.push(`${ind(o)}case ${propName('swift', enumMember(v, 'camel'), 'keep')} = ${q(v)}`);
        body.push('}', '');
      }
      const structs = [];
      for (const c of ir.classes) {
        structs.push(`struct ${c.name}: Codable {`);
        const renamed = [];
        for (const p of c.props) {
          let ty = t(p.type, p.key); if (p.optional && !ty.endsWith('?')) ty += '?';
          const n = propName('swift', p.key, o.naming);
          renamed.push([n, p.key]);
          structs.push(`${ind(o)}${o.readonly ? 'let' : 'var'} ${n}: ${ty}`);
        }
        if (renamed.some(([n, k]) => bare(n) !== k)) {
          structs.push('', `${ind(o)}enum CodingKeys: String, CodingKey {`);
          for (const [n, k] of renamed) structs.push(`${ind(o, 2)}case ${n}${bare(n) !== k ? ' = ' + q(k) : ''}`);
          structs.push(`${ind(o)}}`);
        }
        structs.push('}', '');
      }
      for (const [name, members] of unions) {
        body.push(`enum ${name}: Codable {`);
        for (const [c, ty] of members) body.push(`${ind(o)}case ${c}(${ty})`);
        body.push('', `${ind(o)}init(from decoder: Decoder) throws {`, `${ind(o, 2)}let c = try decoder.singleValueContainer()`);
        for (const [c, ty] of members) body.push(`${ind(o, 2)}if let v = try? c.decode(${ty}.self) { self = .${c}(v); return }`);
        body.push(`${ind(o, 2)}throw DecodingError.typeMismatch(${name}.self, DecodingError.Context(codingPath: decoder.codingPath, debugDescription: "No matching type"))`, `${ind(o)}}`, '');
        body.push(`${ind(o)}func encode(to encoder: Encoder) throws {`, `${ind(o, 2)}var c = encoder.singleValueContainer()`, `${ind(o, 2)}switch self {`);
        for (const [c] of members) body.push(`${ind(o, 2)}case .${c}(let v): try c.encode(v)`);
        body.push(`${ind(o, 2)}}`, `${ind(o)}}`, '}', '');
      }
      if (usesAny) {
        body.push('indirect enum JSONValue: Codable {', `${ind(o)}case null, bool(Bool), number(Double), string(String), array([JSONValue]), object([String: JSONValue])`, '',
          `${ind(o)}init(from decoder: Decoder) throws {`, `${ind(o, 2)}let c = try decoder.singleValueContainer()`,
          `${ind(o, 2)}if c.decodeNil() { self = .null }`,
          `${ind(o, 2)}else if let v = try? c.decode(Bool.self) { self = .bool(v) }`,
          `${ind(o, 2)}else if let v = try? c.decode(Double.self) { self = .number(v) }`,
          `${ind(o, 2)}else if let v = try? c.decode(String.self) { self = .string(v) }`,
          `${ind(o, 2)}else if let v = try? c.decode([JSONValue].self) { self = .array(v) }`,
          `${ind(o, 2)}else { self = .object(try c.decode([String: JSONValue].self)) }`, `${ind(o)}}`, '',
          `${ind(o)}func encode(to encoder: Encoder) throws {`, `${ind(o, 2)}var c = encoder.singleValueContainer()`, `${ind(o, 2)}switch self {`,
          `${ind(o, 2)}case .null: try c.encodeNil()`, `${ind(o, 2)}case .bool(let v): try c.encode(v)`, `${ind(o, 2)}case .number(let v): try c.encode(v)`,
          `${ind(o, 2)}case .string(let v): try c.encode(v)`, `${ind(o, 2)}case .array(let v): try c.encode(v)`, `${ind(o, 2)}case .object(let v): try c.encode(v)`,
          `${ind(o, 2)}}`, `${ind(o)}}`, '}', '');
      }
      const head = ['// Generated by Material VM Labs. Decode with JSONDecoder' + (usesDate ? ' and set dateDecodingStrategy = .iso8601' : '') + '.', 'import Foundation', ''];
      return head.concat(body, structs).join('\n');
    },

    jsonschema(ir, o) {
      const s = (x) => {
        let r;
        switch (x.k) {
          case 'array': r = { type: 'array', items: s(x.items) }; break;
          case 'map': r = { type: 'object', additionalProperties: s(x.values) }; break;
          case 'class': case 'enum': r = { $ref: '#/$defs/' + x.ref }; break;
          case 'union': r = { anyOf: x.members.map(s) }; break;
          case 'int': r = { type: 'integer' }; break;
          case 'float': r = { type: 'number' }; break;
          case 'bool': r = { type: 'boolean' }; break;
          case 'string': r = { type: 'string' }; if (x.format) r.format = x.format; break;
          case 'null': r = { type: 'null' }; break;
          default: r = {};
        }
        if (x.nullable) {
          if (r.type && typeof r.type === 'string') r.type = [r.type, 'null'];
          else r = { anyOf: [r, { type: 'null' }] };
        }
        return r;
      };
      const defs = {};
      for (const e of ir.enums) defs[e.name] = { type: 'string', enum: e.values };
      for (const c of ir.classes) {
        const d = { type: 'object', properties: {}, required: [], additionalProperties: true };
        for (const p of c.props) {
          let ps = s(p.type);
          if (p.optional && o.optionalAs === 'nullable') ps = s(Object.assign({}, p.type, { nullable: true }));
          if (o.readonly) ps.readOnly = true;
          d.properties[p.key] = ps;
          if (!p.optional || o.optionalAs === 'nullable') d.required.push(p.key);
        }
        if (!d.required.length) delete d.required;
        defs[c.name] = d;
      }
      const top = Object.assign({ $schema: 'https://json-schema.org/draft/2020-12/schema', title: ir.topName || 'Root' }, s(ir.top));
      if (Object.keys(defs).length) top.$defs = defs;
      return JSON.stringify(top, null, 2);
    }
  };

  const LANGUAGES = [
    { id: 'typescript', label: 'TypeScript', ext: 'ts' },
    { id: 'csharp', label: 'C#', ext: 'cs' },
    { id: 'python', label: 'Python (dataclasses)', ext: 'py' },
    { id: 'go', label: 'Go', ext: 'go' },
    { id: 'rust', label: 'Rust (serde)', ext: 'rs' },
    { id: 'java', label: 'Java (Jackson)', ext: 'java' },
    { id: 'kotlin', label: 'Kotlin (kotlinx.serialization)', ext: 'kt' },
    { id: 'swift', label: 'Swift (Codable)', ext: 'swift' },
    { id: 'jsonschema', label: 'JSON Schema', ext: 'schema.json' }
  ];

  // One call for the worker and the interface: parse every sample, infer, generate.
  function run(req) {
    const samples = [], errors = [];
    (req.samples || []).forEach((text, idx) => {
      if (!String(text).trim()) return;
      const r = parse(text, { lenient: !!req.lenient });
      if (r.ok) samples.push(r.node); else errors.push(Object.assign({ sample: idx }, r.error));
    });
    if (!samples.length) return { ok: false, errors, empty: !errors.length };
    const ir = infer(samples, req.infer);
    const code = generate(req.lang || 'typescript', ir, req.gen);
    const inspector = ir.classes.map((c) => ({ name: c.name, props: c.props.map((p) => ({ key: p.key, type: describeType(p.type), optional: p.optional })) }));
    return { ok: true, code, errors, inspector, enums: ir.enums, top: describeType(ir.top), sampleCount: samples.length };
  }

  // ---------------------------------------------------------------------------------------------
  // Validation against the JSON Schema subset this module generates (type, properties, required,
  // items, additionalProperties, enum, anyOf, $ref into $defs, format).
  // ---------------------------------------------------------------------------------------------
  function validate(node, schema) {
    const problems = [];
    const kindOf = (n) => (n.t === 'number' ? (Number.isInteger(n.v) && !/[.eE]/.test(n.raw || '') ? 'integer' : 'number') : n.t);
    const typeOk = (n, ty) => { const k = kindOf(n); return ty === k || (ty === 'number' && k === 'integer'); };
    const rec = (n, sc, path) => {
      if (!sc || typeof sc !== 'object') return true;
      if (sc.$ref) { const name = sc.$ref.replace('#/$defs/', ''); return rec(n, schema.$defs && schema.$defs[name], path); }
      if (sc.anyOf) {
        const ok = sc.anyOf.some((alt) => { const before = problems.length; const r = rec(n, alt, path); problems.length = before; return r; });
        if (!ok) problems.push({ path, message: 'Does not match any allowed shape' });
        return ok;
      }
      if (sc.type) {
        const types = Array.isArray(sc.type) ? sc.type : [sc.type];
        if (!types.some((ty) => typeOk(n, ty))) { problems.push({ path, message: `Expected ${types.join(' or ')} but found ${kindOf(n)}` }); return false; }
      }
      let ok = true;
      if (sc.enum && n.t === 'string' && !sc.enum.includes(n.v)) { problems.push({ path, message: `"${n.v}" is not one of ${sc.enum.map((x) => JSON.stringify(x)).join(', ')}` }); ok = false; }
      if (sc.format && n.t === 'string' && RX[sc.format] && !RX[sc.format].test(n.v)) { problems.push({ path, message: `Expected ${sc.format} text` }); ok = false; }
      if (n.t === 'object') {
        for (const r of sc.required || []) if (!n.entries.some((e) => e.k === r)) { problems.push({ path, message: `Missing required property "${r}"` }); ok = false; }
        for (const e of n.entries) {
          const sub = sc.properties && sc.properties[e.k];
          if (sub) ok = rec(e.v, sub, path.concat([e.k])) && ok;
          else if (sc.additionalProperties && typeof sc.additionalProperties === 'object') ok = rec(e.v, sc.additionalProperties, path.concat([e.k])) && ok;
          else if (sc.additionalProperties === false) { problems.push({ path: path.concat([e.k]), message: `Unexpected property "${e.k}"` }); ok = false; }
        }
      }
      if (n.t === 'array' && sc.items) n.items.forEach((it, j) => { ok = rec(it, sc.items, path.concat([j])) && ok; });
      return ok;
    };
    rec(node, schema, []);
    return problems;
  }

  return {
    parse, stringify, fromValue, toValue, clone, getAt, stats, sortKeys, removeNulls,
    pathToJsonPath, pathToPointer, parseJsonPath, queryJsonPath,
    infer, describeType, generate, run, validate, LANGUAGES, detectFormat,
    naming: { words, pascal, camel, snake, singular, propName }
  };
});
