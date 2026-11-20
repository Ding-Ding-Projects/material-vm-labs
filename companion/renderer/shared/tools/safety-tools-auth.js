'use strict';
// Built-in authenticator and QR pairing (Tools, group "Safety").
// Authenticator: TOTP and HOTP entries sealed with AES-GCM under a passphrase-derived key
// (PBKDF2-SHA-256, 600000 iterations) and kept in the operating-system credential store when the
// main process offers it. Secrets live in memory only while unlocked; the vault locks after idle.
// QR pairing: a local secret, an in-process QR of the otpauth:// link, the grouped secret behind an
// explicit reveal, and a typed-back code before anything is saved.
(function () {
  const C = window.MVLSafetyCore, S = window.MVLSafety;
  if (!C || !S || !window.MVLTools) return;
  const { esc } = S;
  const VAULT_KEY = 'authenticator-sealed';
  const PREFS = 'mvl-safety-auth-prefs';

  // ---------- Shared bits ----------
  const hasDetector = () => typeof window.BarcodeDetector === 'function';
  const hasCamera = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  const groupDigits = (c) => (c.length === 6 ? c.slice(0, 3) + ' ' + c.slice(3) : c.length === 8 ? c.slice(0, 4) + ' ' + c.slice(4) : c.slice(0, 3) + ' ' + c.slice(3));
  const label = (e) => (e.issuer ? e.issuer + (e.account ? ', ' + e.account : '') : e.account || 'Unnamed entry');
  function qrBlock(uri, alt) {
    const qr = C.qrEncode(uri);
    return `<figure class="sf-qr">${C.qrSvg(qr, { label: alt, pixels: Math.max(232, (qr.size + 8) * 4) })}<figcaption class="small">Version ${qr.version}, error correction M. Drawn on this device; no network request.</figcaption></figure>`;
  }

  // Reads a QR from an image or the camera only where the platform has a barcode reader.
  async function detectFromImage(blob) {
    if (!hasDetector()) throw new Error('Reading a QR from an image needs a barcode reader that this version of the app does not have. Paste the otpauth:// link instead.');
    const d = new window.BarcodeDetector({ formats: ['qr_code'] });
    const bmp = await createImageBitmap(blob);
    const found = await d.detect(bmp);
    if (!found.length) throw new Error('No QR code was found in that image.');
    return found[0].rawValue;
  }
  function cameraPanel(onValue) {
    const box = document.createElement('div');
    box.className = 'sf-cam';
    if (!hasCamera() || !hasDetector()) {
      box.innerHTML = `<p class="warn">Camera scanning is unavailable here: ${!hasCamera() ? 'no camera access is offered to this window' : 'this version of the app has no barcode reader'}. Paste the otpauth:// link instead.</p>`;
      return { el: box, stop() {} };
    }
    box.innerHTML = '<div class="row"><button type="button" class="btn" data-cam-start>Start the camera</button><button type="button" class="btn light" data-cam-stop disabled>Stop</button></div><video class="sf-video" muted playsinline hidden aria-label="Camera preview"></video><p class="small" role="status" data-cam-msg>The camera stays off until you start it. Frames are read on this device only.</p>';
    const video = box.querySelector('video'), msg = box.querySelector('[data-cam-msg]');
    let stream = null, timer = null;
    function stop() { clearInterval(timer); timer = null; if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; video.hidden = true; box.querySelector('[data-cam-start]').disabled = false; box.querySelector('[data-cam-stop]').disabled = true; }
    box.querySelector('[data-cam-start]').addEventListener('click', async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        video.srcObject = stream; video.hidden = false; await video.play();
        box.querySelector('[data-cam-start]').disabled = true; box.querySelector('[data-cam-stop]').disabled = false;
        msg.textContent = 'Point the camera at the QR code.';
        const d = new window.BarcodeDetector({ formats: ['qr_code'] });
        timer = setInterval(async () => { try { const f = await d.detect(video); if (f.length) { stop(); msg.textContent = 'Read a QR code.'; onValue(f[0].rawValue); } } catch { /* next frame */ } }, 350);
      } catch (e) { stop(); msg.textContent = 'The camera could not start: ' + e.message; }
    });
    box.querySelector('[data-cam-stop]').addEventListener('click', () => { stop(); msg.textContent = 'Camera stopped.'; });
    return { el: box, stop };
  }

  // ---------- Pairing component (QR pairing tool and the toy-lock wizard) ----------
  // opts: { issuer, account, editable, onConfirmed(params) } -> { el, params(), confirmed() }
  function pairing(opts) {
    const o = opts || {};
    const el = document.createElement('div');
    el.className = 'sf-pair';
    let p = { type: 'totp', issuer: o.issuer || 'Material VM Labs', account: o.account || '', secret: '', algorithm: 'SHA1', digits: 6, period: 30 };
    let ok = false;
    el.innerHTML = `<div class="sf-grid">
  <label class="field">Issuer<input data-p="issuer" autocomplete="off" maxlength="120"></label>
  <label class="field">Account<input data-p="account" autocomplete="off" maxlength="200"></label>
  <label class="field">Algorithm<select data-p="algorithm"><option value="SHA1">SHA-1 (most common)</option><option value="SHA256">SHA-256</option><option value="SHA512">SHA-512</option></select></label>
  <label class="field">Digits<select data-p="digits"><option>6</option><option>7</option><option>8</option></select></label>
  <label class="field">Period in seconds<input data-p="period" type="number" min="1" max="86400" step="1" inputmode="numeric"></label>
</div>
<div class="row"><button type="button" class="btn primary" data-gen>Generate a new secret</button></div>
<div data-out hidden>
  <div class="sf-pair-out"><div data-qr></div>
  <div class="sf-pair-side">
    <dl class="kv"><dt>Issuer</dt><dd data-v="issuer"></dd><dt>Account</dt><dd data-v="account"></dd><dt>Algorithm</dt><dd data-v="algorithm"></dd><dt>Digits</dt><dd data-v="digits"></dd><dt>Period</dt><dd data-v="period"></dd></dl>
    <div class="row"><button type="button" class="btn light" data-reveal aria-expanded="false">Show the secret as text</button></div>
    <div data-secret hidden><p class="mono sf-secret" data-i18n-skip data-vocab-skip></p><div class="row"><button type="button" class="btn sm" data-copy-secret>Copy secret</button><button type="button" class="btn sm" data-copy-uri>Copy link</button></div></div>
  </div></div>
  <label class="field">Type the current code from your authenticator<input data-confirm inputmode="numeric" autocomplete="one-time-code" maxlength="8" class="mono"></label>
  <div class="row"><button type="button" class="btn primary" data-check>Check the code</button></div>
  <p role="status" class="small" data-pair-msg>Scan the QR, then type the code it shows. Nothing is saved until a code matches.</p>
</div>`;
    const q = (s) => el.querySelector(s);
    for (const k of ['issuer', 'account', 'algorithm', 'digits', 'period']) q(`[data-p="${k}"]`).value = String(p[k]);
    if (o.editable === false) { q('[data-p="issuer"]').readOnly = true; }
    function read() {
      p = Object.assign({}, p, { issuer: q('[data-p="issuer"]').value.trim(), account: q('[data-p="account"]').value.trim(), algorithm: C.normAlg(q('[data-p="algorithm"]').value), digits: C.normDigits(q('[data-p="digits"]').value), period: C.normPeriod(q('[data-p="period"]').value) });
    }
    function draw() {
      const uri = C.buildOtpauth(p);
      q('[data-qr]').innerHTML = qrBlock(uri, `QR code that pairs an authenticator with ${p.issuer || 'this app'}${p.account ? ', account ' + p.account : ''}. It contains the secret.`);
      for (const k of ['issuer', 'account', 'algorithm', 'digits', 'period']) q(`[data-v="${k}"]`).textContent = k === 'period' ? p.period + ' seconds' : k === 'algorithm' ? p.algorithm.replace('SHA', 'SHA-') : String(p[k] || 'none');
      q('[data-secret] p').textContent = C.groupBase32(p.secret);
      q('[data-out]').hidden = false;
    }
    q('[data-gen]').addEventListener('click', () => {
      try { read(); } catch (e) { q('[data-pair-msg]').textContent = e.message; q('[data-out]').hidden = false; return; }
      p.secret = C.newSecret(20); ok = false;
      q('[data-secret]').hidden = true; q('[data-reveal]').setAttribute('aria-expanded', 'false'); q('[data-reveal]').textContent = 'Show the secret as text';
      draw(); q('[data-pair-msg]').textContent = 'Scan the QR, then type the code it shows. Nothing is saved until a code matches.';
      if (o.onChange) o.onChange(false);
    });
    el.addEventListener('change', (e) => {
      if (!e.target.matches('[data-p]') || !p.secret) return;
      try { read(); ok = false; draw(); q('[data-pair-msg]').textContent = 'Settings changed. Scan the new QR, then type its code.'; if (o.onChange) o.onChange(false); } catch (err) { q('[data-pair-msg]').textContent = err.message; }
    });
    q('[data-reveal]').addEventListener('click', (e) => { const sec = q('[data-secret]'); sec.hidden = !sec.hidden; e.currentTarget.setAttribute('aria-expanded', String(!sec.hidden)); e.currentTarget.textContent = sec.hidden ? 'Show the secret as text' : 'Hide the secret'; });
    q('[data-copy-secret]').addEventListener('click', () => S.copy(C.cleanBase32(p.secret), 'Secret copied'));
    q('[data-copy-uri]').addEventListener('click', () => S.copy(C.buildOtpauth(p), 'Link copied'));
    async function check() {
      const code = q('[data-confirm]').value.replace(/\s/g, '');
      const m = await C.verifyTotp(p.secret, code, p, Date.now(), 1);
      const msg = q('[data-pair-msg]');
      if (m == null) { ok = false; msg.textContent = 'That code did not match. Check that you scanned this QR and that both clocks are right, then try the next code.'; msg.className = 'small sf-bad'; if (o.onChange) o.onChange(false); return; }
      ok = true; msg.textContent = 'Paired: the code matched.'; msg.className = 'small sf-good';
      if (o.onChange) o.onChange(true);
      if (o.onConfirmed) o.onConfirmed(Object.assign({}, p));
    }
    q('[data-check]').addEventListener('click', check);
    q('[data-confirm]').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); check(); } });
    return { el, params: () => Object.assign({}, p), confirmed: () => ok };
  }

  // ---------- Authenticator state (kept across tool visits, wiped on lock) ----------
  const A = { key: null, salt: null, iterations: 0, entries: [], unlocked: false, idleTimer: null, where: null, view: null };
  const prefs = () => Object.assign({ idleMin: 2 }, S.store.get(PREFS, {}));
  function bumpIdle() {
    clearTimeout(A.idleTimer);
    if (!A.unlocked) return;
    A.idleTimer = setTimeout(() => lock('Locked after being idle.'), prefs().idleMin * 60000);
  }
  function lock(why) {
    A.key = null; A.salt = null; A.entries = []; A.unlocked = false; clearTimeout(A.idleTimer);
    if (A.view) A.view.render(why);
  }
  for (const ev of ['pointerdown', 'keydown', 'wheel']) document.addEventListener(ev, () => { if (A.unlocked) bumpIdle(); }, { capture: true, passive: true });
  async function readBox() { const raw = await S.vault.get(VAULT_KEY); return raw ? JSON.parse(raw) : null; }
  async function persist() {
    const box = await C.sealWithKey({ v: 1, entries: A.entries }, A.key, A.salt, A.iterations);
    await S.vault.set(VAULT_KEY, JSON.stringify(box));
    return box;
  }
  const uid = () => 'e' + Array.from(C.randomBytes(6), (b) => b.toString(16).padStart(2, '0')).join('');
  function sameEntry(a, b) { return C.cleanBase32(a.secret) === C.cleanBase32(b.secret) && a.issuer === b.issuer && a.account === b.account; }
  function addEntries(list) {
    let added = 0, dup = 0;
    for (const e of list) {
      if (A.entries.some((x) => sameEntry(x, e))) { dup++; continue; }
      A.entries.push(Object.assign({ id: uid(), group: '' }, e)); added++;
    }
    return { added, dup };
  }

  // ---------- Authenticator UI ----------
  function mountAuthenticator(root, ctx) {
    root.innerHTML = `<div class="sf">
<p class="small">Codes are made on this device from secrets you add. No account, no sync, no network. ${hasDetector() ? '' : 'QR images and camera scanning are unavailable in this version (no barcode reader); paste links or type secrets instead.'}</p>
<div data-gate></div><div data-main hidden></div><div class="sr" aria-live="polite" data-live></div></div>`;
    const gate = root.querySelector('[data-gate]'), main = root.querySelector('[data-main]'), live = root.querySelector('[data-live]');
    let tick = null, search = null, selected = new Set(), groupFilter = '', codes = {};
    const announce = (t) => { live.textContent = ''; setTimeout(() => { live.textContent = t; }, 30); };

    async function renderGate(why) {
      main.hidden = true; gate.hidden = false; clearInterval(tick);
      let box = null, err = '';
      try { box = await readBox(); } catch (e) { err = e.message; }
      const where = await S.vaultWhere();
      if (err) { gate.innerHTML = `<p class="errbox">The sealed entries could not be read: ${esc(err)}</p>`; return; }
      if (!box) {
        gate.innerHTML = `<form class="card sf-gate" data-create><h3>Create a passphrase</h3>
<p class="small">Your entries are sealed with AES-GCM under a key made from this passphrase (PBKDF2, 600000 rounds). ${esc(where.text)}</p>
<p class="warn">There is no recovery for a forgotten passphrase. Without it, the sealed entries cannot be opened by anyone, including this app.</p>
<label class="field">Passphrase, at least 8 characters<input type="password" data-pass autocomplete="new-password" minlength="8" maxlength="256" required></label>
<label class="field">Repeat it<input type="password" data-pass2 autocomplete="new-password" maxlength="256" required></label>
<div class="row"><button type="submit" class="btn primary">Create the vault</button></div><p role="status" class="small" data-msg>${esc(why || '')}</p></form>`;
        gate.querySelector('[data-create]').addEventListener('submit', async (e) => {
          e.preventDefault();
          const a = gate.querySelector('[data-pass]').value, b = gate.querySelector('[data-pass2]').value, msg = gate.querySelector('[data-msg]');
          if (a.length < 8) { msg.textContent = 'Use at least 8 characters.'; return; }
          if (a !== b) { msg.textContent = 'The two passphrases differ.'; return; }
          msg.textContent = 'Sealing...';
          try {
            const s = await C.seal({ v: 1, entries: [] }, a);
            await S.vault.set(VAULT_KEY, JSON.stringify(s.box));
            Object.assign(A, { key: s.key, salt: s.salt, iterations: s.iterations, entries: [], unlocked: true });
            bumpIdle(); renderMain();
          } catch (err2) { msg.textContent = 'Could not create the vault: ' + err2.message; }
        });
        return;
      }
      gate.innerHTML = `<form class="card sf-gate" data-open><h3>Unlock the authenticator</h3><p class="small">${esc(where.text)}</p>
<label class="field">Passphrase<input type="password" data-pass autocomplete="current-password" maxlength="256" required></label>
<div class="row"><button type="submit" class="btn primary">Unlock</button><button type="button" class="btn light" data-reset>Delete the vault...</button></div>
<p role="status" class="small" data-msg>${esc(why || 'Locked.')}</p></form>`;
      gate.querySelector('[data-open]').addEventListener('submit', async (e) => {
        e.preventDefault();
        const msg = gate.querySelector('[data-msg]');
        msg.textContent = 'Opening...';
        try {
          const r = await C.unseal(box, gate.querySelector('[data-pass]').value);
          Object.assign(A, { key: r.key, salt: r.salt, iterations: r.iterations, entries: Array.isArray(r.data.entries) ? r.data.entries : [], unlocked: true });
          bumpIdle(); renderMain();
        } catch { msg.textContent = 'That passphrase did not open the vault.'; msg.className = 'small sf-bad'; gate.querySelector('[data-pass]').select(); }
      });
      gate.querySelector('[data-reset]').addEventListener('click', async (e) => {
        const yes = await S.confirm(ctx, { action: 'Delete the authenticator vault', affected: 'Every sealed authenticator entry on this computer. Codes from them stop working here; your accounts are not changed.', anchor: e.currentTarget });
        if (!yes) return;
        await S.vault.del(VAULT_KEY); ctx.toast('The authenticator vault was deleted.', 'success'); renderGate('');
      });
      setTimeout(() => { const f = gate.querySelector('[data-pass]'); if (f) f.focus(); }, 0);
    }

    function renderMain() {
      gate.hidden = true; main.hidden = false;
      const pr = prefs();
      main.innerHTML = `<div class="row sf-bar"><span class="chipst" data-where></span><span class="grow"></span>
<label class="field sf-inline">Lock after idle<select data-idle>${[1, 2, 5, 10, 30].map((m) => `<option value="${m}"${m === pr.idleMin ? ' selected' : ''}>${m} min</option>`).join('')}</select></label>
<button type="button" class="btn" data-lock>Lock now</button></div>
<p class="small" data-clock role="status"></p>
<details class="card sf-add"${A.entries.length ? '' : ' open'}><summary>Add an entry</summary>
  <div class="seg sm" role="group" aria-label="How to add" data-how-group>${[['link', 'Paste a link'], ['manual', 'Type it in'], ['image', 'QR image'], ['camera', 'Camera']].map(([k, l], i) => `<button type="button" data-how="${k}" aria-pressed="${i === 0}">${l}</button>`).join('')}</div>
  <div data-how-panel></div>
</details>
<div data-search></div>
<div class="row sf-bar" data-groups></div>
<div class="row sf-bar"><button type="button" class="btn sm" data-sel-all>Select all shown</button><span class="small" data-sel-n>0 selected</span><span class="grow"></span>
  <label class="field sf-inline">Group<input data-group-name maxlength="40" placeholder="Group name"></label><button type="button" class="btn sm" data-group-set>Move selected</button>
  <button type="button" class="btn sm danger" data-del-sel>Delete selected</button></div>
<ul class="sf-list" data-list aria-label="Authenticator entries"></ul>
<details class="card"><summary>Export and import</summary>
  <p class="small">Ordinary exports leave the secrets out and say so in the file. A sealed backup keeps them encrypted under this passphrase.</p>
  <div class="row"><button type="button" class="btn" data-exp-plain>Export without secrets</button><button type="button" class="btn" data-exp-sealed>Export sealed backup</button><button type="button" class="btn danger" data-exp-clear>Export secrets in clear text...</button></div>
  <label class="field">Import a sealed backup, or a text file of otpauth:// links<input type="file" accept=".json,.txt,application/json,text/plain" data-imp></label>
  <label class="field" data-imp-pass-row hidden>Passphrase of that backup<input type="password" data-imp-pass autocomplete="off"></label>
  <div class="row" data-imp-go-row hidden><button type="button" class="btn primary" data-imp-go>Open and import</button></div>
  <p class="small" role="status" data-imp-msg></p>
</details>`;
      S.vaultWhere().then((w) => { const c = main.querySelector('[data-where]'); if (c) { c.textContent = w.where === 'vault' ? 'Sealed in the credential store' : 'Sealed in local storage'; c.title = w.text; } });
      main.querySelector('[data-idle]').addEventListener('change', (e) => { S.store.set(PREFS, Object.assign(prefs(), { idleMin: +e.target.value })); bumpIdle(); });
      main.querySelector('[data-lock]').addEventListener('click', () => lock('Locked.'));
      search = window.MVL.makeSearch({ placeholder: 'Search entries', label: 'Search authenticator entries', onChange: () => drawList() });
      main.querySelector('[data-search]').append(search.el);
      wireAdd(); wireBulk(); wireExport();
      drawList(); startTick();
    }

    // Add panel
    function wireAdd() {
      const panel = main.querySelector('[data-how-panel]');
      let cam = null;
      function show(how) {
        if (cam) { cam.stop(); cam = null; }
        for (const b of main.querySelectorAll('[data-how]')) b.setAttribute('aria-pressed', String(b.dataset.how === how));
        if (how === 'link') {
          panel.innerHTML = '<label class="field">One or more otpauth:// links, one per line<textarea data-links rows="3" class="mono sf-ta" spellcheck="false" autocomplete="off"></textarea></label><label class="field">Group (optional)<input data-g maxlength="40"></label><div class="row"><button type="button" class="btn primary" data-add-links>Add</button></div><p class="small" role="status" data-add-msg>Parameters in the link are kept as given.</p>';
          panel.querySelector('[data-add-links]').addEventListener('click', () => addFromText(panel.querySelector('[data-links]').value, panel.querySelector('[data-g]').value, panel.querySelector('[data-add-msg]')));
        } else if (how === 'manual') {
          panel.innerHTML = `<div class="sf-grid"><label class="field">Issuer<input data-m="issuer" maxlength="120"></label><label class="field">Account<input data-m="account" maxlength="200"></label>
<label class="field">Secret (base32)<input data-m="secret" type="password" autocomplete="off" spellcheck="false" class="mono"></label>
<label class="field">Type<select data-m="type"><option value="totp">Time-based (TOTP)</option><option value="hotp">Counter-based (HOTP)</option></select></label>
<label class="field">Algorithm<select data-m="algorithm"><option value="SHA1">SHA-1</option><option value="SHA256">SHA-256</option><option value="SHA512">SHA-512</option></select></label>
<label class="field">Digits<select data-m="digits"><option>6</option><option>7</option><option>8</option></select></label>
<label class="field">Period in seconds<input data-m="period" type="number" min="1" max="86400" value="30"></label>
<label class="field">Counter (HOTP)<input data-m="counter" type="number" min="0" value="0"></label>
<label class="field">Group (optional)<input data-m="group" maxlength="40"></label></div>
<div class="row"><button type="button" class="btn primary" data-add-manual>Add</button></div><p class="small" role="status" data-add-msg>Defaults are SHA-1, 6 digits, 30 seconds, as most services issue.</p>`;
          panel.querySelector('[data-add-manual]').addEventListener('click', async () => {
            const v = (k) => panel.querySelector(`[data-m="${k}"]`).value;
            const msg = panel.querySelector('[data-add-msg]');
            try {
              const type = v('type') === 'hotp' ? 'hotp' : 'totp';
              const e = { type, issuer: v('issuer').trim(), account: v('account').trim(), secret: C.cleanBase32(v('secret')), algorithm: C.normAlg(v('algorithm')), digits: C.normDigits(v('digits')), group: v('group').trim() };
              C.base32Decode(e.secret);
              if (type === 'totp') e.period = C.normPeriod(v('period')); else { e.counter = Number(v('counter')); if (!Number.isSafeInteger(e.counter) || e.counter < 0) throw new Error('The counter must be a whole number from 0.'); }
              if (!e.issuer && !e.account) throw new Error('Give it an issuer or an account name.');
              const r = addEntries([e]);
              await persist(); drawList();
              msg.textContent = r.added ? 'Added ' + label(e) + '.' : 'That entry is already here.';
              if (r.added) panel.querySelector('[data-m="secret"]').value = '';
            } catch (err) { msg.textContent = err.message; }
          });
        } else if (how === 'image') {
          panel.innerHTML = `${hasDetector() ? '' : '<p class="warn">Reading QR images is unavailable here: this version of the app has no barcode reader. Paste the otpauth:// link instead.</p>'}<label class="field">QR image file<input type="file" accept="image/*" data-img${hasDetector() ? '' : ' disabled'}></label><div class="row"><button type="button" class="btn" data-clip${hasDetector() ? '' : ' disabled'}>Read a QR image from the clipboard</button></div><p class="small" role="status" data-add-msg></p>`;
          const msg = panel.querySelector('[data-add-msg]');
          panel.querySelector('[data-img]').addEventListener('change', async (e) => { const f = e.target.files[0]; if (!f) return; try { await addFromText(await detectFromImage(f), '', msg); } catch (err) { msg.textContent = err.message; } });
          panel.querySelector('[data-clip]').addEventListener('click', async () => {
            try {
              if (!navigator.clipboard || !navigator.clipboard.read) throw new Error('Reading images from the clipboard is not available here.');
              const items = await navigator.clipboard.read();
              const it = items.find((i) => i.types.some((t) => t.startsWith('image/')));
              if (!it) throw new Error('The clipboard has no image.');
              const blob = await it.getType(it.types.find((t) => t.startsWith('image/')));
              await addFromText(await detectFromImage(blob), '', msg);
            } catch (err) { msg.textContent = err.message; }
          });
        } else {
          cam = cameraPanel((val) => addFromText(val, '', panel.querySelector('[data-add-msg]')));
          panel.innerHTML = ''; panel.append(cam.el);
          panel.insertAdjacentHTML('beforeend', '<p class="small" role="status" data-add-msg></p>');
        }
      }
      main.querySelector('[data-how-group]').addEventListener('click', (e) => { const b = e.target.closest('[data-how]'); if (b) show(b.dataset.how); });
      show('link');
    }
    async function addFromText(text, group, msg) {
      const lines = String(text || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      const ok = [], bad = [];
      for (const l of lines.slice(0, 500)) { try { ok.push(Object.assign(C.parseOtpauth(l), { group: (group || '').trim().slice(0, 40) })); } catch (e) { bad.push(e.message); } }
      if (!ok.length) { msg.textContent = bad[0] || 'Nothing to add.'; return; }
      const r = addEntries(ok);
      await persist(); drawList();
      msg.textContent = `Added ${r.added}.` + (r.dup ? ` ${r.dup} already here.` : '') + (bad.length ? ` ${bad.length} could not be read: ${bad[0]}` : '');
    }

    // List
    function shown() {
      return A.entries.filter((e) => (!groupFilter || e.group === groupFilter) && (!search || !search.active() || search.test([e.issuer, e.account, e.group].join(' '))));
    }
    function drawGroups() {
      const gs = [...new Set(A.entries.map((e) => e.group).filter(Boolean))].sort();
      const box = main.querySelector('[data-groups]');
      if (!gs.length) { box.innerHTML = ''; return; }
      box.innerHTML = `<div class="seg sm" role="group" aria-label="Filter by group"><button type="button" data-gf="" aria-pressed="${!groupFilter}">All <span class="n">${A.entries.length}</span></button>${gs.map((g) => `<button type="button" data-gf="${esc(g)}" aria-pressed="${groupFilter === g}">${esc(g)} <span class="n">${A.entries.filter((e) => e.group === g).length}</span></button>`).join('')}</div>`;
      box.querySelector('[role=group]').addEventListener('click', (e) => { const b = e.target.closest('[data-gf]'); if (b) { groupFilter = b.dataset.gf; drawList(); } });
    }
    function drawList() {
      if (!A.unlocked) return;
      drawGroups();
      const list = main.querySelector('[data-list]'), items = shown();
      if (search) search.setStatus(`${items.length} of ${A.entries.length}`);
      if (!A.entries.length) { list.innerHTML = '<li class="empty-note">No entries yet. Add one above, or pair a new one in QR pairing.</li>'; updateSel(); return; }
      if (!items.length) { list.innerHTML = '<li class="empty-note">Nothing matches that search.</li>'; updateSel(); return; }
      list.innerHTML = items.map((e) => `<li class="sf-entry" data-id="${esc(e.id)}">
<input type="checkbox" class="sf-check" data-sel aria-label="Select ${esc(label(e))}"${selected.has(e.id) ? ' checked' : ''}>
<div class="sf-entry-main"><div class="sf-entry-name"><strong>${esc(e.issuer || e.account || 'Unnamed')}</strong>${e.issuer && e.account ? `<span class="small">${esc(e.account)}</span>` : ''}${e.group ? `<span class="chip">${esc(e.group)}</span>` : ''}<span class="chip">${e.type === 'hotp' ? 'HOTP' : esc(e.period + ' s')} ${esc(e.algorithm.replace('SHA', 'SHA-'))} ${esc(e.digits)}</span></div>
<p class="sf-code" aria-live="polite" aria-atomic="true"><span class="sr">Code for ${esc(label(e))}: </span><span class="mono sf-digits" data-code data-i18n-skip data-vocab-skip>&nbsp;</span></p>
<p class="small" data-next></p></div>
<div class="sf-ring" data-ring aria-hidden="true"></div>
<div class="sf-entry-actions"><button type="button" class="btn sm primary" data-copy>Copy</button>${e.type === 'hotp' ? '<button type="button" class="btn sm" data-hotp-next>Next code</button>' : ''}
<button type="button" class="iconbtn" data-up aria-label="Move ${esc(label(e))} up">&uarr;</button><button type="button" class="iconbtn" data-down aria-label="Move ${esc(label(e))} down">&darr;</button>
<button type="button" class="btn sm" data-edit>Edit</button><button type="button" class="btn sm" data-qr-show>QR</button>${e.type === 'hotp' ? '' : '<button type="button" class="btn sm" data-clockchk>Clock check</button>'}<button type="button" class="btn sm danger" data-del>Delete</button></div></li>`).join('');
      codes = {};
      updateSel(); refreshCodes(true);
    }
    function updateSel() {
      for (const id of [...selected]) if (!A.entries.some((e) => e.id === id)) selected.delete(id);
      main.querySelector('[data-sel-n]').textContent = selected.size + ' selected';
    }
    async function refreshCodes(force) {
      if (!A.unlocked) return;
      const now = Date.now();
      for (const li of main.querySelectorAll('.sf-entry')) {
        const e = A.entries.find((x) => x.id === li.dataset.id); if (!e) continue;
        try {
          if (e.type === 'hotp') {
            if (force || !codes[e.id]) { codes[e.id] = { code: await C.hotp(e.secret, e.counter || 0, e) }; li.querySelector('[data-code]').textContent = groupDigits(codes[e.id].code); li.querySelector('[data-next]').textContent = `Counter ${e.counter || 0}. Press Next code after using this one.`; }
            li.querySelector('[data-ring]').innerHTML = '';
            continue;
          }
          const cur = await C.totp(e.secret, now, e);
          if (force || !codes[e.id] || codes[e.id].counter !== cur.counter) {
            const nxt = await C.totp(e.secret, now + e.period * 1000, e);
            codes[e.id] = { counter: cur.counter, code: cur.code };
            li.querySelector('[data-code]').textContent = groupDigits(cur.code);
            li.querySelector('[data-next]').textContent = 'Next: ' + groupDigits(nxt.code);
          }
          const frac = cur.remaining / e.period;
          li.querySelector('[data-ring]').innerHTML = window.MVL.ring(56, frac, cur.remaining <= 5 ? 'var(--bad, #b3261e)' : 'var(--md-sys-color-primary)', String(cur.remaining)) + `<span class="small">${cur.remaining} s left</span>`;
          li.classList.toggle('sf-soon', cur.remaining <= 5);
        } catch (err) { li.querySelector('[data-code]').textContent = 'Error'; li.querySelector('[data-next]').textContent = err.message; }
      }
      clockNote();
    }
    let lastWall = Date.now(), lastMono = performance.now(), jump = 0;
    function clockNote() {
      const w = Date.now(), m = performance.now();
      const drift = (w - lastWall) - (m - lastMono);
      if (Math.abs(drift) > 5000) jump = drift;
      lastWall = w; lastMono = m;
      const el = main.querySelector('[data-clock]'); if (!el) return;
      el.textContent = jump ? `The system clock jumped by about ${Math.round(Math.abs(jump) / 1000)} seconds ${jump > 0 ? 'forward' : 'back'} while this was open. If codes are refused, set the clock to update automatically.` : 'Codes use this computer\'s clock. This app has no network, so it cannot check the time by itself; use Clock check on an entry to compare with another device.';
    }
    function startTick() { clearInterval(tick); tick = setInterval(() => refreshCodes(false), 1000); }

    function wireBulk() {
      const list = main.querySelector('[data-list]');
      list.addEventListener('change', (e) => { if (e.target.matches('[data-sel]')) { const id = e.target.closest('[data-id]').dataset.id; if (e.target.checked) selected.add(id); else selected.delete(id); updateSel(); } });
      list.addEventListener('click', async (ev) => {
        const li = ev.target.closest('[data-id]'); if (!li) return;
        const e = A.entries.find((x) => x.id === li.dataset.id); if (!e) return;
        const b = ev.target.closest('button'); if (!b) return;
        if (b.matches('[data-copy]')) { const c = codes[e.id]; if (c) S.copy(c.code, 'Code copied'); }
        else if (b.matches('[data-hotp-next]')) { e.counter = (e.counter || 0) + 1; await persist(); codes[e.id] = null; refreshCodes(true); announce('New code ready.'); }
        else if (b.matches('[data-up], [data-down]')) {
          const i = A.entries.indexOf(e), j = i + (b.matches('[data-up]') ? -1 : 1);
          if (j < 0 || j >= A.entries.length) return;
          [A.entries[i], A.entries[j]] = [A.entries[j], A.entries[i]];
          await persist(); drawList();
          const nb = main.querySelector(`[data-id="${e.id}"] ${b.matches('[data-up]') ? '[data-up]' : '[data-down]'}`); if (nb) nb.focus();
          announce(`Moved ${label(e)} to position ${A.entries.indexOf(e) + 1}.`);
        } else if (b.matches('[data-del]')) {
          const yes = await S.confirm(ctx, { action: 'Delete ' + label(e), affected: 'This authenticator entry and its secret on this computer. The account itself is not changed.', anchor: b });
          if (!yes) return;
          A.entries = A.entries.filter((x) => x !== e); selected.delete(e.id); await persist(); drawList(); ctx.toast('Deleted ' + label(e) + '.', 'success');
        } else if (b.matches('[data-edit]')) editPop(b, e);
        else if (b.matches('[data-qr-show]')) qrPop(b, e);
        else if (b.matches('[data-clockchk]')) clockPop(b, e);
      });
      main.querySelector('[data-sel-all]').addEventListener('click', () => { for (const e of shown()) selected.add(e.id); drawList(); });
      main.querySelector('[data-group-set]').addEventListener('click', async () => {
        if (!selected.size) { ctx.toast('Select entries first.', 'info'); return; }
        const g = main.querySelector('[data-group-name]').value.trim().slice(0, 40);
        for (const e of A.entries) if (selected.has(e.id)) e.group = g;
        await persist(); drawList(); ctx.toast(g ? `Moved ${selected.size} to ${g}.` : `Removed the group from ${selected.size}.`, 'success');
      });
      main.querySelector('[data-del-sel]').addEventListener('click', async (ev) => {
        if (!selected.size) { ctx.toast('Select entries first.', 'info'); return; }
        const n = selected.size;
        const yes = await S.confirm(ctx, { action: `Delete ${n} authenticator ${n === 1 ? 'entry' : 'entries'}`, affected: 'The selected entries and their secrets on this computer. The accounts themselves are not changed.', anchor: ev.currentTarget });
        if (!yes) return;
        A.entries = A.entries.filter((e) => !selected.has(e.id)); selected.clear(); await persist(); drawList(); ctx.toast(`Deleted ${n}.`, 'success');
      });
    }
    function editPop(btn, e) {
      const pop = S.popover(btn, { label: 'Edit ' + label(e) });
      pop.el.innerHTML = `<h3>Edit entry</h3><label class="field">Issuer<input data-e="issuer" maxlength="120" value="${esc(e.issuer)}"></label><label class="field">Account<input data-e="account" maxlength="200" value="${esc(e.account)}"></label><label class="field">Group<input data-e="group" maxlength="40" value="${esc(e.group || '')}"></label><p class="small">The secret and its settings stay as they are.</p><div class="row"><button type="button" class="btn primary" data-save>Save</button><button type="button" class="btn light" data-cancel>Cancel</button></div>`;
      pop.place(); pop.el.querySelector('input').focus();
      pop.el.querySelector('[data-cancel]').addEventListener('click', () => pop.close());
      pop.el.querySelector('[data-save]').addEventListener('click', async () => {
        const v = (k) => pop.el.querySelector(`[data-e="${k}"]`).value.trim();
        if (!v('issuer') && !v('account')) { ctx.toast('Give it an issuer or an account name.', 'warning'); return; }
        e.issuer = v('issuer'); e.account = v('account'); e.group = v('group');
        await persist(); pop.close(true); drawList(); const nb = main.querySelector(`[data-id="${e.id}"] [data-edit]`); if (nb) nb.focus();
      });
    }
    function qrPop(btn, e) {
      const pop = S.popover(btn, { label: 'QR code for ' + label(e) });
      pop.el.innerHTML = `<h3>QR for ${esc(label(e))}</h3><p class="small">This QR contains the secret. Show it only where nobody else can see the screen.</p>${qrBlock(C.buildOtpauth(e), 'QR code for ' + label(e) + '. It contains the secret.')}<div class="row"><button type="button" class="btn light" data-rev aria-expanded="false">Show the secret as text</button><button type="button" class="btn" data-close>Close</button></div><p class="mono sf-secret" data-sec hidden data-i18n-skip data-vocab-skip></p>`;
      pop.place(); pop.el.querySelector('[data-close]').focus();
      pop.el.querySelector('[data-close]').addEventListener('click', () => pop.close());
      pop.el.querySelector('[data-rev]').addEventListener('click', (ev) => { const s = pop.el.querySelector('[data-sec]'); s.hidden = !s.hidden; s.textContent = s.hidden ? '' : C.groupBase32(e.secret); ev.currentTarget.setAttribute('aria-expanded', String(!s.hidden)); ev.currentTarget.textContent = s.hidden ? 'Show the secret as text' : 'Hide the secret'; pop.place(); });
    }
    function clockPop(btn, e) {
      const pop = S.popover(btn, { label: 'Clock check for ' + label(e) });
      pop.el.innerHTML = `<h3>Clock check</h3><p class="small">Type the code another device shows for ${esc(label(e))} right now. This compares the two clocks without any network.</p><label class="field">Code from the other device<input data-c inputmode="numeric" maxlength="8" class="mono" autocomplete="off"></label><div class="row"><button type="button" class="btn primary" data-go>Compare</button><button type="button" class="btn light" data-close>Close</button></div><p class="small" role="status" data-r></p>`;
      pop.place(); pop.el.querySelector('[data-c]').focus();
      pop.el.querySelector('[data-close]').addEventListener('click', () => pop.close());
      pop.el.querySelector('[data-go]').addEventListener('click', async () => {
        const off = await C.clockOffset(e.secret, pop.el.querySelector('[data-c]').value, e, Date.now(), 20);
        const r = pop.el.querySelector('[data-r]');
        if (off == null) r.textContent = `No match within ${20 * e.period} seconds either way. Check that the other device shows the same entry.`;
        else if (off === 0) r.textContent = 'The clocks agree to within one period. Codes from here should be accepted.';
        else r.textContent = `This computer's clock looks about ${Math.abs(off)} seconds ${off > 0 ? 'behind' : 'ahead of'} the other device. ${Math.abs(off) > e.period ? 'Codes from here may be refused; set the clock to update automatically in the system settings.' : 'That is within the usual tolerance.'}`;
      });
    }

    function wireExport() {
      const stamp = () => new Date().toISOString().slice(0, 10);
      main.querySelector('[data-exp-plain]').addEventListener('click', () => {
        const data = { format: 'mvl-authenticator-entries', v: 1, exported: new Date().toISOString(), secretsOmitted: true, note: 'Secrets were left out of this export on purpose. Use a sealed backup to move secrets.', entries: A.entries.map((e) => ({ issuer: e.issuer, account: e.account, group: e.group || '', type: e.type, algorithm: e.algorithm, digits: e.digits, period: e.period, counter: e.counter })) };
        S.download(`authenticator-entries-${stamp()}.json`, JSON.stringify(data, null, 2));
        ctx.toast(`Exported ${A.entries.length} entries without their secrets. The file says so.`, 'success');
      });
      main.querySelector('[data-exp-sealed]').addEventListener('click', async () => {
        const box = await persist();
        S.download(`authenticator-sealed-${stamp()}.json`, JSON.stringify(box, null, 2));
        ctx.toast('Exported a sealed backup. Opening it needs this passphrase.', 'success');
      });
      main.querySelector('[data-exp-clear]').addEventListener('click', async (ev) => {
        const yes = await S.confirm(ctx, { action: 'Export secrets in clear text', affected: `A text file with ${A.entries.length} usable otpauth:// links, secrets included and unencrypted. Anyone who reads the file can make your codes.`, anchor: ev.currentTarget });
        if (!yes) return;
        S.download(`authenticator-secrets-CLEAR-${stamp()}.txt`, A.entries.map((e) => C.buildOtpauth(e)).join('\n') + '\n', 'text/plain');
        ctx.toast('Exported secrets in clear text. Delete the file when you are done with it.', 'warning');
      });
      const msg = main.querySelector('[data-imp-msg]');
      let pendingBox = null;
      main.querySelector('[data-imp]').addEventListener('change', async (e) => {
        const f = e.target.files[0]; if (!f) return;
        pendingBox = null; main.querySelector('[data-imp-pass-row]').hidden = true; main.querySelector('[data-imp-go-row]').hidden = true;
        if (f.size > 2 * 1024 * 1024) { msg.textContent = 'That file is too large.'; return; }
        const text = await f.text();
        let j = null; try { j = JSON.parse(text); } catch { j = null; }
        if (j && j.format === 'mvl-sealed') { pendingBox = j; main.querySelector('[data-imp-pass-row]').hidden = false; main.querySelector('[data-imp-go-row]').hidden = false; msg.textContent = 'Type the passphrase that sealed this backup.'; main.querySelector('[data-imp-pass]').focus(); return; }
        if (j && j.format === 'mvl-authenticator-entries') { msg.textContent = 'That export has no secrets in it, so there is nothing to import. Use a sealed backup.'; return; }
        await addFromText(text, '', msg);
      });
      main.querySelector('[data-imp-go]').addEventListener('click', async () => {
        if (!pendingBox) return;
        try {
          const r = await C.unseal(pendingBox, main.querySelector('[data-imp-pass]').value);
          const list = (r.data.entries || []).filter((e) => e && e.secret).map((e) => { const { id, ...rest } = e; return rest; });
          const res = addEntries(list); await persist(); drawList();
          msg.textContent = `Imported ${res.added}.` + (res.dup ? ` ${res.dup} were already here.` : '');
          main.querySelector('[data-imp-pass]').value = ''; pendingBox = null;
        } catch { msg.textContent = 'That passphrase did not open the backup.'; }
      });
    }

    A.view = { render: (why) => { if (root.isConnected) renderGate(why); } };
    if (A.unlocked) { bumpIdle(); renderMain(); } else renderGate('');
    return () => { clearInterval(tick); A.view = null; };
  }

  // ---------- QR pairing UI ----------
  function mountPairing(root) {
    root.innerHTML = `<div class="sf"><p class="small">Pair an authenticator app with a new secret made on this device. The QR is drawn by this app's own encoder; nothing is fetched or sent.</p>
<section class="card"><h3>Pair a new authenticator</h3><div data-pair></div><div class="row"><button type="button" class="btn" data-save disabled>Save to the built-in authenticator</button></div><p class="small" role="status" data-save-msg></p></section>
<section class="card"><h3>Make a QR from a link</h3><label class="field">otpauth:// link<textarea data-uri rows="2" class="mono sf-ta" spellcheck="false" autocomplete="off"></textarea></label><div class="row"><button type="button" class="btn" data-draw>Draw the QR</button></div><div data-uri-out></div></section>
<section class="card"><h3>Scan a QR</h3><div data-cam></div><p class="small" role="status" data-scan-msg></p></section></div>`;
    let last = null;
    const saveBtn = root.querySelector('[data-save]'), saveMsg = root.querySelector('[data-save-msg]');
    const pc = pairing({ onChange: (ok) => { saveBtn.disabled = !ok; if (!ok) saveMsg.textContent = ''; }, onConfirmed: (p) => { last = p; } });
    root.querySelector('[data-pair]').append(pc.el);
    saveBtn.addEventListener('click', async () => {
      if (!last || !pc.confirmed()) return;
      if (!A.unlocked) { saveMsg.textContent = 'Unlock the built-in authenticator first, then save again.'; return; }
      const r = addEntries([last]); await persist();
      saveMsg.textContent = r.added ? 'Saved to the built-in authenticator.' : 'It is already in the built-in authenticator.';
      if (A.view && A.view.render) { /* the authenticator redraws when it is opened */ }
    });
    root.querySelector('[data-draw]').addEventListener('click', () => {
      const out = root.querySelector('[data-uri-out]');
      try { const p = C.parseOtpauth(root.querySelector('[data-uri]').value); out.innerHTML = qrBlock(C.buildOtpauth(p), `QR code for ${label(p)}. It contains the secret.`) + `<dl class="kv"><dt>Issuer</dt><dd>${esc(p.issuer || 'none')}</dd><dt>Account</dt><dd>${esc(p.account || 'none')}</dd><dt>Algorithm</dt><dd>${esc(p.algorithm)}</dd><dt>Digits</dt><dd>${p.digits}</dd><dt>${p.type === 'hotp' ? 'Counter' : 'Period'}</dt><dd>${p.type === 'hotp' ? p.counter : p.period + ' seconds'}</dd></dl>`; }
      catch (e) { out.innerHTML = `<p class="errbox">${esc(e.message)}</p>`; }
    });
    const cam = cameraPanel((val) => { try { const p = C.parseOtpauth(val); root.querySelector('[data-uri]').value = C.buildOtpauth(p); root.querySelector('[data-scan-msg]').textContent = 'Read a link for ' + label(p) + '. It is in the link box above.'; } catch (e) { root.querySelector('[data-scan-msg]').textContent = e.message; } });
    root.querySelector('[data-cam]').append(cam.el);
    return () => cam.stop();
  }

  let unmountAuth = null, unmountPair = null;
  window.MVLTools.register({ id: 'authenticator', title: 'Authenticator', group: 'Safety', summary: 'Two-factor codes (TOTP and HOTP) sealed on this device', mount: (el, ctx) => { unmountAuth = mountAuthenticator(el, ctx); }, unmount: () => { if (unmountAuth) unmountAuth(); unmountAuth = null; } });
  window.MVLTools.register({ id: 'qr-pairing', title: 'QR pairing', group: 'Safety', summary: 'Make a secret and a scannable QR, then confirm a code', mount: (el) => { unmountPair = mountPairing(el); }, unmount: () => { if (unmountPair) unmountPair(); unmountPair = null; } });

  Object.assign(S, { pairing, qrBlock, authenticator: { isUnlocked: () => A.unlocked, lock: () => lock('Locked.') } });
})();
