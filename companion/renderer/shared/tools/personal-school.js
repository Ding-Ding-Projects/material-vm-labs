'use strict';
// Universal School mode. One shared record (see companion/src/shared/personal-ipc.js) holds the
// on/off state, the user's chosen name and the PBKDF2 hash of the one shared unlock PIN or password.
// While it is on: English only, and Cantonese, bilingual, funny levels, personal vocabulary and every
// dim sum capability behave as not installed (their controls are taken out of the page, not hidden).
// It is a user-experience lock, not a security boundary, and the control says so.
(function () {
  const C = window.MVLPersonalCore;
  const { esc, store, history } = C;
  const SHIPPED = 'School mode';
  const LOCAL_KEY = 'mvl-school-shared';
  // Controls that belong to capabilities School mode treats as not installed.
  const GATED = ['.i18n-control', '.funny-control', '.vocab-control', '.vocab-drop', '.vocab-celebrate', '.dimsum-control', '.dimsum-card', '[data-school-gated]'];
  const bridge = () => (window.mvlPersonal && typeof window.mvlPersonal.schoolRead === 'function' ? window.mvlPersonal : null);

  let rec = { v: 1, on: false, name: '', cred: null };
  let status = { mode: 'starting', error: '', file: '' }; // mode: shared | local | unreadable
  const listeners = new Set();
  const gated = new Map(); // element -> comment placeholder
  let observer = null, started = false;

  const active = () => !!rec.on && status.mode !== 'unreadable';
  const name = () => (rec.name && rec.name.trim()) || SHIPPED;
  const emit = () => { apply(); for (const f of listeners) { try { f({ on: active(), name: name(), status: Object.assign({}, status) }); } catch { /* listener errors stay local */ } } };

  // ---------- record storage ----------
  async function load() {
    const b = bridge();
    if (b) {
      try {
        const r = await b.schoolRead();
        status = { mode: r.ok ? 'shared' : 'unreadable', error: r.ok ? (r.watching ? '' : 'Changes from other apps are picked up when this window regains focus, because the folder cannot be watched.') : r.error, file: r.file || '' };
        if (r.ok) rec = r.record || { v: 1, on: false, name: '', cred: null };
      } catch (e) { status = { mode: 'unreadable', error: 'The shared record could not be read: ' + e.message, file: '' }; }
    } else {
      const v = store.get(LOCAL_KEY, null);
      rec = v && typeof v === 'object' && v.v === 1 ? v : { v: 1, on: false, name: '', cred: null };
      status = { mode: 'local', error: 'The shared record is not reachable from this window, so this setting applies to this app only.', file: '' };
    }
    emit();
  }
  async function save(next) {
    next = Object.assign({ v: 1 }, next, { updatedAt: new Date().toISOString() });
    const b = bridge();
    if (b) {
      const r = await b.schoolWrite(next);
      if (!r || !r.ok) throw new Error((r && r.error) || 'The shared record could not be saved.');
    } else if (!store.set(LOCAL_KEY, next)) throw new Error('Local storage is not available, so nothing was saved.');
    rec = next; status.mode = b ? 'shared' : 'local'; emit();
  }

  // ---------- applying the mode ----------
  function gate(el) {
    if (!el || gated.has(el) || !el.parentNode) return el;
    const mark = document.createComment('school-gated');
    el.parentNode.replaceChild(mark, el);
    gated.set(el, mark);
    return el;
  }
  function ungateAll() { for (const [el, mark] of gated) { if (mark.parentNode) mark.parentNode.replaceChild(el, mark); } gated.clear(); }
  function sweep(root) { for (const sel of GATED) for (const el of (root || document).querySelectorAll(sel)) gate(el); }
  function apply() {
    const on = active();
    const html = document.documentElement;
    if (on) {
      html.dataset.schoolMode = 'on';
      if (window.MVLI18n && window.MVLI18n.mode() !== 'en') C.setLangQuiet('en'); // the saved choice stays stored
      if (document.body) sweep(document.body);
      if (!observer && document.body) { observer = new MutationObserver((list) => { for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1) { if (GATED.some((s) => n.matches(s))) gate(n); else sweep(n); } }); observer.observe(document.body, { childList: true, subtree: true }); }
    } else {
      delete html.dataset.schoolMode;
      if (observer) { observer.disconnect(); observer = null; }
      const had = gated.size > 0;
      ungateAll();
      if (had && window.MVLI18n) { let saved = 'en'; try { saved = localStorage.getItem('mvl-lang') || 'en'; } catch { /* default */ } C.setLangQuiet(saved); }
    }
    retitle();
  }
  function retitle() {
    if (window.MVLTools) window.MVLTools.register(tool());
    // The Tools header was written when the tool opened; keep it in step with a rename.
    for (const panel of document.querySelectorAll('.tools-panel')) { const h = panel.querySelector('.tools-head h2'); if (h && panel.querySelector('.personal-school')) h.textContent = name(); }
    if (window.MVLPalette) window.MVLPalette.register({ id: 'personal-school-open', title: 'Open ' + name() + ' settings', group: 'Personal', keywords: ['lock', 'unlock', 'English only'], run: () => window.MVLTools && window.MVLTools.open('personal-school') });
  }

  // ---------- UI ----------
  function control() {
    const box = document.createElement('section');
    box.className = 'personal-card personal-school';
    const hid = 'ps-' + Math.random().toString(36).slice(2, 7);
    box.setAttribute('aria-labelledby', hid);
    box.innerHTML = `<h3 id="${hid}" data-ps-title></h3>
<label class="switch-row"><span><span data-ps-label></span><br><span class="small" data-ps-desc></span></span><input type="checkbox" role="switch" data-ps-switch></label>
<p class="small" role="status" data-ps-status></p>
<form class="personal-form" data-ps-form hidden novalidate>
  <p data-ps-prompt></p>
  <div class="seg" role="group" aria-label="Unlock credential type" data-ps-kind>
    <button type="button" data-kind="pin" aria-pressed="true">PIN</button><button type="button" data-kind="password" aria-pressed="false">Password</button><button type="button" data-kind="passkey" aria-pressed="false" aria-describedby="${hid}-pk">Passkey</button>
  </div>
  <p class="small" id="${hid}-pk" data-ps-pk hidden>Passkey unlock is not available in this build: the companion pages load from local files, which have no WebAuthn relying party to register a passkey with. Use a PIN or a password.</p>
  <label class="field"><span data-ps-secret-label>PIN</span><input type="password" autocomplete="off" data-ps-secret inputmode="numeric" maxlength="128"></label>
  <label class="field" data-ps-confirm-row><span>Type it again</span><input type="password" autocomplete="off" data-ps-confirm inputmode="numeric" maxlength="128"></label>
  <p class="errbox" role="alert" data-ps-err hidden></p>
  <div class="row"><button type="submit" class="btn primary" data-ps-go></button><button type="button" class="btn" data-ps-cancel>Cancel</button></div>
</form>
<details class="personal-more"><summary>Name and unlock credential</summary>
  <label class="field"><span>Name of this mode</span><input type="text" maxlength="40" data-ps-name autocomplete="off"></label>
  <div class="row"><button type="button" class="btn" data-ps-rename>Save name</button><button type="button" class="btn" data-ps-rename-reset>Use the original name</button></div>
  <div class="row"><button type="button" class="btn" data-ps-change>Change the unlock PIN or password</button></div>
</details>
<p class="small personal-honest" data-ps-honest></p>`;
    const $ = (s) => box.querySelector(s);
    const sw = $('[data-ps-switch]'), form = $('[data-ps-form]'), err = $('[data-ps-err]'), secret = $('[data-ps-secret]'), confirm = $('[data-ps-confirm]');
    let flow = null, kind = 'pin', busy = false;

    function sync() {
      const n = name(), on = active();
      $('[data-ps-title]').textContent = n;
      $('[data-ps-label]').textContent = n;
      $('[data-ps-desc]').textContent = on
        ? 'On. The app shows English only. Turning it off needs the unlock PIN or password.'
        : 'While on: English only, and Cantonese, bilingual mode, funny levels, personal vocabulary and every dim sum feature behave as not installed. Your choices for them are kept and come back when it is off.';
      sw.checked = on;
      sw.disabled = status.mode === 'unreadable' || status.mode === 'starting';
      const st = $('[data-ps-status]');
      st.textContent = status.mode === 'shared' ? 'Shared with every Material VM Labs app on this computer. A change here reaches the others at once.' + (status.error ? ' ' + status.error : '')
        : status.mode === 'local' ? status.error
          : status.mode === 'unreadable' ? 'Unknown state. ' + status.error + ' Fix or delete the shared record to use this switch.' : 'Reading the shared record.';
      st.classList.toggle('warn', status.mode !== 'shared');
      $('[data-ps-name]').placeholder = 'Leave empty for the original name';
      if (document.activeElement !== $('[data-ps-name]')) $('[data-ps-name]').value = rec.name || '';
      $('[data-ps-honest]').textContent = 'This is a user-experience lock, not a security boundary. Anyone who deletes the shared record' + (status.file ? ' (' + status.file + ')' : '') + ' resets it, including the unlock credential. The credential is stored only as a salted PBKDF2 hash and never appears in exports, logs or history.';
      $('[data-ps-change]').disabled = !rec.cred;
    }
    function setKind(k) {
      kind = k;
      for (const b of box.querySelectorAll('[data-kind]')) b.setAttribute('aria-pressed', String(b.dataset.kind === k));
      $('[data-ps-pk]').hidden = k !== 'passkey';
      $('[data-ps-secret-label]').textContent = k === 'password' ? 'Password' : 'PIN';
      for (const i of [secret, confirm]) { i.inputMode = k === 'pin' ? 'numeric' : 'text'; }
      $('[data-ps-go]').disabled = k === 'passkey';
    }
    function openFlow(f) {
      flow = f; err.hidden = true; secret.value = ''; confirm.value = '';
      const creating = f === 'create' || f === 'change-new';
      $('[data-ps-kind]').hidden = !creating; $('[data-ps-pk]').hidden = true;
      $('[data-ps-confirm-row]').hidden = !creating;
      if (!creating) { kind = rec.cred ? rec.cred.kind : 'pin'; $('[data-ps-secret-label]').textContent = kind === 'password' ? 'Password' : 'PIN'; secret.inputMode = kind === 'pin' ? 'numeric' : 'text'; $('[data-ps-go]').disabled = false; } else setKind('pin');
      $('[data-ps-prompt]').textContent = f === 'create' ? 'Choose the unlock PIN or password first. It is shared by every app, and you need it to turn ' + name() + ' off.'
        : f === 'off' ? 'Enter the unlock ' + (kind === 'password' ? 'password' : 'PIN') + ' to turn ' + name() + ' off.'
          : f === 'change-old' ? 'Enter the current unlock ' + (kind === 'password' ? 'password' : 'PIN') + '.' : 'Choose the new unlock PIN or password.';
      $('[data-ps-go]').textContent = f === 'create' ? 'Save and turn on' : f === 'off' ? 'Turn off' : f === 'change-old' ? 'Next' : 'Save the new credential';
      form.hidden = false; secret.focus();
    }
    const closeFlow = () => { flow = null; form.hidden = true; secret.value = ''; confirm.value = ''; sync(); sw.focus(); };
    const fail = (m) => { err.textContent = m; err.hidden = false; secret.select(); };

    sw.addEventListener('change', () => {
      const want = sw.checked; sw.checked = active();
      if (want && !active()) { if (rec.cred) turnOn(); else openFlow('create'); }
      else if (!want && active()) openFlow('off');
    });
    async function turnOn() {
      try { await save(Object.assign({}, rec, { on: true })); history.add('school-mode', 'on', 'Turned on'); notifyChange(true); }
      catch (e) { fail(e.message); form.hidden = false; }
    }
    box.addEventListener('click', (e) => { const k = e.target.closest('[data-kind]'); if (k) setKind(k.dataset.kind); });
    $('[data-ps-cancel]').addEventListener('click', closeFlow);
    form.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); closeFlow(); } });
    let pendingOld = false;
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); if (busy) return; busy = true; err.hidden = true;
      try {
        if (flow === 'create' || flow === 'change-new') {
          const bad = C.checkSecret(kind, secret.value); if (bad) return fail(bad);
          if (secret.value !== confirm.value) return fail('The two entries do not match. Nothing changed.');
          const cred = await C.hashSecret(kind, secret.value);
          if (flow === 'create') { await save(Object.assign({}, rec, { cred, on: true })); history.add('school-mode', 'on', 'Unlock credential set and mode turned on'); notifyChange(true); }
          else { if (!pendingOld) return fail('Enter the current credential first.'); await save(Object.assign({}, rec, { cred })); history.add('school-mode', 'credential', 'Unlock credential changed'); pendingOld = false; }
          closeFlow();
        } else if (flow === 'off' || flow === 'change-old') {
          const ok = await C.verifySecret(secret.value, rec.cred);
          if (!ok) return fail('That does not match the unlock credential. Nothing changed.');
          if (flow === 'off') { await save(Object.assign({}, rec, { on: false })); history.add('school-mode', 'off', 'Turned off'); notifyChange(false); closeFlow(); }
          else { pendingOld = true; openFlow('change-new'); }
        }
      } catch (ex) { fail(ex.message); }
      finally { busy = false; }
    });
    $('[data-ps-change]').addEventListener('click', () => { pendingOld = false; openFlow('change-old'); });
    $('[data-ps-rename]').addEventListener('click', async () => {
      const v = $('[data-ps-name]').value.trim();
      if (v.length > 40) return;
      try { await save(Object.assign({}, rec, { name: v })); history.add('school-mode', 'rename', v ? 'Renamed' : 'Name reset'); toast(v ? 'Renamed to ' + name() + '.' : 'Name reset.'); } catch (e) { fail(e.message); form.hidden = false; }
    });
    $('[data-ps-rename-reset]').addEventListener('click', async () => {
      try { await save(Object.assign({}, rec, { name: '' })); $('[data-ps-name]').value = ''; history.add('school-mode', 'rename', 'Name reset'); toast('Name reset to ' + SHIPPED + '.'); } catch (e) { fail(e.message); form.hidden = false; }
    });
    listeners.add(sync);
    sync();
    return box;
  }
  function toast(m) { if (window.MVL && window.MVL.toast) window.MVL.toast(m, 'info'); }
  function notifyChange(on) { toast(on ? name() + ' is on in every app.' : name() + ' is off in every app.'); }

  function tool() {
    return { id: 'personal-school', title: name(), group: 'Personal', summary: on() ? 'On. English only.' : 'One shared switch for every app.', mount(el) { const c = control(); c.classList.add('in-tool'); el.append(c); } };
  }
  const on = active;

  function init() {
    if (started) return; started = true;
    const b = bridge();
    if (b && typeof b.onSchoolChanged === 'function') b.onSchoolChanged((r) => { if (r && r.ok) { rec = r.record || { v: 1, on: false, name: '', cred: null }; status.mode = 'shared'; status.error = ''; } else if (r) { status = { mode: 'unreadable', error: r.error || 'The shared record could not be read.', file: r.file || status.file }; } emit(); });
    else {
      // Without the shared record: follow other windows of this app through storage events, and poll
      // as well, because pages loaded from files do not always receive those events.
      let last = JSON.stringify(store.get(LOCAL_KEY, null));
      const check = () => { const now = JSON.stringify(store.get(LOCAL_KEY, null)); if (now !== last) { last = now; load(); } };
      window.addEventListener('storage', (e) => { if (e.key === LOCAL_KEY) check(); });
      setInterval(check, 2000);
    }
    window.addEventListener('focus', () => { if (bridge()) load(); });
    load();
  }

  window.MVLPersonal = window.MVLPersonal || {};
  // MVLSchool is the documented hook other modules read: active(), name(), onChange(f), gate(el).
  window.MVLSchool = window.MVLPersonal.school = { init, control, active, name, gate, onChange: (f) => listeners.add(f), shippedName: SHIPPED, _status: () => Object.assign({}, status) };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
