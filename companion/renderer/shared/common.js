'use strict';
// Shared renderer helpers: escaping, theme, toast, charge ring, and the search box with its adjacent regex builder.
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function applyTheme(t, reduce) {
    document.documentElement.dataset.theme = t === 'light' ? 'light' : 'dark';
    if (reduce !== undefined) document.documentElement.dataset.reduceMotion = String(!!reduce);
  }
  function initTheme() {
    let t = null;
    try { t = localStorage.getItem('mvl-theme'); } catch { /* storage may be unavailable */ }
    applyTheme(t || 'dark');
    return document.documentElement.dataset.theme;
  }
  function toggleTheme() {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    applyTheme(next);
    try { localStorage.setItem('mvl-theme', next); } catch { /* ignore */ }
    return next;
  }

  let toastTimer = null;
  function toast(msg) {
    let t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.append(t); }
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }

  const BOLT = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0E1214" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2 5 14h6l-1 8 8-12h-6z"></path></svg>';
  const logo = () => '<span class="logo">' + BOLT + '</span>';

  // Charge ring: frac 0..1 filled, colour from the CSS token name.
  function ring(size, frac, color, text) {
    const r = size * 0.413, c = size / 2, sw = size * 0.098, circ = 2 * Math.PI * r;
    const f = Math.max(0, Math.min(1, frac));
    return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true"><circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--s3)" stroke-width="${sw}"/><circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${(circ * (1 - f)).toFixed(1)}" transform="rotate(-90 ${c} ${c})"/>${text ? `<text x="${c}" y="${c + size * 0.065}" text-anchor="middle" font-size="${size * 0.195}">${esc(text)}</text>` : ''}</svg>`;
  }

  // Search with adjacent independent regex builder. Returns { el, builder, test(text) -> match|null, active() }.
  // State (query, pattern, flags, mode, validity) is kept in step per search owner. Execution is bounded by the caller's item count.
  function makeSearch(opts) {
    const id = 's' + Math.random().toString(36).slice(2, 7);
    const wrap = document.createElement('div');
    wrap.className = 'rtop';
    wrap.style.display = 'flex'; wrap.style.flexDirection = 'column'; wrap.style.gap = '12px';
    wrap.innerHTML = `<div class="search" role="search"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" style="color:var(--mute);flex:none"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg><input type="search" placeholder="${esc(opts.placeholder || 'Search')}" aria-label="${esc(opts.label || 'Search')}" autocomplete="off" spellcheck="false"><span class="kbd" aria-hidden="true">/</span><button type="button" class="rxbtn" aria-pressed="false" aria-controls="${id}" title="Switch between plain text and regex search">.* regex</button></div>
<section id="${id}" class="rxpanel" aria-label="Regex builder" hidden><input class="pat" spellcheck="false" aria-label="Regex pattern"><span role="group" aria-label="Flags" class="row" style="gap:6px"><button type="button" class="chipbtn" data-flag="i" aria-pressed="true" title="ignore case">i</button><button type="button" class="chipbtn" data-flag="m" aria-pressed="false" title="multiline">m</button><button type="button" class="chipbtn" data-flag="s" aria-pressed="false" title="dot matches newline">s</button><button type="button" class="chipbtn" data-flag="u" aria-pressed="false" title="unicode">u</button></span><span role="group" aria-label="Insert a token" class="row" style="gap:6px"><button type="button" class="chipbtn" data-tok="\\d+">\\d+</button><button type="button" class="chipbtn" data-tok="\\s">\\s</button><button type="button" class="chipbtn" data-tok="\\w+">\\w+</button><button type="button" class="chipbtn" data-tok="(a|b)">( a | b )</button><button type="button" class="chipbtn" data-tok="^">^</button><button type="button" class="chipbtn" data-tok="$">$</button></span><span class="rxstatus" role="status"></span></section>`;
    const input = wrap.querySelector('input[type=search]');
    const btn = wrap.querySelector('.rxbtn');
    const panel = wrap.querySelector('.rxpanel');
    const pat = wrap.querySelector('.pat');
    const status = wrap.querySelector('.rxstatus');
    const st = { regex: false, flags: new Set(['i']), rx: null, bad: '' };
    let timer = null;

    function compile() {
      st.rx = null; st.bad = '';
      if (!st.regex || !pat.value) return;
      try { st.rx = new RegExp(pat.value, [...st.flags].join('')); } catch (e) { st.bad = e.message; }
    }
    function fire() { compile(); status.className = 'rxstatus' + (st.bad ? ' bad' : ''); status.textContent = st.regex ? (st.bad ? 'Invalid pattern: ' + st.bad : (pat.value ? 'valid' : 'type a pattern')) : ''; if (opts.onChange) opts.onChange(); }
    const debounced = () => { clearTimeout(timer); timer = setTimeout(fire, 120); };
    input.addEventListener('input', () => { if (st.regex) pat.value = input.value; debounced(); });
    pat.addEventListener('input', () => { input.value = pat.value; debounced(); });
    btn.addEventListener('click', () => {
      st.regex = !st.regex;
      btn.setAttribute('aria-pressed', String(st.regex)); panel.hidden = !st.regex;
      if (st.regex) pat.value = input.value;
      fire();
    });
    for (const f of panel.querySelectorAll('[data-flag]')) f.addEventListener('click', () => {
      const k = f.dataset.flag; if (st.flags.has(k)) st.flags.delete(k); else st.flags.add(k);
      f.setAttribute('aria-pressed', String(st.flags.has(k))); fire();
    });
    for (const t of panel.querySelectorAll('[data-tok]')) t.addEventListener('click', () => { pat.value += t.dataset.tok; input.value = pat.value; pat.focus(); fire(); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { input.value = ''; pat.value = ''; fire(); } });
    return {
      el: wrap, input,
      active: () => !!(st.regex ? pat.value : input.value.trim()),
      invalid: () => !!st.bad,
      isRegex: () => st.regex,
      term: () => (st.regex ? pat.value : input.value.trim()),
      // returns a match-like object or null
      test(text) {
        text = String(text == null ? '' : text);
        if (st.regex) { if (!st.rx) return null; st.rx.lastIndex = 0; return st.rx.exec(text.length > 200000 ? text.slice(0, 200000) : text); }
        const low = input.value.trim().toLowerCase();
        if (!low) return null;
        const i = text.toLowerCase().indexOf(low);
        return i < 0 ? null : { index: i, 0: text.substr(i, low.length) };
      },
      setStatus(t) { if (!st.bad) status.textContent = (st.regex ? 'valid · ' : '') + t; }
    };
  }

  window.MVL = { esc, initTheme, toggleTheme, applyTheme, toast, ring, logo, makeSearch };
})();
