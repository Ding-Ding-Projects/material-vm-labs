'use strict';
// documentation site reader. All content comes from the build-time docs.json; nothing here is hard-coded documentation.
// Used by the standalone Docs exe and by the Docs tab of the manager. Routing is internal state, never location.hash.
(function () {
  const { esc, makeSearch } = window.MVL;
  const COLORS = ['#C6F432', '#5FD4FF', '#FFB86B', '#FF8A8A'];

  function mount(root, api, opts) {
    opts = opts || {};
    const pillar = opts.pillar || null; // opt-in standalone layout: a left pillar owned by the standalone page
    const seen = new Set();
    let data = { docs: [] }, cats = [], byId = new Map();
    let route = { kind: 'home' };
    root.classList.add('reader');
    if (pillar) root.classList.add('sa');
    root.innerHTML = '<div class="rtop"></div><nav class="rnav" aria-label="Topics"></nav><main class="rmain" tabindex="-1"></main>';
    const top = root.querySelector('.rtop'), nav = root.querySelector('.rnav'), main = root.querySelector('.rmain');
    const search = makeSearch({ placeholder: 'Search tasks, commands, receipts', label: 'Search the documentation', onChange: () => render() });
    top.replaceWith(search.el);

    function build() {
      byId = new Map(data.docs.map((d) => [d.id, d]));
      const m = new Map();
      for (const d of data.docs) {
        if (!m.has(d.categoryKey)) m.set(d.categoryKey, { key: d.categoryKey, title: d.category, docs: [] });
        m.get(d.categoryKey).docs.push(d);
      }
      cats = [...m.values()];
    }
    function renderNav() {
      let h = `<a href="#/" ${route.kind === 'home' && !search.active() ? 'aria-current="page"' : ''}>Start here</a>`;
      for (const c of cats.filter((x) => x.key !== '_root')) {
        const cur = (route.kind === 'cat' && route.key === c.key) || (route.kind === 'doc' && byId.get(route.id) && byId.get(route.id).categoryKey === c.key);
        h += `<a href="#/cat/${encodeURIComponent(c.key)}" ${cur && !search.active() ? 'aria-current="page"' : ''}><span>${esc(c.title)}</span><span class="n">${String(c.docs.length).padStart(2, '0')}</span></a>`;
      }
      nav.innerHTML = h;
      if (pillar) renderPillar();
    }
    function renderPillar() {
      const cs = cats.filter((x) => x.key !== '_root');
      const catOf = route.kind === 'doc' && byId.get(route.id) ? byId.get(route.id).categoryKey : (route.kind === 'cat' ? route.key : null);
      if (catOf) seen.add(catOf);
      const lit = cs.filter((c) => seen.has(c.key)).length;
      const g = pillar.querySelector('.gauge');
      if (g) {
        g.setAttribute('aria-label', 'Reading progress this session: ' + lit + ' of ' + cs.length + ' topics opened');
        g.innerHTML = cs.map((c) => '<i class="' + (seen.has(c.key) ? 'park' : '') + '"></i>').join('');
      }
      const cells = pillar.querySelector('.cells');
      if (cells) {
        const act = !search.active();
        cells.innerHTML = '<a class="tab" href="#/" ' + (route.kind === 'home' && act ? 'aria-current="page"' : '') + '><b>&#8962;</b><span class="lbl">Start</span></a>' +
          cs.map((c, i) => '<a class="tab" href="#/cat/' + encodeURIComponent(c.key) + '" title="' + esc(c.title) + '" ' + (catOf === c.key && act ? 'aria-current="page"' : '') + '><b>' + String(i + 1).padStart(2, '0') + '</b><span class="lbl">' + esc(c.title) + '</span></a>').join('');
      }
      const v = pillar.querySelector('.hvchip');
      if (v) v.textContent = 'Bundled offline' + (data.version ? ' · v' + String(data.version).replace(/^v/, '') : '');
    }

    function homeView() {
      const wonton = byId.get('README.md');
      const tasks = cats.filter((c) => c.key !== '_root');
      let h = '<section class="hero"><span class="over">Throwaway Windows 11, Ubuntu and Debian, charged in minutes</span><h1>Park a fresh machine. Prove the build.</h1><p>Unattended installs from official media, a clean baseline snapshot, and a receipt for every fresh-host build. Pick a task, or search above.</p></section>';
      if (tasks.length) {
        h += '<div class="tasks">';
        tasks.forEach((c, i) => {
          const intro = c.docs.find((d) => d.isIndex) || c.docs[0];
          h += `<a class="task" href="#/cat/${encodeURIComponent(c.key)}"><span class="num" style="background:${COLORS[i % COLORS.length]}">${String(i + 1).padStart(2, '0')}</span><h3>${esc(c.title)}</h3><p>${esc((intro && intro.summary) || '')}</p><code>${c.docs.length} article${c.docs.length === 1 ? '' : 's'}</code></a>`;
        });
        h += '</div>';
      } else if (!data.docs.length) {
        h += '<div class="empty"><h2>No documentation bundled</h2><p>Rebuild after the docs folder exists.</p></div>';
      }
      if (wonton) h += `<h2>README</h2><div class="article">${wonton.html}</div>`;
      const rest = ['HANDOFF.md', 'ROADMAP.md'].map((i) => byId.get(i)).filter(Boolean);
      if (rest.length) h += '<h2>Project records</h2><div class="gridc">' + rest.map((d) => `<a class="cardlink" href="#/doc/${encodeURIComponent(d.id)}"><h3>${esc(d.title)}</h3><p>${esc(d.summary)}</p></a>`).join('') + '</div>';
      h += `<p class="small">Docs version ${esc(data.version || '')}, source commit ${esc(String(data.commit || '').slice(0, 12))}. Everything here is bundled offline.</p>`;
      main.innerHTML = h;
    }

    function catView(key) {
      const c = cats.find((x) => x.key === key);
      if (!c) { main.innerHTML = '<h1>Not found</h1><p>That topic is not in this build.</p>'; return; }
      let h = `<p class="crumbs"><a href="#/">Start here</a> / ${esc(c.title)}</p><h1>${esc(c.title)}</h1>`;
      const intro = c.docs.find((d) => d.isIndex);
      if (intro) h += `<p class="muted">${esc(intro.summary)}</p>`;
      h += '<div class="gridc">' + c.docs.map((d) => `<a class="cardlink" href="#/doc/${encodeURIComponent(d.id)}"><h3>${esc(d.title)}</h3><p>${esc(d.summary)}</p></a>`).join('') + '</div>';
      main.innerHTML = h;
    }

    function docView(id, anchor) {
      const d = byId.get(id);
      if (!d) { main.innerHTML = '<h1>Not found</h1><p>That article is not in this build.</p>'; return; }
      const c = cats.find((x) => x.key === d.categoryKey);
      const idx = c ? c.docs.indexOf(d) : -1;
      let h = `<p class="crumbs"><a href="#/">Start here</a> / ${c && c.key !== '_root' ? `<a href="#/cat/${encodeURIComponent(c.key)}">${esc(c.title)}</a> / ` : ''}${esc(d.title)}</p><article class="article">${d.html}</article>`;
      if (c && c.docs.length > 1 && idx >= 0) {
        const prev = c.docs[idx - 1], next = c.docs[idx + 1];
        h += '<div class="pager">' + (prev ? `<a class="btn" href="#/doc/${encodeURIComponent(prev.id)}">&larr; ${esc(prev.title)}</a>` : '<span></span>') + (next ? `<a class="btn" href="#/doc/${encodeURIComponent(next.id)}">${esc(next.title)} &rarr;</a>` : '') + '</div>';
      }
      main.innerHTML = h;
      if (anchor) { try { const el = main.querySelector('#' + CSS.escape(anchor)); if (el) { el.scrollIntoView(); return; } } catch { /* bad anchor */ } }
      main.scrollTop = 0; root.scrollIntoView({ block: 'start' });
    }

    function searchView() {
      const term = search.term();
      if (search.invalid()) { main.innerHTML = `<h1>Search results</h1><div class="errbox">That regex pattern is not valid, so nothing was searched.</div>`; return; }
      const started = performance.now();
      const results = []; let truncated = false;
      for (const d of data.docs) {
        if (performance.now() - started > 1500) { truncated = true; break; } // bounded execution
        const tm = search.test(d.title), m = search.test(d.text);
        if (tm || m) results.push({ d, m: m || tm, inTitle: !!tm });
        if (results.length >= 200) { truncated = true; break; }
      }
      search.setStatus(results.length + ' article' + (results.length === 1 ? '' : 's') + (truncated ? ' (stopped at the safety bound)' : ''));
      let h = `<h1>Search results</h1><p class="small">${search.isRegex() ? 'Regex' : 'Plain text'} search for <code>${esc(term)}</code></p>`;
      if (!results.length) h += '<div class="empty"><h2>No article matches</h2><p>Try fewer words, or switch search mode.</p></div>';
      for (const r of results) {
        const text = r.d.text, i = r.inTitle && !r.m ? 0 : (r.m.index || 0), len = Math.max((r.m[0] || '').length, 1);
        const s = Math.max(0, i - 60), e = Math.min(text.length, i + len + 100);
        const snip = esc(text.slice(s, i)) + '<mark>' + esc(text.slice(i, i + len)) + '</mark>' + esc(text.slice(i + len, e));
        h += `<a class="cardlink" href="#/doc/${encodeURIComponent(r.d.id)}" style="margin:10px 0"><div class="where">${esc(r.d.category)} &middot; ${esc(r.d.id)}</div><h3>${esc(r.d.title)}</h3><p>${s > 0 ? '&hellip;' : ''}${snip}${e < text.length ? '&hellip;' : ''}</p></a>`;
      }
      main.innerHTML = h;
    }

    function render() {
      renderNav();
      if (!data.docs.length && data.error) { main.innerHTML = '<h1>Could not load the bundled documentation</h1><p>' + esc(data.error) + '</p>'; return; }
      if (search.active()) return searchView();
      if (route.kind === 'doc') return docView(route.id, route.anchor);
      if (route.kind === 'cat') return catView(route.key);
      homeView();
    }
    function go(href) {
      const [pathPart, query] = href.replace(/^#/, '').split('?');
      const parts = pathPart.split('/').filter(Boolean);
      const anchor = query ? (new URLSearchParams(query)).get('a') || '' : '';
      if (parts[0] === 'doc') route = { kind: 'doc', id: decodeURIComponent(parts.slice(1).join('/')), anchor };
      else if (parts[0] === 'cat') route = { kind: 'cat', key: decodeURIComponent(parts[1] || '') };
      else route = { kind: 'home' };
      if (search.active()) { search.input.value = ''; const p = search.el.querySelector('.pat'); if (p) p.value = ''; search.input.dispatchEvent(new Event('input')); }
      render(); main.focus({ preventScroll: true });
    }
    if (pillar) pillar.addEventListener('click', (e) => {
      const a = e.target.closest('a[href^="#/"]');
      if (a) { e.preventDefault(); go(a.getAttribute('href')); }
    });
    root.addEventListener('click', (e) => {
      const ext = e.target.closest('a.external');
      if (ext) { e.preventDefault(); api.openExternal(ext.getAttribute('href')); return; }
      const a = e.target.closest('a[href^="#/"]');
      if (a) { e.preventDefault(); go(a.getAttribute('href')); }
    });
    root.addEventListener('keydown', (e) => {
      if (e.key === '/' && !/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName) && !root.closest('[hidden]')) { e.preventDefault(); search.input.focus(); }
    });
    api.load().then((d) => { data = d; build(); render(); });
    return { focusSearch: () => search.input.focus() };
  }

  window.MvlDocsReader = { mount };
})();
