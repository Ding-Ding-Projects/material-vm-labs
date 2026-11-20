'use strict';
// One shared, isolated renderer for provider-authored text: release notes, issue and pull-request
// bodies, commit messages, README previews and extension reports. It parses a safe Markdown subset
// (headings, paragraphs, emphasis, inline and fenced code, lists with task boxes, quotes, rules,
// simple tables, links and emoji shortcodes) into a small tree and builds the page from that tree with
// createElement and textContent only. Raw HTML in the source stays visible as text and never becomes
// markup, nothing runs, images are not fetched (they show as a link), and links open only through the
// main process after a click. Relative links resolve against the base you give it.
//
// Page: MVLRender.render(el, source, { label, base, empty }) and MVLRender.element(source, opts).
// Tests: require() this file in Node for parse() and toHTML().
(function (root) {
  const MAX_SOURCE = 200000;
  const MAX_DEPTH = 6;

  const EMOJI = {
    white_check_mark: '✅', heavy_check_mark: '✔️', x: '❌', tada: '🎉', rocket: '🚀', bug: '🐛', sparkles: '✨',
    warning: '⚠️', memo: '📝', fire: '🔥', lock: '🔒', unlock: '🔓', wrench: '🔧', hammer: '🔨',
    package: '📦', art: '🎨', zap: '⚡', boom: '💥', construction: '🚧', recycle: '♻️', arrow_up: '⬆️',
    arrow_down: '⬇️', bookmark: '🔖', books: '📚', lipstick: '💄', globe_with_meridians: '🌐', green_heart: '💚',
    '+1': '👍', '-1': '👎', thumbsup: '👍', thumbsdown: '👎', eyes: '👀', star: '⭐', information_source: 'ℹ️',
    question: '❓', exclamation: '❗', heavy_plus_sign: '➕', heavy_minus_sign: '➖', pencil2: '✏️', mag: '🔍', link: '🔗',
    gear: '⚙️', computer: '💻', desktop_computer: '🖥️', penguin: '🐧', whale: '🐳', wastebasket: '🗑️',
    rotating_light: '🚨', red_circle: '🔴', green_circle: '🟢', yellow_circle: '🟡', hourglass: '⌛', stopwatch: '⏱️',
    test_tube: '🧪', broom: '🧹', label: '🏷️', truck: '🚚', card_file_box: '🗃️', speech_balloon: '💬',
    bulb: '💡', heart: '❤️', smile: '😄', dumpling: '🥟', checkered_flag: '🏁', no_entry: '⛔', stop_sign: '🛑',
    new: '🆕', see_no_evil: '🙈', pushpin: '📌', loud_sound: '🔊', mute: '🔇', key: '🔑', shield: '🛡️'
  };

  // ---------- Links ----------
  // Returns an absolute http(s)/mailto URL or an in-page anchor, or null when the link is refused.
  function resolveHref(href, base) {
    const h = String(href || '').trim().replace(/^<|>$/g, '');
    if (!h || h.length > 2000 || /[\u0000-\u001f\s]/.test(h)) return null;
    if (/^#[\w-]{1,100}$/.test(h)) return h;
    if (/^mailto:[^\s<>"]+@[^\s<>"]+$/i.test(h)) return h;
    let u;
    try { u = base ? new URL(h, base) : new URL(h); } catch { return null; }
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  }

  // ---------- Inline ----------
  const PUNCT = /[\\`*_{}[\]()#+\-.!|~<>:]/;
  function findClose(s, from, marker) {
    let i = from;
    while ((i = s.indexOf(marker, i)) >= 0) { if (s[i - 1] !== '\\' && s[i - 1] !== ' ') return i; i += marker.length; }
    return -1;
  }
  function bracket(s, i) { // s[i] === '['; returns index of matching ']' or -1
    let d = 0;
    for (let j = i; j < s.length; j++) { if (s[j] === '\\') { j++; continue; } if (s[j] === '[') d++; else if (s[j] === ']') { d--; if (!d) return j; } }
    return -1;
  }
  function paren(s, i) { // s[i] === '('
    let d = 0;
    for (let j = i; j < s.length; j++) { if (s[j] === '(') d++; else if (s[j] === ')') { d--; if (!d) return j; } else if (s[j] === '\n') return -1; }
    return -1;
  }

  function inline(s, ctx, depth) {
    depth = depth || 0;
    const out = [];
    let buf = '';
    const text = () => { if (buf) { out.push({ t: 'text', v: buf }); buf = ''; } };
    if (depth > MAX_DEPTH) return [{ t: 'text', v: s }];
    let i = 0;
    while (i < s.length) {
      const c = s[i], rest = s.slice(i);
      if (c === '\\' && i + 1 < s.length && PUNCT.test(s[i + 1])) { buf += s[i + 1]; i += 2; continue; }
      if (c === '\\' && s[i + 1] === '\n') { text(); out.push({ t: 'br' }); i += 2; continue; }
      if (c === ' ' && /^ {2,}\n/.test(rest)) { text(); out.push({ t: 'br' }); i += rest.indexOf('\n') + 1; continue; }
      if (c === '\n') { buf += ' '; i++; continue; }
      if (c === '`') {
        const run = /^`+/.exec(rest)[0];
        const end = s.indexOf(run, i + run.length);
        if (end > 0) { text(); out.push({ t: 'code', v: s.slice(i + run.length, end).replace(/\n/g, ' ').replace(/^ (.+) $/, '$1') }); i = end + run.length; continue; }
        buf += run; i += run.length; continue;
      }
      if ((c === '!' && s[i + 1] === '[') || c === '[') {
        const img = c === '!';
        const b0 = img ? i + 1 : i, b1 = bracket(s, b0);
        if (b1 > 0 && s[b1 + 1] === '(') {
          const p1 = paren(s, b1 + 1);
          if (p1 > 0) {
            const label = s.slice(b0 + 1, b1);
            const target = s.slice(b1 + 2, p1).trim().replace(/\s+"[^"]*"$/, '');
            const href = resolveHref(target, ctx.base);
            text();
            if (img) out.push(href ? { t: 'a', href, c: [{ t: 'text', v: 'Image: ' + (label || 'untitled') }], image: true } : { t: 'text', v: 'Image: ' + (label || 'untitled') });
            else if (href) out.push({ t: 'a', href, c: inline(label, ctx, depth + 1) });
            else out.push(...inline(label, ctx, depth + 1));
            i = p1 + 1; continue;
          }
        }
      }
      if (c === '<') {
        const m = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/i.exec(rest);
        if (m) { const href = resolveHref(m[1], null); text(); out.push(href ? { t: 'a', href, c: [{ t: 'text', v: m[1] }] } : { t: 'text', v: m[0] }); i += m[0].length; continue; }
        const cm = /^<!--[\s\S]*?-->/.exec(rest);
        if (cm) { i += cm[0].length; continue; }
      }
      if ((c === 'h' || c === 'H') && (i === 0 || /[\s(]/.test(s[i - 1]))) {
        const m = /^https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"\]]/i.exec(rest);
        if (m) { const href = resolveHref(m[0], null); if (href) { text(); out.push({ t: 'a', href, c: [{ t: 'text', v: m[0] }] }); i += m[0].length; continue; } }
      }
      if ((c === '*' || c === '_') && s[i + 1] === c) {
        const mk = c + c, end = findClose(s, i + 2, mk);
        if (end > i + 2 && s[i + 2] !== ' ') { text(); out.push({ t: 'b', c: inline(s.slice(i + 2, end), ctx, depth + 1) }); i = end + 2; continue; }
      }
      if (c === '~' && s[i + 1] === '~') {
        const end = findClose(s, i + 2, '~~');
        if (end > i + 2) { text(); out.push({ t: 's', c: inline(s.slice(i + 2, end), ctx, depth + 1) }); i = end + 2; continue; }
      }
      if ((c === '*' || c === '_') && s[i + 1] && s[i + 1] !== ' ' && s[i + 1] !== c && !(c === '_' && i > 0 && /\w/.test(s[i - 1]))) {
        const end = findClose(s, i + 1, c);
        if (end > i + 1 && !(c === '_' && /\w/.test(s[end + 1] || ''))) { text(); out.push({ t: 'i', c: inline(s.slice(i + 1, end), ctx, depth + 1) }); i = end + 1; continue; }
      }
      if (c === ':') {
        const m = /^:([a-z0-9_+-]{1,40}):/.exec(rest);
        if (m && Object.prototype.hasOwnProperty.call(ctx.emoji, m[1])) { text(); out.push({ t: 'emoji', v: ctx.emoji[m[1]], name: m[1] }); i += m[0].length; continue; }
      }
      buf += c; i++;
    }
    text();
    return out;
  }

  // ---------- Blocks ----------
  const RE = {
    fence: /^ {0,3}(`{3,}|~{3,})\s*([\w+#.-]*)[^`]*$/, heading: /^ {0,3}(#{1,6})(?:\s+(.*?))?\s*#*\s*$/, hr: /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/,
    quote: /^ {0,3}>\s?/, item: /^( {0,12})([-*+]|\d{1,9}[.)])(?:\s+(.*))?$/, sep: /^(?=.*[|])\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/
  };
  const splitRow = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
  const startsBlock = (l, next) => RE.fence.test(l) || RE.heading.test(l) || RE.hr.test(l) || RE.quote.test(l) || RE.item.test(l) || (l.includes('|') && next != null && RE.sep.test(next));

  function blocks(lines, ctx, depth) {
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) { i++; continue; }
      let m;
      if ((m = RE.fence.exec(l))) {
        const fence = m[1], body = [];
        i++;
        while (i < lines.length && !(new RegExp('^ {0,3}' + fence[0] + '{' + fence.length + ',}\\s*$').test(lines[i]))) body.push(lines[i++]);
        i++;
        out.push({ t: 'pre', lang: m[2] || '', v: body.join('\n') });
        continue;
      }
      if (RE.hr.test(l)) { out.push({ t: 'hr' }); i++; continue; }
      if ((m = RE.heading.exec(l))) { out.push({ t: 'h', level: m[1].length, c: inline(m[2] || '', ctx) }); i++; continue; }
      if (RE.quote.test(l)) {
        const body = [];
        while (i < lines.length && lines[i].trim() && RE.quote.test(lines[i])) body.push(lines[i++].replace(RE.quote, ''));
        out.push(depth < MAX_DEPTH ? { t: 'quote', c: blocks(body, ctx, depth + 1) } : { t: 'p', c: inline(body.join('\n'), ctx) });
        continue;
      }
      if ((m = RE.item.exec(l))) {
        const ordered = /\d/.test(m[2]), indent = m[1].length;
        const list = { t: ordered ? 'ol' : 'ul', start: ordered ? parseInt(m[2], 10) : 1, items: [] };
        while (i < lines.length) {
          const im = RE.item.exec(lines[i]);
          if (!im || im[1].length !== indent || /\d/.test(im[2]) !== ordered) break;
          const body = [im[3] || ''];
          const pad = indent + im[2].length + 1;
          i++;
          while (i < lines.length) {
            const nl = lines[i];
            if (!nl.trim()) { if (i + 1 < lines.length && /^\s+/.test(lines[i + 1]) && (lines[i + 1].match(/^\s*/)[0].length >= pad - 1)) { body.push(''); i++; continue; } break; }
            const sub = RE.item.exec(nl);
            if (sub && sub[1].length <= indent) break;
            if (!sub && !/^\s/.test(nl) && startsBlock(nl, lines[i + 1])) break;
            body.push(nl.replace(new RegExp('^ {0,' + pad + '}'), ''));
            i++;
          }
          let task = null;
          const tm = /^\[([ xX])\]\s+/.exec(body[0]);
          if (tm) { task = tm[1] !== ' '; body[0] = body[0].slice(tm[0].length); }
          const inner = depth < MAX_DEPTH ? blocks(body, ctx, depth + 1) : [{ t: 'p', c: inline(body.join('\n'), ctx) }];
          list.items.push({ task, c: inner });
        }
        out.push(list);
        continue;
      }
      if (l.includes('|') && i + 1 < lines.length && RE.sep.test(lines[i + 1])) {
        const head = splitRow(l).map((c) => inline(c, ctx));
        const align = splitRow(lines[i + 1]).map((c) => (/^:-+:$/.test(c) ? 'center' : /-:$/.test(c) ? 'right' : ''));
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].trim() && lines[i].includes('|')) { rows.push(splitRow(lines[i]).slice(0, Math.max(head.length, 1)).map((c) => inline(c, ctx))); i++; }
        out.push({ t: 'table', head, align, rows });
        continue;
      }
      const para = [l];
      i++;
      while (i < lines.length && lines[i].trim() && !startsBlock(lines[i], lines[i + 1])) para.push(lines[i++]);
      const setext = i < lines.length && /^ {0,3}(=+|-+)\s*$/.test(lines[i]) && para.length === 1;
      if (setext) { out.push({ t: 'h', level: lines[i].trim()[0] === '=' ? 1 : 2, c: inline(para[0].trim(), ctx) }); i++; continue; }
      out.push({ t: 'p', c: inline(para.join('\n').trim(), ctx) });
    }
    return out;
  }

  function parse(source, opts) {
    opts = opts || {};
    let src = String(source == null ? '' : source);
    const truncated = src.length > MAX_SOURCE;
    if (truncated) src = src.slice(0, MAX_SOURCE);
    src = src.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').replace(/<!--[\s\S]*?-->/g, '');
    const ctx = { base: opts.base || null, emoji: Object.assign({}, EMOJI, opts.emoji || {}) };
    const tree = blocks(src.split('\n'), ctx, 0);
    if (truncated) tree.push({ t: 'p', c: [{ t: 'i', c: [{ t: 'text', v: 'The rest was cut off: the text is longer than ' + MAX_SOURCE + ' characters.' }] }] });
    return tree;
  }

  // ---------- Output: escaped HTML string (tests, export) ----------
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function inlineHTML(nodes) {
    return nodes.map((n) => {
      switch (n.t) {
        case 'text': return esc(n.v);
        case 'br': return '<br>';
        case 'code': return '<code>' + esc(n.v) + '</code>';
        case 'b': return '<strong>' + inlineHTML(n.c) + '</strong>';
        case 'i': return '<em>' + inlineHTML(n.c) + '</em>';
        case 's': return '<del>' + inlineHTML(n.c) + '</del>';
        case 'emoji': return '<span class="md-emoji" role="img" aria-label="' + esc(n.name.replace(/_/g, ' ')) + '">' + esc(n.v) + '</span>';
        case 'a': return '<a href="' + esc(n.href) + '" rel="noreferrer noopener">' + inlineHTML(n.c) + '</a>';
        default: return '';
      }
    }).join('');
  }
  function toHTML(tree) {
    return tree.map((b) => {
      switch (b.t) {
        case 'h': return '<h' + b.level + '>' + inlineHTML(b.c) + '</h' + b.level + '>';
        case 'p': return '<p>' + inlineHTML(b.c) + '</p>';
        case 'pre': return '<pre><code' + (b.lang ? ' data-lang="' + esc(b.lang) + '"' : '') + '>' + esc(b.v) + '</code></pre>';
        case 'hr': return '<hr>';
        case 'quote': return '<blockquote>' + toHTML(b.c) + '</blockquote>';
        case 'ul': case 'ol': return '<' + b.t + (b.t === 'ol' && b.start !== 1 ? ' start="' + b.start + '"' : '') + '>' + b.items.map((it) => '<li>' + (it.task == null ? '' : (it.task ? '[done] ' : '[ ] ')) + (it.c.length === 1 && it.c[0].t === 'p' ? inlineHTML(it.c[0].c) : toHTML(it.c)) + '</li>').join('') + '</' + b.t + '>';
        case 'table': return '<table><thead><tr>' + b.head.map((h) => '<th>' + inlineHTML(h) + '</th>').join('') + '</tr></thead><tbody>' + b.rows.map((r) => '<tr>' + r.map((c) => '<td>' + inlineHTML(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
        default: return '';
      }
    }).join('\n');
  }

  // ---------- Output: DOM (page) ----------
  function buildInline(doc, parent, nodes) {
    for (const n of nodes) {
      let el;
      switch (n.t) {
        case 'text': parent.append(doc.createTextNode(n.v)); continue;
        case 'br': el = doc.createElement('br'); break;
        case 'code': el = doc.createElement('code'); el.textContent = n.v; break;
        case 'b': el = doc.createElement('strong'); buildInline(doc, el, n.c); break;
        case 'i': el = doc.createElement('em'); buildInline(doc, el, n.c); break;
        case 's': el = doc.createElement('del'); buildInline(doc, el, n.c); break;
        case 'emoji': el = doc.createElement('span'); el.className = 'md-emoji'; el.setAttribute('role', 'img'); el.setAttribute('aria-label', n.name.replace(/_/g, ' ')); el.textContent = n.v; break;
        case 'a':
          el = doc.createElement('a'); el.setAttribute('href', n.href); el.setAttribute('rel', 'noreferrer noopener');
          if (!n.href.startsWith('#')) { el.dataset.mdExternal = 'true'; el.title = 'Opens ' + n.href + ' in your browser'; }
          buildInline(doc, el, n.c); break;
        default: continue;
      }
      parent.append(el);
    }
  }
  function buildBlocks(doc, parent, tree) {
    for (const b of tree) {
      let el;
      switch (b.t) {
        case 'h': el = doc.createElement('h' + Math.min(6, b.level + 1)); el.dataset.level = String(b.level); buildInline(doc, el, b.c); break;
        case 'p': el = doc.createElement('p'); buildInline(doc, el, b.c); break;
        case 'pre': { el = doc.createElement('pre'); el.tabIndex = 0; const c = doc.createElement('code'); if (b.lang) c.dataset.lang = b.lang; c.textContent = b.v; el.append(c); break; }
        case 'hr': el = doc.createElement('hr'); break;
        case 'quote': el = doc.createElement('blockquote'); buildBlocks(doc, el, b.c); break;
        case 'ul': case 'ol':
          el = doc.createElement(b.t); if (b.t === 'ol' && b.start !== 1) el.setAttribute('start', String(b.start));
          for (const it of b.items) {
            const li = doc.createElement('li');
            if (it.task != null) { li.className = 'md-task'; const box = doc.createElement('span'); box.className = 'md-box'; box.setAttribute('role', 'img'); box.setAttribute('aria-label', it.task ? 'Done' : 'Not done'); box.textContent = it.task ? '☑' : '☐'; li.append(box, doc.createTextNode(' ')); }
            if (it.c.length === 1 && it.c[0].t === 'p') buildInline(doc, li, it.c[0].c); else buildBlocks(doc, li, it.c);
            el.append(li);
          }
          break;
        case 'table': {
          el = doc.createElement('div'); el.className = 'md-table'; el.tabIndex = 0; el.setAttribute('role', 'region'); el.setAttribute('aria-label', 'Table');
          const t = doc.createElement('table'), th = doc.createElement('thead'), tr = doc.createElement('tr');
          b.head.forEach((h, i) => { const c = doc.createElement('th'); c.scope = 'col'; if (b.align[i]) c.style.textAlign = b.align[i]; buildInline(doc, c, h); tr.append(c); });
          th.append(tr); t.append(th);
          const tb = doc.createElement('tbody');
          for (const r of b.rows) { const row = doc.createElement('tr'); r.forEach((cell, i) => { const c = doc.createElement('td'); if (b.align[i]) c.style.textAlign = b.align[i]; buildInline(doc, c, cell); row.append(c); }); tb.append(row); }
          t.append(tb); el.append(t); break;
        }
        default: continue;
      }
      parent.append(el);
    }
  }

  function openLink(href) {
    if (root.mvlDocs && typeof root.mvlDocs.openExternal === 'function') return root.mvlDocs.openExternal(href);
    if (root.MVL && root.MVL.toast) root.MVL.toast('Links cannot open from here: ' + href, 'error');
    return null;
  }

  // Renders into el (replacing its content). opts: { label (required for the region name), base, empty, emoji }.
  function render(el, source, opts) {
    opts = opts || {};
    const doc = el.ownerDocument;
    el.replaceChildren();
    el.classList.add('md-body');
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', opts.label || 'Rendered text');
    const src = String(source == null ? '' : source);
    if (!src.trim()) { const p = doc.createElement('p'); p.className = 'md-empty'; p.textContent = opts.empty || 'No notes were provided.'; el.append(p); return el; }
    buildBlocks(doc, el, parse(src, opts));
    if (!el.dataset.mdBound) {
      el.dataset.mdBound = 'true';
      el.addEventListener('click', (e) => {
        const a = e.target.closest('a[href]'); if (!a || !el.contains(a)) return;
        const href = a.getAttribute('href');
        if (href.startsWith('#')) { e.preventDefault(); const t = doc.getElementById(href.slice(1)); if (t) t.scrollIntoView(); return; }
        e.preventDefault(); openLink(href);
      });
    }
    return el;
  }
  function element(source, opts) { const d = document.createElement('div'); return render(d, source, opts); }

  const api = { parse, toHTML, render, element, resolveHref, EMOJI, MAX_SOURCE };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MVLRender = api;
})(typeof window !== 'undefined' ? window : globalThis);
