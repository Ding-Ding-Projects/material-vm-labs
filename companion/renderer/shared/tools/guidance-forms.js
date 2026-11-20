'use strict';
// Guided forms for the manager, attached at run time from the declarative inventory in
// guidance-registry.js, without changing the pages that own the controls.
//  - Info icon: a compact Material 3 icon button directly above each guided control. It opens a
//    non-modal panel in the content flow with the explanation, guided steps, a worked example and a
//    practice playground (synthetic fields, a visible result, Reset). Closing destroys the practice
//    state; every panel has its own draft; nothing in it touches real settings, machines or files.
//  - Clear control: every editable text box gets a Clear button that empties it through the same
//    input event as typing, so validation and saving follow the field's own rules.
//  - Provenance: every Settings element gets a line saying whether its value was written or is the
//    compiled-in default, naming that default.
//  - Quick add: every message that points at a setting gets the matching field and Save beside it,
//    writing through the Settings row's own control so both show one stored value.
//  - Extension hooks: allowed extensions that hook the Create sheet or receipts get a button there.
// MVLGuidance.audit() reports anything in the inventory that is on screen without its working parts.
(function () {
  const R = window.MVLGuidanceRegistry;
  if (!R) return;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const INFO_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 11v6"></path><path d="M12 7.5v.01"></path></svg>';
  const CLEAR_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>';
  let seq = 0;
  const uid = (p) => p + (++seq).toString(36) + Math.random().toString(36).slice(2, 5);
  const toast = (m, k) => window.MVL && window.MVL.toast(m, k);

  // ---------- Placement ----------
  function anchorOf(target, how) {
    if (how === 'field') return target.closest('label.field') || target;
    if (how === 'row') return target.closest('label') || target;
    return target;
  }
  // Wraps the anchor so the entry and its panel sit directly above it. The anchor element itself is
  // moved, not copied, so the page's own references and listeners keep working.
  function wrapOf(anchor) {
    if (anchor.parentElement && anchor.parentElement.classList.contains('gd-wrap')) return anchor.parentElement;
    const wrap = document.createElement('div');
    wrap.className = 'gd-wrap';
    for (const c of ['grow']) if (anchor.classList.contains(c)) wrap.classList.add(c);
    anchor.before(wrap);
    wrap.append(anchor);
    return wrap;
  }

  // ---------- Info icon and panel ----------
  function attachInfo(target, spec) {
    if (target.dataset.gdInfo === spec.id) return;
    const anchor = anchorOf(target, spec.anchor);
    const wrap = wrapOf(anchor);
    const host = document.createElement('div');
    host.className = 'gd-host'; host.id = uid('gdp'); host.hidden = true;
    const entry = document.createElement('div');
    entry.className = 'gd-entry';
    const name = `About ${spec.title}: explanation, steps and practice`;
    entry.innerHTML = `<button type="button" class="iconbtn gd-info" aria-expanded="false" aria-controls="${host.id}" aria-label="${esc(name)}" title="${esc(name)}" data-gd-for="${esc(spec.id)}">${INFO_SVG}</button>`;
    wrap.insertBefore(host, anchor);
    wrap.insertBefore(entry, host);
    target.dataset.gdInfo = spec.id;
    const btn = entry.firstElementChild;
    btn.addEventListener('click', () => (host.hidden ? openPanel(spec, btn, host, target) : closePanel(btn, host)));
  }

  function closePanel(btn, host, refocus = true) {
    host.hidden = true; host.replaceChildren(); // destroys the practice draft
    btn.setAttribute('aria-expanded', 'false');
    if (refocus) btn.focus();
  }

  function openPanel(spec, btn, host, target) {
    const hid = uid('gdh');
    const steps = (spec.steps || []).map((s) => (typeof s === 'string' ? s : s.text));
    const details = Object.entries(spec.details || {});
    host.innerHTML = `<section class="gd-panel" aria-labelledby="${hid}">
<div class="gd-phead"><h3 id="${hid}">${esc(spec.title)}</h3><button type="button" class="iconbtn gd-x" aria-label="Close the guide for ${esc(spec.title)}" title="Close (Escape)">${CLEAR_SVG}</button></div>
<p class="gd-explain">${esc(spec.explain)}</p>
${details.length ? `<dl class="kv gd-details">${details.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
<div class="gd-steps" data-gd-steps><span class="eyebrow">Guided steps</span><p class="small gd-progress" aria-live="polite"></p><ol class="gd-steplist">${steps.map((s, i) => `<li data-i="${i}">${esc(s)}</li>`).join('')}</ol>
<div class="row gd-stepnav">${steps.length > 1 ? '<button type="button" class="btn sm" data-gd-back>Back</button><button type="button" class="btn sm primary" data-gd-next>Next</button>' : ''}${spec.stepFocus ? '<button type="button" class="btn sm light" data-gd-show>Show me on the form</button>' : ''}</div></div>
<div class="gd-example"><span class="eyebrow">Worked example</span><dl class="kv"><dt>Sample input</dt><dd class="mono">${esc(spec.example.input)}</dd><dt>Try</dt><dd>${esc(spec.example.action)}</dd><dt>Expected</dt><dd>${esc(spec.example.expected)}</dd></dl></div>
<div class="gd-play" role="group" aria-label="Practice area for ${esc(spec.title)}"><span class="eyebrow">Practice area</span><p class="small">Synthetic sample values only. Nothing here changes your settings, machines or files.</p><div class="gd-fields"></div><output class="gd-result" role="status"></output><div class="gd-sample" aria-hidden="true"></div><div class="row"><button type="button" class="btn sm" data-gd-reset>Reset the example</button></div></div>
<div class="row gd-foot"><span class="small">Help id: <span class="mono">${esc(spec.concept)}</span></span><span class="grow"></span><button type="button" class="btn sm primary" data-gd-done>Done</button></div>
</section>`;
    host.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    const panel = host.firstElementChild;
    // Steps
    let step = 0;
    const showStep = () => {
      panel.querySelector('.gd-progress').textContent = steps.length ? `Step ${step + 1} of ${steps.length}` : '';
      panel.querySelectorAll('.gd-steplist li').forEach((li, i) => { li.classList.toggle('on', i === step); if (i === step) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current'); });
      const back = panel.querySelector('[data-gd-back]'), next = panel.querySelector('[data-gd-next]');
      if (back) { back.disabled = step === 0; back.title = step === 0 ? 'This is the first step' : ''; }
      if (next) { next.disabled = step >= steps.length - 1; next.title = step >= steps.length - 1 ? 'This is the last step' : ''; }
    };
    panel.addEventListener('click', (e) => {
      if (e.target.closest('[data-gd-back]')) { step = Math.max(0, step - 1); showStep(); }
      if (e.target.closest('[data-gd-next]')) { step = Math.min(steps.length - 1, step + 1); showStep(); }
      if (e.target.closest('[data-gd-show]')) {
        const scope = target.closest(spec.scope) || document;
        const f = spec.stepFocus[step] && scope.querySelector(spec.stepFocus[step]);
        if (f) { f.scrollIntoView({ block: 'center', behavior: document.documentElement.dataset.reduceMotion === 'true' ? 'auto' : 'smooth' }); f.focus(); } else toast('That part of the form is not on screen right now.', 'error');
      }
      if (e.target.closest('[data-gd-reset]')) { buildPlay(); panel.querySelector('.gd-fields [data-gd-field]')?.focus(); }
      if (e.target.closest('[data-gd-done], .gd-x')) closePanel(btn, host);
    });
    panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); closePanel(btn, host); } });
    showStep();
    // Practice playground: a fresh draft per opening, never shared between panels.
    const fieldsEl = panel.querySelector('.gd-fields'), out = panel.querySelector('.gd-result'), sample = panel.querySelector('.gd-sample');
    let draft = {};
    function evaluate() {
      let r;
      try { r = spec.play.evaluate(Object.assign({}, draft)); } catch (e) { r = { ok: false, message: 'The practice check failed: ' + e.message }; }
      out.textContent = (r.ok ? 'Result: ' : 'Not accepted: ') + r.message;
      out.className = 'gd-result ' + (r.ok ? 'ok' : 'bad');
      sample.replaceChildren();
      if (r.sample) { const c = document.createElement('div'); c.className = 'gd-mini'; c.dataset.mode = r.sample; c.textContent = 'Sample card'; sample.append(c); }
      if (r.swatch) { const c = document.createElement('span'); c.className = 'gd-chip'; c.style.background = r.swatch; c.textContent = 'Sample chip'; sample.append(c); }
      if (r.motion !== undefined) {
        const track = document.createElement('div'); track.className = 'gd-track'; const dot = document.createElement('i'); track.append(dot); sample.append(track);
        const reduce = document.documentElement.dataset.reduceMotion === 'true' || !r.motion;
        dot.style.transitionDuration = reduce ? '0ms' : (r.ms != null ? r.ms : 500) + 'ms';
        requestAnimationFrame(() => requestAnimationFrame(() => dot.classList.add('go')));
      }
    }
    function buildPlay() {
      draft = {};
      fieldsEl.replaceChildren();
      for (const f of spec.play.fields) {
        draft[f.name] = f.initial;
        const id = uid('gdf');
        let el;
        if (f.kind === 'choice') {
          el = document.createElement('div'); el.className = 'seg sm'; el.setAttribute('role', 'group'); el.setAttribute('aria-label', f.label);
          el.innerHTML = Object.entries(f.options).map(([v, l]) => `<button type="button" data-gd-field data-v="${esc(v)}" aria-pressed="${v === f.initial}">${esc(l)}</button>`).join('');
          el.addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (!b) return; draft[f.name] = b.dataset.v; el.querySelectorAll('[data-v]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); evaluate(); });
        } else if (f.kind === 'switch') {
          el = document.createElement('label'); el.className = 'switch-row';
          el.innerHTML = `<span>${esc(f.label)}</span><input type="checkbox" role="switch" data-gd-field ${f.initial ? 'checked' : ''}>`;
          el.querySelector('input').addEventListener('change', (e) => { draft[f.name] = e.target.checked; evaluate(); });
        } else if (f.kind === 'range') {
          el = document.createElement('label'); el.className = 'field';
          el.innerHTML = `<span>${esc(f.label)}: <b data-gd-val>${esc(f.initial)}</b></span><input type="range" data-gd-field min="${f.min}" max="${f.max}" step="${f.step}" value="${esc(f.initial)}">`;
          el.querySelector('input').addEventListener('input', (e) => { draft[f.name] = Number(e.target.value); el.querySelector('[data-gd-val]').textContent = e.target.value; evaluate(); });
        } else {
          el = document.createElement('label'); el.className = 'field'; el.htmlFor = id;
          const tag = f.kind === 'textarea' ? `<textarea id="${id}" data-gd-field rows="3" spellcheck="false"></textarea>` : `<input id="${id}" data-gd-field class="mono" type="${f.kind === 'password' ? 'password' : 'text'}" autocomplete="off" spellcheck="false">`;
          el.innerHTML = `${esc(f.label)}${tag}`;
          const inp = el.querySelector('[data-gd-field]'); inp.value = f.initial;
          inp.addEventListener('input', () => { draft[f.name] = inp.value; evaluate(); });
        }
        fieldsEl.append(el);
      }
      evaluate();
      decorateClear(fieldsEl);
    }
    buildPlay();
    panel.querySelector('h3').setAttribute('tabindex', '-1');
    panel.querySelector('h3').focus();
  }

  // ---------- Clear controls ----------
  const EDITABLE = 'input:not([type]), input[type="text"], input[type="search"], input[type="password"], input[type="url"], input[type="email"], textarea';
  function fieldName(inp) {
    const l = inp.labels && inp.labels[0];
    let n = '';
    if (l) { const c = l.cloneNode(true); c.querySelectorAll('button, input, textarea, select, .small, .gd-entry, .gd-host').forEach((x) => x.remove()); n = c.textContent.replace(/\s+/g, ' ').trim(); }
    return n || inp.getAttribute('aria-label') || inp.placeholder || 'this field';
  }
  function syncClear(inp, b) {
    const locked = inp.disabled || inp.readOnly;
    b.hidden = locked;
    b.disabled = !inp.value;
    b.title = inp.value ? `Clear ${fieldName(inp)}` : `${fieldName(inp)} is already empty`;
  }
  function attachClear(inp) {
    if (inp.dataset.gdClear || inp.type === 'hidden') return;
    inp.dataset.gdClear = '1';
    const span = document.createElement('span');
    span.className = 'gd-clearwrap' + (inp.closest('.search') ? ' in-search' : '');
    inp.before(span); span.append(inp);
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'gd-clear'; b.innerHTML = CLEAR_SVG;
    b.setAttribute('aria-label', `Clear ${fieldName(inp)}`);
    span.append(b);
    b.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (inp.disabled || inp.readOnly) return;
      inp.value = '';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      syncClear(inp, b);
      inp.focus();
    });
    const sync = () => syncClear(inp, b);
    inp.addEventListener('input', sync); inp.addEventListener('focus', sync); inp.addEventListener('change', sync);
    sync();
  }
  function decorateClear(rootEl) {
    for (const inp of rootEl.querySelectorAll(EDITABLE)) if (!inp.readOnly && !inp.disabled && !inp.closest('[data-gd-noclear]')) attachClear(inp);
    for (const b of rootEl.querySelectorAll('.gd-clear')) { const inp = b.parentElement.querySelector(EDITABLE); if (inp) syncClear(inp, b); }
  }

  // ---------- Provenance ----------
  let prov = null, provAt = 0;
  async function loadProvenance() {
    if (!window.mvlGuidance || typeof window.mvlGuidance.provenance !== 'function') { prov = { unavailable: true }; return; }
    try { prov = await window.mvlGuidance.provenance(); provAt = Date.now(); } catch (e) { prov = { unavailable: true, error: e.message }; }
  }
  function provText(row) {
    const s = row.source;
    if (s.kind === 'none') return s.note;
    if (s.kind === 'main') {
      if (!prov || prov.unavailable) return 'Where this value comes from is unavailable: the settings provenance channel is not connected in this window.';
      const k = prov.keys && prov.keys[s.key];
      if (!k) return 'Where this value comes from is unknown.';
      return k.written ? `Written to settings.json: ${s.label(k.value)}.` : `Not written yet; using the compiled-in default: ${R.MAIN_DEFAULT_LABEL[s.key] || s.label(k.defaultValue)}.`;
    }
    let v = null; try { v = localStorage.getItem(s.key); } catch { /* storage unavailable */ }
    if (v == null) return `Not set on this device; using the built-in default: ${R.LOCAL_DEFAULT_TEXT[s.key] || s.label(s.def)}.`;
    return `Saved on this device: ${s.label(v)}.`;
  }
  function decorateProvenance() {
    const page = document.getElementById('panel-settings'); if (!page) return;
    for (const row of R.SETTINGS) {
      const t = page.querySelector(row.sel); if (!t) continue;
      const anchor = anchorOf(t, row.anchor);
      const wrap = wrapOf(anchor);
      let p = wrap.querySelector(`:scope > [data-gd-prov="${row.id}"]`);
      if (!p) { p = document.createElement('p'); p.className = 'small gd-prov'; p.dataset.gdProv = row.id; wrap.append(p); }
      const txt = provText(row); if (p.textContent !== txt) p.textContent = txt;
    }
  }

  // ---------- Quick add ----------
  // Writes through the Settings row's own control so validation, saving and the page state are one path.
  async function quickSave(key, value) {
    const page = document.getElementById('panel-settings');
    if (key === 'stateRoot') {
      const inp = page && page.querySelector('#sRoot'), apply = page && page.querySelector('#sApply');
      if (inp && apply) { inp.value = value; inp.dispatchEvent(new Event('input', { bubbles: true })); apply.click(); return { ok: true }; }
    }
    if (key === 'defaultNet') {
      const b = page && page.querySelector(`#sNet [data-n="${CSS.escape(value)}"]`);
      if (b) { b.click(); return { ok: true }; }
    }
    if (window.mvl && typeof window.mvl.setSettings === 'function') { await window.mvl.setSettings({ [key]: value }); return { ok: true }; }
    return { ok: false, error: 'Settings cannot be saved from this window.' };
  }
  function currentSetting(key) {
    const page = document.getElementById('panel-settings');
    if (key === 'stateRoot') { const i = page && page.querySelector('#sRoot'); return i ? i.value : ''; }
    if (key === 'defaultNet') { const b = page && page.querySelector('#sNet [aria-pressed="true"]'); return b ? b.dataset.n : 'nat'; }
    return '';
  }
  function attachQuick(el, ptr) {
    if (el.dataset.gdQuick) return;
    let p = ptr;
    if (ptr.kind === 'auto') {
      const key = el.dataset.settingsPointer;
      if (key === 'stateRoot') p = R.POINTERS.find((x) => x.key === 'stateRoot');
      else if (key === 'defaultNet') p = R.POINTERS.find((x) => x.key === 'defaultNet');
      else return;
    }
    el.dataset.gdQuick = p.key;
    const box = document.createElement('div');
    box.className = 'gd-quick'; box.dataset.gdKey = p.key; box.setAttribute('role', 'group'); box.setAttribute('aria-label', 'Quick add: ' + p.label);
    const id = uid('gdq');
    if (p.kind === 'choice') {
      const cur = currentSetting(p.key);
      box.innerHTML = `<span class="small">${esc(p.label)}</span><div class="seg sm" role="group" aria-label="${esc(p.label)}">${Object.entries(p.options).map(([v, l]) => `<button type="button" data-q="${esc(v)}" aria-pressed="${v === cur}">${esc(l)}</button>`).join('')}</div><button type="button" class="btn sm primary" data-q-save>Save as default</button><span class="small gd-qmsg" role="status"></span>`;
      box.addEventListener('click', (e) => { const b = e.target.closest('[data-q]'); if (b) box.querySelectorAll('[data-q]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); });
    } else {
      box.innerHTML = `<label class="field grow" for="${id}">${esc(p.label)}<input id="${id}" class="mono" autocomplete="off" spellcheck="false"></label><button type="button" class="btn sm primary" data-q-save>Save</button><span class="small gd-qmsg" role="status"></span>`;
      box.querySelector('input').value = currentSetting(p.key);
    }
    box.querySelector('[data-q-save]').addEventListener('click', async () => {
      const msg = box.querySelector('.gd-qmsg');
      const value = p.kind === 'choice' ? (box.querySelector('[data-q][aria-pressed="true"]') || {}).dataset?.q : box.querySelector('input').value.trim();
      if (value == null) { msg.textContent = 'Pick one first.'; return; }
      const chk = p.check ? R.CHECKS[p.check](value) : { ok: true };
      if (!chk.ok) { msg.textContent = 'Not saved: ' + chk.message; msg.classList.add('bad'); return; }
      msg.classList.remove('bad');
      const r = await quickSave(p.key, value);
      if (!r.ok) { msg.textContent = 'Not saved: ' + r.error; msg.classList.add('bad'); return; }
      msg.textContent = 'Saved. Settings shows the same value.';
      toast('Saved. Settings shows the same value.');
      setTimeout(() => { loadProvenance().then(schedule); }, 300);
    });
    el.after(box);
    decorateClear(box);
  }

  // ---------- Extension hooks ----------
  const SIZE_MAP = { s: { mem: 8192, cpus: 4 }, m: { mem: 12288, cpus: 8 }, l: { mem: 16384, cpus: 12 } };
  let hookCache = { at: 0, plan: [], receipt: [] };
  async function hookActions() {
    if (!window.mvlExtensions) return hookCache;
    if (Date.now() - hookCache.at < 3000) return hookCache;
    hookCache.at = Date.now();
    try { hookCache.plan = await window.mvlExtensions.actionsFor('machine-plan'); hookCache.receipt = await window.mvlExtensions.actionsFor('receipt'); } catch { hookCache.plan = []; hookCache.receipt = []; }
    return hookCache;
  }
  function checksHTML(r) {
    if (!r.ok) return `<div class="errbox">${esc(r.error)}</div>`;
    const a = r.answer;
    return `<p class="small"><b>${esc(r.extension.name)}</b>: ${esc(a.summary || 'answered')}</p>` + (a.checks ? `<ul class="gd-checks">${a.checks.map((c) => `<li class="${c.status}"><span class="pill ${c.status === 'pass' ? 'lime' : c.status === 'warn' ? 'amber' : 'red'}">${c.status === 'pass' ? 'Pass' : c.status === 'warn' ? 'Warning' : 'Fail'}</span><span><b>${esc(c.title)}</b>${c.detail ? '<br><span class="small">' + esc(c.detail) + '</span>' : ''}</span></li>`).join('')}</ul>` : '');
  }
  async function decorateCreate(sheet) {
    if (sheet.dataset.gdExt) return;
    sheet.dataset.gdExt = '1';
    const { plan } = await hookActions();
    if (!plan.length) return;
    const go = sheet.querySelector('[data-go]'); if (!go) return;
    const box = document.createElement('div');
    box.className = 'gd-extbox';
    box.innerHTML = `<div class="row"><button type="button" class="btn sm" data-gd-extcheck>Check with extensions (${plan.length})</button><span class="small">Runs ${esc(plan.map((p) => p.name).join(', '))} on these choices. The password itself is never handed over.</span></div><div data-gd-extout aria-live="polite"></div>`;
    go.closest('.row').before(box);
    box.querySelector('[data-gd-extcheck]').addEventListener('click', async (e) => {
      const b = e.currentTarget; b.disabled = true;
      const pick = (attr) => { const x = sheet.querySelector(`[${attr}][aria-pressed="true"]`); return x ? x.getAttribute(attr) : null; };
      const val = (n) => { const x = sheet.querySelector(`[data-f="${n}"]`); return x ? x : null; };
      const size = SIZE_MAP[pick('data-size')] || SIZE_MAP.m;
      const ctx = { plan: { name: val('name')?.value.trim(), project: val('project')?.value.trim() || 'general', os: pick('data-os'), hv: pick('data-hv'), mem: size.mem, cpus: size.cpus, net: pick('data-net'), user: val('user')?.value.trim() || 'mvlbuilder', for: pick('data-who') === 'agent' ? 'agent' : 'you', usesDefaultSignIn: !(val('pw')?.value) && !(val('rand')?.checked), requireTpm: !!val('tpm')?.checked } };
      const out = box.querySelector('[data-gd-extout]'); out.innerHTML = '<p class="small">Running&hellip;</p>';
      const results = [];
      for (const a of plan) results.push(await window.mvlExtensions.run(a.id, a.action, ctx));
      out.innerHTML = results.map(checksHTML).join('');
      b.disabled = false;
    });
  }
  async function decorateReceipts(list) {
    const cards = [...list.querySelectorAll('article.card:not([data-gd-ext])')];
    if (!cards.length) return;
    cards.forEach((c) => { c.dataset.gdExt = '1'; });
    const { receipt } = await hookActions();
    if (!receipt.length || !window.mvl || !window.mvl.receipts) return;
    let data; try { data = (await window.mvl.receipts()).receipts || []; } catch { return; }
    for (const card of cards) {
      const head = card.querySelector('strong.mono'); if (!head) continue;
      const r = data.find((x) => `${x.repository || ''}@${String(x.commit || '').slice(0, 10)}` === head.textContent.trim()); if (!r) continue;
      const box = document.createElement('div'); box.className = 'gd-extbox';
      box.innerHTML = `<div class="row">${receipt.map((a, i) => `<button type="button" class="btn sm" data-i="${i}">${esc(a.title)} (${esc(a.name)})</button>`).join('')}</div><div data-gd-extout aria-live="polite"></div>`;
      card.append(box);
      box.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-i]'); if (!b) return;
        const a = receipt[Number(b.dataset.i)]; b.disabled = true;
        const out = box.querySelector('[data-gd-extout]'); out.innerHTML = '<p class="small">Running&hellip;</p>';
        const res = await window.mvlExtensions.run(a.id, a.action, { receipt: r });
        out.replaceChildren();
        if (res.ok && res.answer.report != null && window.MVLRender) { const d = document.createElement('div'); window.MVLRender.render(d, res.answer.report, { label: `${res.extension.name} report` }); out.append(d); }
        else out.innerHTML = checksHTML(res);
        b.disabled = false;
      });
    }
  }

  // ---------- Decorating the page ----------
  function decorate() {
    for (const spec of R.CONTROLS) for (const scope of document.querySelectorAll(spec.scope)) for (const t of scope.querySelectorAll(spec.sel)) if (!t.closest('.gd-panel')) attachInfo(t, spec);
    decorateProvenance();
    for (const p of R.POINTERS) for (const el of document.querySelectorAll(p.sel)) if (!el.closest('.gd-quick, .gd-panel')) attachQuick(el, p);
    decorateClear(document.body);
    if (window.mvlExtensions) {
      for (const s of document.querySelectorAll('.create-sheet:not([data-gd-ext])')) decorateCreate(s);
      const rl = document.getElementById('rList'); if (rl) decorateReceipts(rl);
    }
  }
  let timer = null;
  function schedule() { clearTimeout(timer); timer = setTimeout(() => { observer.disconnect(); try { decorate(); } finally { observer.observe(document.body, { childList: true, subtree: true }); } }, 60); }
  const observer = new MutationObserver(schedule);
  function start() {
    loadProvenance().then(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('change', (e) => { if (e.target.closest('#panel-settings')) setTimeout(() => loadProvenance().then(schedule), 300); });
    document.addEventListener('click', (e) => { if (e.target.closest('#panel-settings button')) setTimeout(() => loadProvenance().then(schedule), 300); });
    window.addEventListener('storage', schedule);
    schedule();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

  // ---------- Audit ----------
  // Lists every inventory item that is on screen without its working parts. Empty `missing` is green.
  function audit() {
    const missing = []; let checked = 0;
    for (const spec of R.CONTROLS) for (const scope of document.querySelectorAll(spec.scope)) for (const t of scope.querySelectorAll(spec.sel)) {
      if (t.closest('.gd-panel')) continue;
      checked++;
      const wrap = anchorOf(t, spec.anchor).parentElement;
      const btn = wrap && wrap.classList.contains('gd-wrap') ? wrap.querySelector(`:scope > .gd-entry > .gd-info[data-gd-for="${spec.id}"]`) : null;
      if (t.dataset.gdInfo !== spec.id) { missing.push({ id: spec.id, problem: 'target not bound' }); continue; }
      if (!btn) { missing.push({ id: spec.id, problem: 'no info button above the control' }); continue; }
      const host = document.getElementById(btn.getAttribute('aria-controls') || '');
      if (!host || host.parentElement !== wrap) missing.push({ id: spec.id, problem: 'no panel bound to the button' });
      if (!(btn.getAttribute('aria-label') || '').includes(spec.title)) missing.push({ id: spec.id, problem: 'accessible name does not name the control' });
      if (btn.disabled || btn.tabIndex < 0) missing.push({ id: spec.id, problem: 'button not keyboard reachable' });
      const r = btn.getBoundingClientRect(); if (r.width && (r.width < 44 || r.height < 44)) missing.push({ id: spec.id, problem: 'target smaller than 44 px' });
      if (!spec.play || !spec.play.fields || !spec.play.fields.length || typeof spec.play.evaluate !== 'function') missing.push({ id: spec.id, problem: 'no playground' });
    }
    const texts = new Map();
    for (const spec of R.CONTROLS) { if (texts.has(spec.explain)) missing.push({ id: spec.id, problem: 'repeats the explanation of ' + texts.get(spec.explain) }); texts.set(spec.explain, spec.id); }
    for (const inp of document.querySelectorAll(EDITABLE)) {
      if (inp.readOnly || inp.disabled || inp.type === 'hidden' || inp.closest('[data-gd-noclear]')) continue;
      checked++;
      const b = inp.parentElement && inp.parentElement.classList.contains('gd-clearwrap') ? inp.parentElement.querySelector('.gd-clear') : null;
      if (!b) missing.push({ id: 'clear:' + (inp.id || inp.dataset.f || inp.getAttribute('aria-label') || inp.name || 'text box'), problem: 'no clear control' });
    }
    for (const p of R.POINTERS) for (const el of document.querySelectorAll(p.sel)) {
      if (p.kind === 'auto' && !['stateRoot', 'defaultNet'].includes(el.dataset.settingsPointer)) continue;
      checked++;
      const q = el.nextElementSibling;
      const key = p.kind === 'auto' ? el.dataset.settingsPointer : p.key;
      if (!q || !q.classList.contains('gd-quick')) missing.push({ id: p.id, problem: 'no quick-add beside the pointer' });
      else if (q.dataset.gdKey !== key) missing.push({ id: p.id, problem: 'quick add writes a different key' });
    }
    const page = document.getElementById('panel-settings');
    if (page) for (const row of R.SETTINGS) { if (!page.querySelector(row.sel)) continue; checked++; if (!page.querySelector(`[data-gd-prov="${row.id}"]`)) missing.push({ id: row.id, problem: 'no provenance line' }); if (!R.CONTROLS.some((c) => c.id === row.id)) missing.push({ id: row.id, problem: 'no explanation' }); }
    return { checked, missing, green: missing.length === 0 };
  }

  window.MVLGuidance = Object.assign(window.MVLGuidance || {}, { audit, decorate: schedule, attachInfo, attachClear, refreshProvenance: () => loadProvenance().then(schedule) });
})();
