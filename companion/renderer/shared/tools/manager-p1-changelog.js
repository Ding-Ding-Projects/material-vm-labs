'use strict';
// Changelog viewer for every companion. It reads CHANGELOG.md from the bundled documentation
// (window.mvlDocs.load() returns docs.json), so it always matches the build it ships in.
//  - Every version section with its version, release date, release code name when there is one, its
//    categories and changes. A commit SHA written in an entry becomes a short clickable reference.
//  - Search with the regex builder and a date range compose; the empty result says what filtered it.
//  - Copy or export the filtered view (HTML, Markdown, plain text, JSON), with the range in the file.
//  - Nothing is invented: a version with no date, no code name or no commit says so.
(function (root) {
  const FORGE = 'https://github.com/Ding-Ding-Projects/material-vm-labs';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const strip = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  const SHA_RE = /\b[0-9a-f]{40}\b/g;

  // Pure: version, date, code name and release state from a section heading such as
  // "0.2.0 Har Gow (2026-11-01)", "[0.2.0] - 2026-11-01 - Har Gow" or "0.1.0 (unreleased)".
  function parseHeading(text) {
    const t = String(text || '').trim();
    const vm = /\bv?(\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?)\b/.exec(t);
    const dm = /\b(\d{4}-\d{2}-\d{2})\b/.exec(t);
    const unreleased = /\bunreleased\b/i.test(t);
    let rest = t;
    if (vm) rest = rest.replace(vm[0], ' ');
    if (dm) rest = rest.replace(dm[0], ' ');
    rest = rest.replace(/\bunreleased\b/ig, ' ').replace(/\bcode\s*name\b:?/ig, ' ').replace(/\brelease(d)?\b/ig, ' ').replace(/[()[\]]/g, ' ').replace(/(^|\s)[-:,]+(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim();
    return { version: vm ? vm[1] : '', date: dm ? dm[1] : '', unreleased, codeName: rest };
  }

  // Pure: the top-level <li> elements of a fragment, nested lists kept inside their item.
  function topItems(html) {
    const out = [], re = /<(\/?)(li|ul|ol)\b[^>]*>/gi;
    let depth = 0, listDepth = 0, start = -1, m;
    while ((m = re.exec(html))) {
      const close = m[1] === '/', tag = m[2].toLowerCase();
      if (tag === 'ul' || tag === 'ol') { listDepth += close ? -1 : 1; continue; }
      if (!close) { if (depth === 0 && listDepth === 1) start = m.index + m[0].length; depth++; }
      else { depth--; if (depth === 0 && start >= 0) { out.push(html.slice(start, m.index).trim()); start = -1; } }
    }
    return out;
  }
  const paragraphs = (html) => [...String(html).replace(/<(ul|ol)[\s\S]*?<\/\1>/gi, '').matchAll(/<p>([\s\S]*?)<\/p>/gi)].map((m) => m[1].trim()).filter(Boolean);
  const item = (h) => { const text = strip(h); return { html: h, text, shas: [...new Set(text.match(SHA_RE) || [])] }; };

  // Pure: the rendered CHANGELOG.md HTML to version sections.
  function parse(html) {
    const src = String(html || '');
    const heads = [...src.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)];
    return heads.map((h, i) => {
      const body = src.slice(h.index + h[0].length, i + 1 < heads.length ? heads[i + 1].index : src.length);
      const head = parseHeading(strip(h[1]));
      const subs = [...body.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/gi)];
      const lead = body.slice(0, subs.length ? subs[0].index : body.length);
      const categories = [];
      const leadItems = topItems(lead).map(item);
      if (leadItems.length) categories.push({ name: 'Changes', items: leadItems });
      subs.forEach((s, j) => {
        const part = body.slice(s.index + s[0].length, j + 1 < subs.length ? subs[j + 1].index : body.length);
        const its = topItems(part).map(item);
        const ps = its.length ? [] : paragraphs(part).map(item);
        categories.push({ name: strip(s[1]), items: its.concat(ps) });
      });
      const intro = paragraphs(lead).map(strip);
      const code = /code\s*name:\s*([^.;\n]+)/i.exec(intro.join(' '));
      if (!head.codeName && code) head.codeName = code[1].trim();
      const shas = [...new Set(strip(body).match(SHA_RE) || [])];
      return Object.assign(head, { heading: strip(h[1]), intro, categories, shas, count: categories.reduce((a, c) => a + c.items.length, 0) });
    });
  }

  // Pure: the versions and items that pass the date range and the text test.
  function filter(versions, o) {
    o = o || {};
    const out = [];
    let undatedHidden = 0;
    for (const v of versions) {
      if (o.from || o.to) {
        if (!v.date) { undatedHidden++; continue; }
        if ((o.from && v.date < o.from) || (o.to && v.date > o.to)) continue;
      }
      if (!o.test) { out.push(v); continue; }
      const headHit = o.test([v.version, v.codeName, v.date, v.heading, v.intro.join(' ')].join(' '));
      const cats = v.categories.map((c) => ({ name: c.name, items: headHit ? c.items : c.items.filter((it) => o.test(c.name + ' ' + it.text)) })).filter((c) => c.items.length);
      if (headHit || cats.length) out.push(Object.assign({}, v, { categories: cats, count: cats.reduce((a, c) => a + c.items.length, 0) }));
    }
    return { versions: out, undatedHidden };
  }

  const dateText = (v) => (v.date ? v.date : v.unreleased ? 'Unreleased, no release date yet' : 'No release date recorded');
  function viewHtml(versions, forExport) {
    return versions.map((v) => `<section class="p1-cl-ver"><h2>${esc(v.version || v.heading)}${v.codeName ? ` <span class="p1-cl-code">${esc(v.codeName)}</span>` : ''}</h2>
<p class="p1-cl-meta">${esc(dateText(v))}${v.codeName ? '' : ' · No code name recorded'}${v.shas.length ? '' : ' · No commit recorded for this version'}</p>
${v.intro.map((p) => `<p>${esc(p)}</p>`).join('')}
${v.categories.map((c) => `<h3>${esc(c.name)}</h3><ul>${c.items.map((it) => `<li>${it.html}${it.shas.map((s) => forExport ? ` (commit ${s})` : ` <button type="button" class="p1-sha" data-sha="${s}" title="Commit ${s}">${s.slice(0, 7)}</button>`).join('')}</li>`).join('')}</ul>`).join('')}
${v.count ? '' : '<p>No changes are recorded for this version.</p>'}</section>`).join('\n');
  }

  function mount(el, opts) {
    opts = opts || {};
    const docsApi = opts.api || root.mvlDocs;
    const search = root.MVL.makeSearch({ placeholder: 'Search the changelog', label: 'Search the changelog', onChange: () => draw() });
    const dates = root.MVLDates.range({ label: 'Released between', onChange: () => draw() });
    el.classList.add('p1-changelog');
    el.innerHTML = `<p class="small" data-cl="src">Loading the bundled changelog...</p><div data-cl="search"></div><div data-cl="dates"></div>
<div class="row"><p class="small grow" role="status" data-cl="line"></p><button type="button" class="btn sm" data-cl="copy">Copy this view</button><button type="button" class="btn sm primary" data-cl="export">Export this view</button></div>
<div class="p1-cl-list" data-cl="list"></div>`;
    el.querySelector('[data-cl=search]').append(search.el);
    el.querySelector('[data-cl=dates]').append(dates.el);
    let versions = [], meta = {}, err = '';
    const list = el.querySelector('[data-cl=list]');
    const current = () => { const r = dates.get(); return filter(versions, { from: r.from, to: r.to, test: search.active() && !search.invalid() ? (t) => !!search.test(t) : null }); };
    const scopeText = () => { const p = []; if (search.active()) p.push(`${search.isRegex() ? 'regex' : 'text'} "${search.term()}"`); p.push('released ' + dates.describe()); return p.join(', '); };
    function draw() {
      if (err) { list.innerHTML = `<div class="errbox">${esc(err)}</div>`; el.querySelector('[data-cl=line]').textContent = ''; for (const b of el.querySelectorAll('[data-cl=copy], [data-cl=export]')) b.disabled = true; return; }
      if (search.invalid()) { list.innerHTML = '<div class="errbox">That regex pattern is not valid yet, so nothing is listed.</div>'; return; }
      const r = current();
      const line = `${r.versions.length} of ${versions.length} version${versions.length === 1 ? '' : 's'} shown, filtered by ${scopeText()}.` + (r.undatedHidden ? ` ${r.undatedHidden} version${r.undatedHidden === 1 ? ' has' : 's have'} no release date, so the date filter hides ${r.undatedHidden === 1 ? 'it' : 'them'}.` : '') + (dates.valid() ? '' : ' A typed date is not complete yet, so it is not applied.');
      el.querySelector('[data-cl=line]').textContent = line;
      if (search.active() && search.isRegex()) search.setStatus(`${r.versions.length} versions`);
      for (const b of el.querySelectorAll('[data-cl=copy], [data-cl=export]')) b.disabled = !r.versions.length;
      if (!versions.length) { list.innerHTML = '<div class="empty"><h2>No versions recorded</h2><p>The bundled CHANGELOG.md has no version sections.</p></div>'; return; }
      if (!r.versions.length) { list.innerHTML = `<div class="empty"><h2>No change matches</h2><p>${root.MVLFunny ? root.MVLFunny.html('empty', 'Nothing matches ' + scopeText() + '. Clear the search or widen the dates.') : esc('Nothing matches ' + scopeText() + '.')}</p></div>`; return; }
      list.innerHTML = r.versions.map((v) => {
        const risky = v.categories.some((c) => /security|breaking/i.test(c.name));
        const facts = `Version ${v.version || v.heading}: ${v.count} change${v.count === 1 ? '' : 's'} in ${v.categories.length} categor${v.categories.length === 1 ? 'y' : 'ies'}, ${v.date ? 'released ' + v.date : v.unreleased ? 'not released yet' : 'release date not recorded'}.`;
        return `<article class="card p1-cl-card"><div class="row"><h2 class="p1-cl-v">${esc(v.version || v.heading)}</h2>${v.codeName ? `<span class="pill cyan" title="Release code name">${esc(v.codeName)}</span>` : ''}${v.unreleased ? '<span class="pill amber">Unreleased</span>' : ''}<span class="grow"></span><span class="small">${esc(dateText(v))}</span></div>
<p class="p1-cl-voice">${root.MVLFunny ? root.MVLFunny.html(risky ? 'warning' : 'info', facts) : esc(facts)}</p>
${v.intro.map((p) => `<p>${esc(p)}</p>`).join('')}
${v.categories.map((c) => `<h3 class="p1-h3">${esc(c.name)}</h3><ul class="p1-cl-items">${c.items.map((it) => `<li>${it.html}${it.shas.map((s) => ` <button type="button" class="p1-sha" data-sha="${s}" title="Open commit ${s}" aria-label="Open commit ${s}">${s.slice(0, 7)}</button>`).join('')}</li>`).join('')}</ul>`).join('')}
<p class="small">${v.shas.length ? `${v.shas.length} commit${v.shas.length === 1 ? '' : 's'} referenced. Links open the project's GitHub page; this app cannot check them offline.` : 'No commit is recorded for this version in CHANGELOG.md, so no commit link is shown.'}</p></article>`;
      }).join('');
    }
    const exportDoc = () => {
      const r = current();
      const html = `<h1>Changelog</h1>\n<p>Material VM Labs ${esc(meta.version || '')}, source commit ${esc(meta.commit || 'unknown')}. Range: ${esc(scopeText())}; ${r.versions.length} of ${versions.length} versions.</p>\n` + viewHtml(r.versions, true);
      return { title: 'Changelog', id: 'CHANGELOG.md', html, source: scopeText() };
    };
    el.addEventListener('click', (e) => {
      const s = e.target.closest('[data-sha]');
      if (s) { const url = FORGE + '/commit/' + s.dataset.sha; if (docsApi && docsApi.openExternal) docsApi.openExternal(url); else root.MVLExport.copy(url).then(() => root.MVL.toast('Copied the commit link: opening links is not available here')); return; }
      const b = e.target.closest('[data-cl]'); if (!b || b.tagName !== 'BUTTON') return;
      if (b.dataset.cl === 'copy') root.MVLExport.copy(root.MVLExport.render({ kind: 'document', doc: exportDoc() }, 'md')).then((ok) => root.MVL.toast(ok ? 'Copied the filtered changelog as Markdown' : 'The clipboard is not available here', ok ? 'success' : 'error'));
      if (b.dataset.cl === 'export') root.MVLExport.open({ kind: 'document', title: 'Changelog', name: 'changelog', schema: 'mvl.changelog/1', doc: exportDoc(), scope: scopeText(), format: 'md' });
    });
    if (root.MVLFunny && root.MVLFunny.onChange) root.MVLFunny.onChange(() => { if (el.isConnected) draw(); });
    Promise.resolve().then(() => {
      if (!docsApi || !docsApi.load) throw new Error('The bundled documentation is not reachable from this window, so the changelog cannot be read here. Open it in the manager or the docs reader.');
      return docsApi.load();
    }).then((d) => {
      meta = d || {};
      const doc = (meta.docs || []).find((x) => /(^|\/)CHANGELOG\.md$/i.test(x.id));
      if (!doc) throw new Error(meta.error ? 'The bundled documentation could not be read: ' + meta.error : 'CHANGELOG.md is not bundled in this build.');
      versions = parse(doc.html);
      el.querySelector('[data-cl=src]').textContent = `From the bundled CHANGELOG.md of version ${meta.version || 'unknown'}, source commit ${String(meta.commit || 'unknown').slice(0, 12)}.`;
      draw();
    }).catch((e) => { err = (e && e.message) || String(e); el.querySelector('[data-cl=src]').textContent = 'The changelog is unavailable.'; draw(); });
  }

  function open() { if (root.MVLTools) root.MVLTools.open('changelog'); }
  if (root.MVLTools) root.MVLTools.register({ id: 'changelog', title: 'Changelog', group: 'Help', summary: 'Every version and what changed, searchable by text and date', mount: (el) => mount(el) });

  root.MVLChangelog = { parse, parseHeading, topItems, filter, viewHtml, mount, open, FORGE };
})(typeof window !== 'undefined' ? window : globalThis);
