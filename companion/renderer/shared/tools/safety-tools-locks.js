'use strict';
// Toy locks on every element, the unlock prompt, the unlock ladder and the Support Tickets desk.
//  - Any element can be locked from its context menu ("Lock this element...") or Ctrl+Alt+L.
//    The non-modal wizard picks one of six policies and makes that lock's own credentials.
//  - A locked element is marked aria-disabled and every route into it (pointer, touch, keyboard,
//    programmatic click, typing, paste, drop, drag) is stopped in the capture phase; activating
//    it opens that lock's anchored unlock prompt instead.
//  - The attempt budget, the lockout clock and the ladder are kept and graded in the main process.
//  - Every lock says it is just for fun, and names deleting the application-data folder as the reset.
(function () {
  const C = window.MVLSafetyCore, S = window.MVLSafety;
  if (!C || !S || !window.MVLTools) return;
  const { esc } = S;
  const LOCKS = 'mvl-safety-locks';
  const TICKETS = 'mvl-safety-tickets';

  const POLICIES = [
    { id: 'pin', label: 'PIN', steps: ['pin'] },
    { id: 'password', label: 'Password', steps: ['password'] },
    { id: 'pin+password', label: 'PIN plus password', steps: ['pin', 'password'] },
    { id: 'password+totp', label: 'Password plus TOTP', steps: ['password', 'totp'] },
    { id: 'pin+totp', label: 'PIN plus TOTP', steps: ['pin', 'totp'] },
    { id: 'password+pin+totp', label: 'Password plus PIN plus TOTP', steps: ['password', 'pin', 'totp'] }
  ];
  const FACTOR = { pin: 'PIN', password: 'Password', totp: 'Authenticator code' };
  const policy = (id) => POLICIES.find((p) => p.id === id);

  // ---------- Lock list (configuration only; credentials are in the vault) ----------
  let locks = S.store.get(LOCKS, []);
  if (!Array.isArray(locks)) locks = [];
  locks = locks.filter((l) => l && typeof l.id === 'string' && typeof l.selector === 'string' && policy(l.policy));
  const unlocked = new Map(); // id -> { until } in memory only, so everything is locked on launch
  const missing = new Set(); // ids whose credential is gone: released rather than unreachable
  const listeners = new Set();
  const saveLocks = () => { S.store.set(LOCKS, locks); listeners.forEach((f) => { try { f(); } catch { /* a listener never breaks locking */ } }); };
  const lockById = (id) => locks.find((l) => l.id === id);
  function isLocked(l) {
    if (missing.has(l.id)) return false;
    const u = unlocked.get(l.id);
    return !(u && (u.until === Infinity || u.until > Date.now()));
  }

  // Stable selector for an element: an id, a distinguishing attribute, or a nth-of-type path.
  function selectorFor(el) {
    const q = (v) => '"' + String(v).replace(/["\\]/g, '\\$&') + '"';
    if (el.id && document.querySelectorAll('#' + CSS.escape(el.id)).length === 1) return '#' + CSS.escape(el.id);
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.body && cur !== document.documentElement) {
      if (cur.id && document.querySelectorAll('#' + CSS.escape(cur.id)).length === 1) { parts.unshift('#' + CSS.escape(cur.id)); break; }
      let p = cur.tagName.toLowerCase();
      const attr = ['data-tool', 'data-tab', 'data-page', 'data-id', 'data-key', 'data-action', 'name'].find((a) => cur.hasAttribute(a));
      if (attr) p += `[${attr}=${q(cur.getAttribute(attr))}]`;
      const par = cur.parentElement;
      if (par) {
        const same = [...par.children].filter((c) => c.tagName === cur.tagName);
        const matching = [...par.children].filter((c) => { try { return c.matches(p); } catch { return false; } });
        if (matching.length > 1) p += `:nth-of-type(${same.indexOf(cur) + 1})`;
      }
      parts.unshift(p);
      cur = par;
    }
    return (cur === document.body ? 'body > ' : '') + parts.join(' > ');
  }
  const exempt = (el) => !el || el === document.body || el === document.documentElement || !!el.closest('.lk-surface, .superconfirm, .ctx-menu, #toast');

  // Marks or unmarks every element matching each lock.
  let applyQueued = false;
  function apply() {
    applyQueued = false;
    const want = new Map();
    for (const l of locks) {
      if (!isLocked(l)) continue;
      let els = [];
      try { els = document.querySelectorAll(l.selector); } catch { els = []; }
      for (const el of els) if (!exempt(el) && !want.has(el)) want.set(el, l);
    }
    for (const el of document.querySelectorAll('[data-mvl-locked]')) if (!want.has(el)) unmark(el);
    for (const [el, l] of want) mark(el, l);
  }
  function mark(el, l) {
    if (el.dataset.mvlLocked === l.id) return;
    if (!el.hasAttribute('data-mvl-prev-aria')) el.setAttribute('data-mvl-prev-aria', el.getAttribute('aria-disabled') == null ? '' : el.getAttribute('aria-disabled'));
    el.dataset.mvlLocked = l.id;
    el.setAttribute('aria-disabled', 'true');
    el.setAttribute('aria-description', 'Locked with a toy lock. Activate to unlock.');
  }
  function unmark(el) {
    const prev = el.getAttribute('data-mvl-prev-aria');
    if (prev) el.setAttribute('aria-disabled', prev); else el.removeAttribute('aria-disabled');
    el.removeAttribute('data-mvl-prev-aria'); el.removeAttribute('aria-description'); delete el.dataset.mvlLocked;
  }
  const queue = () => { if (!applyQueued) { applyQueued = true; requestAnimationFrame(apply); } };
  new MutationObserver(queue).observe(document.documentElement, { childList: true, subtree: true });
  setInterval(() => { let changed = false; for (const [id, u] of unlocked) if (u.until !== Infinity && u.until <= Date.now()) { unlocked.delete(id); changed = true; } if (changed) { apply(); saveLocks(); } }, 1000);

  // ---------- Interception: no route walks around a lock ----------
  const BLOCK = ['click', 'dblclick', 'auxclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend', 'keydown', 'keypress', 'keyup', 'beforeinput', 'input', 'change', 'paste', 'cut', 'drop', 'dragstart', 'submit', 'reset'];
  function guard(e) {
    const t = e.target;
    if (!t || t.nodeType !== 1 || t.closest('.lk-surface')) return;
    const el = t.closest('[data-mvl-locked]');
    if (!el) return;
    if (e.type.startsWith('key') && (e.key === 'Tab' || e.key === 'Shift' || e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10') || (e.ctrlKey && e.altKey && (e.key === 'l' || e.key === 'L')))) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.type === 'click' || (e.type === 'keydown' && (e.key === 'Enter' || e.key === ' '))) {
      const l = lockById(el.dataset.mvlLocked); if (l) openUnlock(l, el);
    }
  }
  for (const ev of BLOCK) document.addEventListener(ev, guard, true);

  // ---------- Attempt budget (main process when connected) ----------
  const local = new Map(); // fallback limiter for a window without the main process: no ladder
  async function attempt(id, ok) {
    const b = S.bridge();
    if (b) return b.attempt('lock:' + id, ok);
    const r = local.get(id) || { fails: 0, lockouts: 0, until: 0 };
    if (r.until && Date.now() >= r.until) { r.until = 0; r.fails = 0; }
    if (r.until) return { ok: true, locked: true, until: r.until, waitMs: r.until - Date.now(), remaining: 0, ladder: { available: false, reason: 'no-main-process' } };
    if (ok) { r.fails = 0; r.lockouts = 0; } else if (++r.fails >= 5) { r.lockouts++; r.until = Date.now() + Math.min(900000, 30000 * 2 ** (r.lockouts - 1)); }
    local.set(id, r);
    return { ok: true, locked: !!r.until, until: r.until, waitMs: r.until ? r.until - Date.now() : 0, remaining: 5 - r.fails, ladder: { available: false, reason: 'no-main-process' } };
  }
  async function lockStatus(id) {
    const b = S.bridge();
    if (b) return b.status('lock:' + id);
    const r = local.get(id);
    if (!r || !r.until || Date.now() >= r.until) return { ok: true, locked: false, remaining: r ? 5 - (r.until ? 0 : r.fails) : 5, ladder: { available: false, reason: 'no-main-process' } };
    return { ok: true, locked: true, until: r.until, waitMs: r.until - Date.now(), remaining: 0, ladder: { available: false, reason: 'no-main-process' } };
  }

  async function readCred(l) {
    const raw = await S.vault.get('lock-' + l.id);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }
  // The one validator for every factor; keypad and manual PIN entry both arrive here.
  async function checkFactor(cred, factor, value) {
    const v = String(value == null ? '' : value);
    if (factor === 'pin') return /^\d{4,12}$/.test(v) && C.verifySecret(v, cred.pin);
    if (factor === 'password') return v.length >= 1 && v.length <= 128 && C.verifySecret(v, cred.password);
    if (factor === 'totp') return !!cred.totp && (await C.verifyTotp(cred.totp.secret, v, cred.totp, Date.now(), 1)) != null;
    return false;
  }

  function unlockFor(l, el) {
    const d = l.duration || { kind: 'minutes', minutes: 5 };
    if (d.kind === 'session') unlocked.set(l.id, { until: Infinity });
    else if (d.kind === 'surface') {
      unlocked.set(l.id, { until: Infinity, surface: true });
      if (el) {
        const off = (e) => { if (el.contains(e.relatedTarget)) return; el.removeEventListener('focusout', off); relock(l.id); };
        el.addEventListener('focusout', off);
      }
    } else unlocked.set(l.id, { until: Date.now() + Math.max(1, Math.min(1440, d.minutes || 5)) * 60000 });
    apply(); saveLocks();
  }
  function relock(id) { unlocked.delete(id); apply(); saveLocks(); }
  const durationText = (d) => (!d ? '5 minutes' : d.kind === 'session' ? 'until the app closes' : d.kind === 'surface' ? 'until focus leaves the element' : d.minutes + (d.minutes === 1 ? ' minute' : ' minutes'));

  async function recoveryLine() {
    const a = await S.appData();
    return a.ok ? `Forgotten it? Close the app and delete its application-data folder: <code class="sf-path" data-i18n-skip data-vocab-skip>${esc(a.path)}</code>. That clears every lock at once.` : `Forgotten it? Close the app and delete its application-data folder. The exact path is not known in this window: ${esc(a.reason)}`;
  }

  // ---------- Unlock prompt ----------
  let openPrompt = null;
  async function openUnlock(l, el) {
    if (openPrompt) openPrompt.close(true);
    const pop = S.popover(el, { label: 'Unlock ' + l.name, className: 'lk-prompt' });
    openPrompt = pop;
    const pol = policy(l.policy);
    const state = { step: 0, verified: [], started: Date.now() };
    const shell = (body) => {
      pop.el.innerHTML = `<h3>Unlock: ${esc(l.name)}</h3><p class="small sf-toy">${esc(S.TOY)}</p><div data-body>${body}</div>
<p class="small" data-recover></p><div class="row"><button type="button" class="btn go" data-tickets>Forgotten your password? Support Tickets</button></div>`;
      recoveryLine().then((h) => { const r = pop.el.querySelector('[data-recover]'); if (r) r.innerHTML = h; pop.place(); });
      pop.el.querySelector('[data-tickets]').addEventListener('click', () => { pop.close(true); window.MVLTools.open('support-tickets'); });
      pop.place();
    };
    let cred = null;
    try { cred = await readCred(l); } catch (e) {
      missing.add(l.id); apply(); saveLocks();
      shell(`<p class="warn">The credential store could not be read (${esc(e.message)}), so this lock is released rather than leaving you stuck. Set the lock again later from Element locks.</p><div class="row"><button type="button" class="btn" data-x>Close</button></div>`);
      pop.el.querySelector('[data-x]').addEventListener('click', () => pop.close()); return;
    }
    if (!cred) {
      missing.add(l.id); apply(); saveLocks();
      shell('<p class="warn">This lock\'s credential is missing, so the lock is released rather than leaving the element unreachable. Remove it or set it again from Element locks.</p><div class="row"><button type="button" class="btn" data-x>Close</button></div>');
      pop.el.querySelector('[data-x]').addEventListener('click', () => pop.close()); return;
    }
    const needed = pol.steps.filter((f) => f !== 'totp' || cred.totp);
    if (needed.length !== pol.steps.length) {
      shell('<p class="errbox">This lock needs an authenticator code, but its TOTP secret is missing. It will not quietly drop that step. Remove the lock from Element locks, or delete the application-data folder.</p><div class="row"><button type="button" class="btn" data-x>Close</button></div>');
      pop.el.querySelector('[data-x]').addEventListener('click', () => pop.close()); return;
    }
    let waitTimer = null;
    async function renderStep() {
      clearInterval(waitTimer);
      const st = await lockStatus(l.id);
      if (st.locked) return renderWait(st);
      if (Date.now() - state.started > 120000) { state.verified = []; state.step = 0; state.started = Date.now(); }
      const f = pol.steps[state.step];
      const stepsHtml = `<ol class="lk-steps">${pol.steps.map((s, i) => `<li class="${i < state.step ? 'done' : i === state.step ? 'now' : ''}">${i < state.step ? 'Done: ' : ''}${FACTOR[s]}</li>`).join('')}</ol>`;
      const head = `<p class="small">Step ${state.step + 1} of ${pol.steps.length}: ${FACTOR[f]}. ${st.remaining} ${st.remaining === 1 ? 'try' : 'tries'} left before a wait.</p>`;
      let field = '';
      if (f === 'pin') {
        const digits = l.shuffleKeypad ? shuffle([...'0123456789']) : [...'1234567890'];
        field = `<label class="field">PIN (manual entry; pasting is allowed)<input type="password" inputmode="numeric" autocomplete="off" maxlength="12" data-in class="mono" aria-describedby="lkpad"></label>
<div class="lk-pad" role="group" aria-label="PIN keypad" id="lkpad">${digits.slice(0, 9).map((d) => `<button type="button" class="lk-key" data-d="${d}">${d}</button>`).join('')}<button type="button" class="lk-key" data-k="clear">Clear</button><button type="button" class="lk-key" data-d="${digits[9]}">${digits[9]}</button><button type="button" class="lk-key" data-k="back" aria-label="Backspace">&larr;</button></div>
<p class="sr" aria-live="polite" data-pinlive></p>`;
      } else if (f === 'password') field = '<label class="field">Password<input type="password" autocomplete="off" maxlength="128" data-in></label>';
      else field = '<label class="field">Current code from your authenticator<input inputmode="numeric" autocomplete="one-time-code" maxlength="8" data-in class="mono"></label>';
      shell(`${stepsHtml}${head}<form data-form>${field}<div class="row"><button type="submit" class="btn primary">Submit</button><button type="button" class="btn light" data-cancel>Cancel</button></div></form><p class="small" role="status" data-msg></p>`);
      const input = pop.el.querySelector('[data-in]');
      input.focus();
      pop.el.querySelector('[data-cancel]').addEventListener('click', () => { state.verified = []; pop.close(); });
      const pad = pop.el.querySelector('.lk-pad');
      if (pad) pad.addEventListener('click', (e) => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.d != null && input.value.length < 12) input.value += b.dataset.d;
        if (b.dataset.k === 'back') input.value = input.value.slice(0, -1);
        if (b.dataset.k === 'clear') input.value = '';
        pop.el.querySelector('[data-pinlive]').textContent = input.value ? 'PIN entry changed. Digits are hidden.' : 'PIN cleared.';
      });
      pop.el.querySelector('[data-form]').addEventListener('submit', async (e) => {
        e.preventDefault();
        const msg = pop.el.querySelector('[data-msg]');
        const ok = await checkFactor(cred, f, input.value);
        input.value = '';
        if (!ok) {
          const r = await attempt(l.id, false);
          if (r.locked) return renderWait(r);
          msg.textContent = `That did not match. ${r.remaining} ${r.remaining === 1 ? 'try' : 'tries'} left before a wait. Nothing was wiped.`; msg.className = 'small sf-bad';
          return;
        }
        state.verified.push(f); state.step++;
        if (state.step < pol.steps.length) return renderStep();
        await attempt(l.id, true);
        unlockFor(l, el);
        pop.close(true);
        if (window.MVL) window.MVL.toast(`Unlocked ${l.name} ${durationText(l.duration)}.`, 'success');
        if (el && el.isConnected) el.focus();
      });
    }
    function renderWait(st) {
      const lad = st.ladder || {};
      const why = { 'no-main-process': 'The unlock ladder needs the app\'s main process to grade answers, and it is not connected in this window.', 'hourly-budget-spent': `The ladder has already skipped ${st.budgetPerHour || 3} waits this hour.${lad.budgetBackAt ? ' It comes back at ' + new Date(lad.budgetBackAt).toLocaleTimeString() + '.' : ''}`, 'lost-round': 'The ladder is over for this wait: the clock is the way through.', 'submitted-early': 'The ladder is over for this wait: the clock is the way through.', 'fell-to-clock': 'The ladder is over for this wait: the clock is the way through.' }[lad.reason] || '';
      shell(`<p class="warn" role="status"><strong data-wait>${S.mmss(st.waitMs)}</strong> until you can try again. This wait is a speed bump, not enforcement.</p>
${lad.available ? '<p class="small">Or play your way out: the unlock ladder ends the wait, and only the wait. You will still need your PIN, password or code.</p><div class="row"><button type="button" class="btn primary" data-ladder>Play the unlock ladder</button></div><div data-ladder-box></div>' : `<p class="small">${esc(why)}</p>`}
<div class="row"><button type="button" class="btn light" data-x>Close</button></div>`);
      pop.el.querySelector('[data-x]').addEventListener('click', () => pop.close());
      const until = Date.now() + st.waitMs;
      waitTimer = setInterval(() => { if (!pop.el.isConnected) { clearInterval(waitTimer); return; } const w = pop.el.querySelector('[data-wait]'); const left = until - Date.now(); if (w) w.textContent = S.mmss(left); if (left <= 0) renderStep(); }, 1000);
      const lb = pop.el.querySelector('[data-ladder]');
      if (lb) lb.addEventListener('click', () => { clearInterval(waitTimer); lb.remove(); ladder(pop.el.querySelector('[data-ladder-box]'), l.id, () => renderStep(), () => pop.place()); });
    }
    renderStep();
  }
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = C.randomBytes(1)[0] % (i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  // ---------- The unlock ladder (graded in the main process) ----------
  function ladder(box, id, onCleared, onResize) {
    const b = S.bridge();
    const key = 'lock:' + id;
    let timers = [];
    const stopTimers = () => { timers.forEach((t) => { clearTimeout(t); clearInterval(t); }); timers = []; };
    const fit = () => { if (onResize) onResize(); };
    if (!b) { box.innerHTML = `<p class="warn">The unlock ladder is unavailable here. ${esc(S.NO_BRIDGE)} It grades answers there, never in the page.</p>`; return; }
    const lang = () => (window.MVLI18n ? window.MVLI18n.mode() : 'en');
    function result(text, cls, next) {
      box.insertAdjacentHTML('beforeend', `<p class="small ${cls || ''}" role="status">${esc(text)}</p>`);
      if (next) { const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn'; btn.textContent = next.label; btn.addEventListener('click', next.run); const row = document.createElement('div'); row.className = 'row'; row.append(btn); box.append(row); btn.focus(); }
      fit();
    }
    function done(r) {
      stopTimers();
      if (r.cleared) { result('Cleared. The wait is over. You still need your PIN, password or code: winning unlocks nothing by itself.', 'sf-good', { label: 'Back to the unlock prompt', run: onCleared }); return; }
      if (r.ladder && r.ladder.available) { result(r.early ? 'That round ended early.' : r.right ? `Not that one. It was ${r.right}.` : 'Not quite.', 'sf-bad', { label: r.ladder.rung === 'dimsum' ? 'Next dish' : r.ladder.rung === 'sums' ? 'On to ten easy sums' : 'On to whack-a-mole', run: next }); return; }
      result('The ladder is over for this wait. The clock is the way through; nothing else changed.', 'sf-bad', { label: 'Back to the wait', run: onCleared });
    }
    async function next() {
      stopTimers();
      box.innerHTML = '<p class="small" role="status">Fetching a challenge...</p>';
      const c = await b.challenge(key, { school: S.school() });
      if (!c || !c.ok) {
        const msg = { 'hourly-budget-spent': 'The ladder has skipped its three waits for this hour. The clock is the way through.', 'not-locked': 'There is no wait to clear right now.', 'lost-round': 'The ladder is over for this wait.', 'fell-to-clock': 'The ladder is over for this wait.', 'submitted-early': 'The ladder is over for this wait.' }[c && c.error] || 'The ladder is unavailable: ' + ((c && c.error) || 'no answer');
        box.innerHTML = `<p class="small">${esc(msg)}</p>`; fit(); return;
      }
      const send = async (answer) => {
        const r = await b.answer(key, c.nonce, answer);
        if (!r.ok) { stopTimers(); result(r.error === 'expired' ? 'That challenge expired before the answer arrived.' : 'That answer was not accepted: ' + r.error, 'sf-bad', r.ladder && r.ladder.available ? { label: 'Try a fresh challenge', run: next } : { label: 'Back', run: onCleared }); return; }
        done(r);
      };
      if (c.rung === 'dimsum') {
        const yue = lang() !== 'en';
        box.innerHTML = `<h4>Rung 1: dim sum</h4><p class="small">${c.triesLeft} ${c.triesLeft === 1 ? 'guess' : 'guesses'} left on this rung.</p><p class="lk-clue" data-i18n-skip>${esc(c.clue)}${yue ? `<br><span lang="zh-HK">${esc(c.clueYue)}</span>` : ''}</p>
<div class="lk-choices" role="group" aria-label="Which dish is it?">${c.choices.map((d) => `<button type="button" class="btn" data-pick="${esc(d.en)}" data-i18n-skip><span>${esc(d.en)}</span> <span lang="zh-HK">${esc(d.yue)}</span></button>`).join('')}</div>`;
        box.querySelector('.lk-choices').addEventListener('click', (e) => { const p = e.target.closest('[data-pick]'); if (!p) return; box.querySelectorAll('[data-pick]').forEach((x) => { x.disabled = true; }); send(p.dataset.pick); });
        box.querySelector('[data-pick]').focus();
      } else if (c.rung === 'sums') {
        box.innerHTML = `<h4>Ten easy sums</h4><p class="small">Every one must be right. A single wrong sum moves you on to whack-a-mole.</p><form class="lk-sums">${c.sums.map((s, i) => `<label class="field lk-sum"><span>${s.a} ${s.op === 'x' ? '&times;' : s.op === '-' ? '&minus;' : '+'} ${s.b} =</span><input inputmode="numeric" autocomplete="off" maxlength="4" data-s="${i}" aria-label="${s.a} ${s.op === 'x' ? 'times' : s.op === '-' ? 'minus' : 'plus'} ${s.b}"></label>`).join('')}<div class="row"><button type="submit" class="btn primary">Submit all ten</button></div></form>`;
        box.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); const ans = [...box.querySelectorAll('[data-s]')].map((i) => (/^-?\d+$/.test(i.value.trim()) ? parseInt(i.value.trim(), 10) : null)); box.querySelector('button[type=submit]').disabled = true; send(ans); });
        box.querySelector('[data-s]').focus();
      } else {
        const hits = [];
        let t0 = 0, score = 0;
        const local = new Set();
        box.innerHTML = `<h4>Whack-a-mole</h4><p class="small">Hit ${c.need} moles in ${c.durationMs / 1000} seconds. Click a hole, or press its number, 1 to 9. The round runs its full length before it is marked.</p>
<p class="lk-mole-status" role="status" aria-live="polite" data-ms>Starting in ${Math.ceil(c.leadInMs / 1000)}</p>
<div class="lk-moles" role="group" aria-label="Mole holes">${Array.from({ length: c.cells }, (_, i) => `<button type="button" class="lk-hole" data-cell="${i}" aria-label="Hole ${i + 1}, empty"><span aria-hidden="true">${i + 1}</span></button>`).join('')}</div>`;
        const holes = [...box.querySelectorAll('.lk-hole')], ms = box.querySelector('[data-ms]');
        const up = (i) => c.moles.some((m, k) => m.cell === i && !local.has(k) && performance.now() - t0 >= m.at && performance.now() - t0 <= m.at + m.dur);
        const hit = (i) => {
          if (!t0) return;
          const t = performance.now() - t0;
          if (t > c.durationMs) return;
          hits.push({ cell: i, t: Math.round(t) });
          const k = c.moles.findIndex((m, j) => m.cell === i && !local.has(j) && t >= m.at && t <= m.at + m.dur);
          if (k >= 0) { local.add(k); score++; ms.textContent = `Hits: ${score} of ${c.need}`; holes[i].classList.add('whacked'); timers.push(setTimeout(() => holes[i].classList.remove('whacked'), 250)); }
        };
        box.querySelector('.lk-moles').addEventListener('click', (e) => { const h = e.target.closest('[data-cell]'); if (h) hit(+h.dataset.cell); });
        box.addEventListener('keydown', (e) => { if (/^[1-9]$/.test(e.key)) { e.preventDefault(); hit(+e.key - 1); } });
        const start = performance.now() + c.leadInMs;
        timers.push(setInterval(() => {
          const now = performance.now();
          if (!t0 && now >= start) { t0 = start; ms.textContent = `Go! Hits: 0 of ${c.need}`; }
          if (!t0) { ms.textContent = 'Starting in ' + Math.ceil((start - now) / 1000); return; }
          const left = c.durationMs - (now - t0);
          holes.forEach((h, i) => { const isUp = up(i); h.classList.toggle('up', isUp); h.setAttribute('aria-label', `Hole ${i + 1}, ${isUp ? 'mole up' : 'empty'}`); });
          box.querySelector('h4').textContent = `Whack-a-mole: ${Math.max(0, Math.ceil(left / 1000))} s left`;
          if (left <= -400) { stopTimers(); holes.forEach((h) => { h.disabled = true; h.classList.remove('up'); }); ms.textContent = `Round over. Hits: ${score}. Marking...`; send(hits); }
        }, 100));
        holes[4].focus();
      }
      fit();
    }
    next();
  }

  // ---------- Lock wizard ----------
  async function openWizard(target) {
    if (exempt(target)) { if (window.MVL) window.MVL.toast('That part cannot be locked: it is the page itself or part of the way out. Lock something inside it instead.', 'warning'); return; }
    if (target.closest('[data-mvl-locked]')) { const l = lockById(target.closest('[data-mvl-locked]').dataset.mvlLocked); if (l) openUnlock(l, target.closest('[data-mvl-locked]')); return; }
    const name = S.nameOf(target), selector = selectorFor(target);
    const pop = S.popover(target, { label: 'Lock this element: ' + name, className: 'lk-wizard' });
    const w = { step: 0, policy: 'pin', creds: {}, pairing: null, duration: { kind: 'minutes', minutes: 5 }, shuffle: false, agree: false };
    const where = await S.vaultWhere();
    const rec = await recoveryLine();
    const STEPS = ['Policy', 'Credentials', 'Duration', 'Confirm'];
    function render() {
      const pol = policy(w.policy);
      let body = '';
      if (w.step === 0) body = `<fieldset class="lk-policies"><legend>Choose exactly one policy</legend>${POLICIES.map((p) => `<label class="lk-radio"><input type="radio" name="lkpol" value="${p.id}"${p.id === w.policy ? ' checked' : ''}><span>${p.label}</span></label>`).join('')}</fieldset>`;
      else if (w.step === 1) body = pol.steps.map((f) => f === 'pin' ? '<fieldset class="lk-fs"><legend>PIN</legend><label class="field">PIN, 4 to 12 digits<input type="password" inputmode="numeric" maxlength="12" autocomplete="new-password" data-c="pin"></label><label class="field">Repeat the PIN<input type="password" inputmode="numeric" maxlength="12" autocomplete="new-password" data-c="pin2"></label></fieldset>'
        : f === 'password' ? '<fieldset class="lk-fs"><legend>Password</legend><label class="field">Password, 4 to 128 characters<input type="password" maxlength="128" autocomplete="new-password" data-c="password"></label><label class="field">Repeat the password<input type="password" maxlength="128" autocomplete="new-password" data-c="password2"></label></fieldset>'
          : '<fieldset class="lk-fs"><legend>Authenticator (TOTP)</legend><p class="small">Generate a secret, scan it with an authenticator, then type its code. If you add it to this app\'s own authenticator, the key is sitting inside the box it opens; that is allowed, and rather funny.</p><div data-pairing></div></fieldset>').join('');
      else if (w.step === 2) body = `<fieldset class="lk-policies"><legend>After unlocking, stay unlocked</legend>
<label class="lk-radio"><input type="radio" name="lkdur" value="surface"${w.duration.kind === 'surface' ? ' checked' : ''}><span>Until focus leaves this element</span></label>
<label class="lk-radio"><input type="radio" name="lkdur" value="minutes"${w.duration.kind === 'minutes' ? ' checked' : ''}><span>For a set number of minutes</span></label>
<label class="field">Minutes<input type="number" min="1" max="1440" value="${w.duration.minutes || 5}" data-min></label>
<label class="lk-radio"><input type="radio" name="lkdur" value="session"${w.duration.kind === 'session' ? ' checked' : ''}><span>Until the app closes</span></label></fieldset>
${pol.steps.includes('pin') ? `<label class="switch-row"><span>Shuffle the keypad digits</span><input type="checkbox" role="switch" data-shuf${w.shuffle ? ' checked' : ''}></label>` : ''}<p class="small">Every lock starts locked when the app starts.</p>`;
      else body = `<dl class="kv"><dt>Element</dt><dd>${esc(name)}</dd><dt>Policy</dt><dd>${esc(pol.label)}</dd><dt>Stays unlocked</dt><dd>${esc(durationText(w.duration))}</dd><dt>Credential</dt><dd>${esc(where.text)}</dd></dl>
<p class="warn">${esc(S.TOY)}</p><p class="small">${rec}</p>
<label class="lk-radio"><input type="checkbox" data-agree${w.agree ? ' checked' : ''}><span>I understand this is a toy lock and how to reset it.</span></label>`;
      pop.el.innerHTML = `<h3>Lock this element</h3><p class="small">Target: <strong>${esc(name)}</strong></p>
<ol class="lk-steps">${STEPS.map((s, i) => `<li class="${i < w.step ? 'done' : i === w.step ? 'now' : ''}"${i === w.step ? ' aria-current="step"' : ''}>${s}</li>`).join('')}</ol>
<div data-body>${body}</div><p class="small sf-bad" role="status" data-msg></p>
<div class="row"><button type="button" class="btn light" data-back${w.step ? '' : ' disabled'}>Back</button><button type="button" class="btn primary" data-next>${w.step === 3 ? 'Create the lock' : 'Next'}</button><button type="button" class="btn go" data-cancel>Cancel</button></div>
<div class="row"><button type="button" class="btn go" data-tickets>Help: Support Tickets</button></div>`;
      if (w.step === 1 && pol.steps.includes('totp')) {
        if (!w.pairing) w.pairing = S.pairing({ issuer: 'Material VM Labs lock', account: name.slice(0, 60), onChange: () => { /* checked on Next */ } });
        pop.el.querySelector('[data-pairing]').append(w.pairing.el);
      }
      pop.el.querySelector('[data-cancel]').addEventListener('click', () => pop.close());
      pop.el.querySelector('[data-tickets]').addEventListener('click', () => { pop.close(true); window.MVLTools.open('support-tickets'); });
      pop.el.querySelector('[data-back]').addEventListener('click', () => { w.step = Math.max(0, w.step - 1); render(); });
      pop.el.querySelector('[data-next]').addEventListener('click', next);
      const first = pop.el.querySelector('[data-body] input'); if (first) first.focus();
      pop.place();
    }
    async function next() {
      const msg = pop.el.querySelector('[data-msg]');
      const pol = policy(w.policy);
      if (w.step === 0) { const r = pop.el.querySelector('input[name=lkpol]:checked'); if (!r) { msg.textContent = 'Choose a policy.'; return; } if (r.value !== w.policy) { w.policy = r.value; w.pairing = null; } }
      if (w.step === 1) {
        const v = (k) => { const i = pop.el.querySelector(`[data-c="${k}"]`); return i ? i.value : ''; };
        if (pol.steps.includes('pin')) { if (!/^\d{4,12}$/.test(v('pin'))) { msg.textContent = 'The PIN must be 4 to 12 digits.'; return; } if (v('pin') !== v('pin2')) { msg.textContent = 'The two PINs differ.'; return; } w.creds.pin = v('pin'); }
        if (pol.steps.includes('password')) { if (v('password').length < 4 || v('password').length > 128) { msg.textContent = 'The password must be 4 to 128 characters.'; return; } if (v('password') !== v('password2')) { msg.textContent = 'The two passwords differ.'; return; } w.creds.password = v('password'); }
        if (pol.steps.includes('totp')) { if (!w.pairing || !w.pairing.confirmed()) { msg.textContent = 'Generate a secret and confirm one current code first.'; return; } w.creds.totp = w.pairing.params(); }
      }
      if (w.step === 2) {
        const k = (pop.el.querySelector('input[name=lkdur]:checked') || {}).value || 'minutes';
        const m = Math.round(+pop.el.querySelector('[data-min]').value);
        if (k === 'minutes' && !(m >= 1 && m <= 1440)) { msg.textContent = 'Minutes must be from 1 to 1440.'; return; }
        w.duration = k === 'minutes' ? { kind: 'minutes', minutes: m } : { kind: k };
        const sh = pop.el.querySelector('[data-shuf]'); w.shuffle = !!(sh && sh.checked);
      }
      if (w.step === 3) {
        if (!pop.el.querySelector('[data-agree]').checked) { msg.textContent = 'Tick the box to confirm you know it is a toy lock and how to reset it.'; return; }
        msg.className = 'small'; msg.textContent = 'Creating...';
        try {
          const id = 'k' + Array.from(C.randomBytes(6), (x) => x.toString(16).padStart(2, '0')).join('');
          const cred = {};
          if (w.creds.pin) cred.pin = await C.hashSecret(w.creds.pin);
          if (w.creds.password) cred.password = await C.hashSecret(w.creds.password);
          if (w.creds.totp) cred.totp = { secret: w.creds.totp.secret, algorithm: w.creds.totp.algorithm, digits: w.creds.totp.digits, period: w.creds.totp.period };
          await S.vault.set('lock-' + id, JSON.stringify(cred));
          w.creds = {}; w.pairing = null;
          locks.push({ id, selector, name, policy: w.policy, duration: w.duration, shuffleKeypad: w.shuffle, created: new Date().toISOString(), store: where.where });
          saveLocks(); apply();
          pop.close(true);
          if (window.MVL) window.MVL.toast(`Locked ${name}. Just for fun, not security.`, 'success');
          if (target.isConnected) target.focus();
        } catch (e) { msg.className = 'small sf-bad'; msg.textContent = 'The lock could not be created: ' + e.message; }
        return;
      }
      w.step++; render();
    }
    render();
  }

  // Context menu items on every element, and the keyboard equivalent.
  if (window.MVLContext) window.MVLContext.register('*', (el) => {
    if (exempt(el) || el.closest('.lk-surface')) return [];
    const target = el.closest('button, a[href], input, select, textarea, [role="tab"], [role="switch"], summary, label, li, .card, section') || el;
    const lockedEl = el.closest('[data-mvl-locked]');
    if (lockedEl) { const l = lockById(lockedEl.dataset.mvlLocked); return l ? [{ label: 'Unlock this element...', shortcut: 'Enter', run: () => openUnlock(l, lockedEl) }] : []; }
    const items = [{ label: 'Lock this element...', shortcut: 'Ctrl+Alt+L', run: () => openWizard(target) }];
    const mine = locks.find((l) => { try { return !isLocked(l) && target.matches(l.selector); } catch { return false; } });
    if (mine) items.push({ label: 'Lock again', shortcut: '', run: () => relock(mine.id) });
    return items;
  });
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.altKey && !e.shiftKey && (e.key === 'l' || e.key === 'L')) {
      const t = document.activeElement;
      if (!t || exempt(t)) return;
      e.preventDefault(); openWizard(t);
    }
  });

  // ---------- Element locks manager ----------
  function mountLocks(root, ctx) {
    root.innerHTML = `<div class="sf"><p class="warn">${esc(S.TOY)}</p><p class="small" data-rec></p>
<p class="small">To add one, right-click any element and choose <strong>Lock this element...</strong>, or focus it and press <kbd>Ctrl+Alt+L</kbd>. Each lock has its own credentials; unlocking one never unlocks another.</p>
<div class="row"><button type="button" class="btn" data-pick>Pick an element to lock</button><button type="button" class="btn go" data-tickets>Locked out? Support Tickets</button></div>
<div data-search></div>
<div class="row sf-bar"><button type="button" class="btn sm" data-all>Select all shown</button><span class="small" data-n>0 selected</span><span class="grow"></span><button type="button" class="btn sm" data-relock>Lock again</button><button type="button" class="btn sm danger" data-remove>Remove selected</button></div>
<ul class="sf-list" data-list aria-label="Toy locks"></ul></div>`;
    recoveryLine().then((h) => { const r = root.querySelector('[data-rec]'); if (r) r.innerHTML = h; });
    const sel = new Set();
    const search = window.MVL.makeSearch({ placeholder: 'Search locks', label: 'Search toy locks', onChange: () => draw() });
    root.querySelector('[data-search]').append(search.el);
    const shown = () => locks.filter((l) => !search.active() || search.test([l.name, l.selector, policy(l.policy).label].join(' ')));
    function stateText(l) {
      if (missing.has(l.id)) return 'Released: credential missing';
      if (isLocked(l)) return 'Locked';
      const u = unlocked.get(l.id);
      return u.until === Infinity ? (u.surface ? 'Unlocked until focus leaves it' : 'Unlocked until the app closes') : 'Unlocked until ' + new Date(u.until).toLocaleTimeString();
    }
    function draw() {
      const list = root.querySelector('[data-list]'), items = shown();
      search.setStatus(`${items.length} of ${locks.length}`);
      for (const id of [...sel]) if (!lockById(id)) sel.delete(id);
      root.querySelector('[data-n]').textContent = sel.size + ' selected';
      if (!locks.length) { list.innerHTML = '<li class="empty-note">No locks yet. Nothing is locked.</li>'; return; }
      if (!items.length) { list.innerHTML = '<li class="empty-note">Nothing matches that search.</li>'; return; }
      list.innerHTML = items.map((l) => `<li class="sf-entry lk-row" data-id="${esc(l.id)}"><input type="checkbox" class="sf-check" data-sel aria-label="Select the lock on ${esc(l.name)}"${sel.has(l.id) ? ' checked' : ''}>
<div class="sf-entry-main"><div class="sf-entry-name"><strong>${esc(l.name)}</strong><span class="chip">${esc(policy(l.policy).label)}</span><span class="chipst ${isLocked(l) ? 'amber' : 'lime'}">${esc(stateText(l))}</span></div>
<p class="small mono" data-i18n-skip>${esc(l.selector)}</p><p class="small">Stays unlocked ${esc(durationText(l.duration))}. ${l.store === 'vault' ? 'Credential in the credential store.' : 'Credential in local storage.'}</p></div>
<div class="sf-entry-actions">${isLocked(l) ? '<button type="button" class="btn sm primary" data-unlock>Unlock</button>' : '<button type="button" class="btn sm" data-lockagain>Lock again</button>'}<button type="button" class="btn sm" data-show>Show element</button><button type="button" class="btn sm danger" data-rm>Remove</button></div></li>`).join('');
    }
    async function remove(ids, anchor) {
      const can = ids.filter((id) => { const l = lockById(id); return l && !isLocked(l); });
      const skipped = ids.length - can.length;
      if (!can.length) { ctx.toast(`Unlock ${ids.length === 1 ? 'it' : 'them'} first. A lock is removed only while it is unlocked.`, 'info'); return; }
      const yes = await S.confirm(ctx, { action: `Remove ${can.length} toy ${can.length === 1 ? 'lock' : 'locks'}`, affected: `The lock settings and their stored credentials. The elements themselves are untouched.${skipped ? ` ${skipped} locked ${skipped === 1 ? 'one stays' : 'ones stay'}: unlock first.` : ''}`, anchor });
      if (!yes) return;
      for (const id of can) { try { await S.vault.del('lock-' + id); } catch { /* the folder reset clears it anyway */ } const b = S.bridge(); if (b && b.forget) b.forget('lock:' + id); unlocked.delete(id); missing.delete(id); sel.delete(id); }
      locks = locks.filter((l) => !can.includes(l.id)); saveLocks(); apply(); draw();
      ctx.toast(`Removed ${can.length}.${skipped ? ` ${skipped} still locked, so kept.` : ''}`, 'success');
    }
    root.querySelector('[data-list]').addEventListener('change', (e) => { if (e.target.matches('[data-sel]')) { const id = e.target.closest('[data-id]').dataset.id; if (e.target.checked) sel.add(id); else sel.delete(id); root.querySelector('[data-n]').textContent = sel.size + ' selected'; } });
    root.querySelector('[data-list]').addEventListener('click', (e) => {
      const b = e.target.closest('button'), li = e.target.closest('[data-id]'); if (!b || !li) return;
      const l = lockById(li.dataset.id); if (!l) return;
      if (b.matches('[data-unlock]')) openUnlock(l, b);
      else if (b.matches('[data-lockagain]')) { relock(l.id); draw(); }
      else if (b.matches('[data-rm]')) remove([l.id], b);
      else if (b.matches('[data-show]')) {
        let el = null; try { el = document.querySelector(l.selector); } catch { el = null; }
        if (!el) { ctx.toast('That element is not on screen right now.', 'info'); return; }
        if (el.closest('dialog.tools-host')) { el.scrollIntoView({ block: 'center' }); el.classList.add('lk-flash'); setTimeout(() => el.classList.remove('lk-flash'), 1600); return; }
        const d = root.closest('dialog'); if (d) d.close();
        el.scrollIntoView({ block: 'center' }); el.classList.add('lk-flash'); setTimeout(() => el.classList.remove('lk-flash'), 1600);
      }
    });
    root.querySelector('[data-all]').addEventListener('click', () => { for (const l of shown()) sel.add(l.id); draw(); });
    root.querySelector('[data-relock]').addEventListener('click', () => { if (!sel.size) { ctx.toast('Select locks first.', 'info'); return; } for (const id of sel) relock(id); draw(); ctx.toast(`Locked again: ${sel.size}.`, 'success'); });
    root.querySelector('[data-remove]').addEventListener('click', (e) => { if (!sel.size) { ctx.toast('Select locks first.', 'info'); return; } remove([...sel], e.currentTarget); });
    root.querySelector('[data-tickets]').addEventListener('click', () => window.MVLTools.open('support-tickets'));
    root.querySelector('[data-pick]').addEventListener('click', () => {
      const d = root.closest('dialog'); if (d) d.close();
      if (window.MVL) window.MVL.toast('Click the element to lock. Press Escape to stop picking.', 'info');
      const pick = (e) => { if (e.target.closest('.lk-surface, #toast')) return; e.preventDefault(); e.stopImmediatePropagation(); stop(); openWizard(e.target.closest('button, a[href], input, select, textarea, [role="tab"], summary, label, li, .card, section') || e.target); };
      const esc2 = (e) => { if (e.key === 'Escape') { stop(); if (window.MVL) window.MVL.toast('Stopped picking.', 'info'); } };
      const stop = () => { document.removeEventListener('click', pick, true); document.removeEventListener('keydown', esc2, true); document.documentElement.classList.remove('lk-picking'); };
      document.documentElement.classList.add('lk-picking');
      setTimeout(() => { document.addEventListener('click', pick, true); document.addEventListener('keydown', esc2, true); }, 0);
    });
    listeners.add(draw);
    draw();
    const t = setInterval(draw, 5000);
    return () => { listeners.delete(draw); clearInterval(t); };
  }

  // ---------- Unlock ladder page ----------
  function mountLadder(root) {
    root.innerHTML = `<div class="sf"><p>After five wrong tries a toy lock makes you wait. The unlock ladder gives you something to do instead:</p>
<ol class="lk-rungs"><li data-rung-dimsum>Dim sum: one dish, four choices. Five wrong dishes move you on.</li><li>Ten easy sums, all right. One wrong sum moves you on.</li><li>Whack-a-mole: hit enough moles in one round.</li><li>The clock: you serve the wait you were already serving.</li></ol>
<p class="small">Winning ends the wait and nothing more. It never unlocks anything, never gives back extra tries, and leaves the next wait just as long. It can skip at most three waits per hour across every lock. Answers are made and marked by the app's main process, once each, before they expire.</p>
<p class="small" data-school></p><p class="small" role="status" data-budget></p><div data-active></div><div data-play-box></div></div>`;
    if (S.school()) { root.querySelector('[data-rung-dimsum]').remove(); root.querySelector('[data-school]').textContent = 'School mode is on, so the ladder starts at the sums.'; }
    const b = S.bridge();
    async function draw() {
      if (!b) { root.querySelector('[data-budget]').textContent = 'Unavailable here: ' + S.NO_BRIDGE + ' The ladder is marked there, never in the page.'; return; }
      const sts = await Promise.all(locks.map((l) => b.status('lock:' + l.id).then((s) => ({ l, s }))));
      const any = sts[0] ? sts[0].s : await b.status('lock:none');
      root.querySelector('[data-budget]').textContent = `Ladder skips left this hour: ${any.budgetLeft} of ${any.budgetPerHour}.`;
      const out = sts.filter((x) => x.s.locked);
      const box = root.querySelector('[data-active]');
      box.innerHTML = out.length ? `<h3>Waiting now</h3><ul class="sf-list">${out.map(({ l, s }) => `<li class="sf-entry" data-id="${esc(l.id)}"><div class="sf-entry-main"><strong>${esc(l.name)}</strong><p class="small">${S.mmss(s.waitMs)} left. ${s.ladder.available ? 'The ladder is open.' : 'The clock is the way through.'}</p></div>${s.ladder.available ? '<div class="sf-entry-actions"><button type="button" class="btn primary sm" data-play>Play the ladder</button></div>' : ''}</li>`).join('')}</ul>` : '<p class="empty-note">Nobody is waiting right now. The ladder appears in an unlock prompt after five wrong tries.</p>';
    }
    root.addEventListener('click', (e) => {
      const p = e.target.closest('[data-play]'); if (!p) return;
      const id = p.closest('[data-id]').dataset.id;
      const box = root.querySelector('[data-play-box]');
      ladder(box, id, () => { draw(); box.innerHTML = ''; });
    });
    draw();
    const t = setInterval(draw, 5000);
    return () => clearInterval(t);
  }

  // ---------- Support Tickets ----------
  const CATS = ['Forgotten PIN', 'Forgotten password', 'Lost authenticator', 'Stuck on the clock', 'Something else'];
  const SEVS = ['Low', 'Medium', 'High', 'Existential'];
  const STATUSES = ['Open', 'Triaged', 'Escalated to the folder', 'Resolved'];
  const REPLIES = [
    'Thank you for contacting the Recovery Desk. Your ticket has joined a queue of exactly one and gone straight to the front.',
    'Your ticket has been triaged against the manual. Severity noted. As promised, it will not be honoured.',
    'Escalated to the only fix that works: deleting this app\'s application-data folder. The button below opens it for you.',
    'Marked resolved. Deleting the folder also deletes this ticket, which the desk considers very tidy.'
  ];
  const tickets = () => { const t = S.store.get(TICKETS, []); return Array.isArray(t) ? t : []; };
  const saveTickets = (t) => S.store.set(TICKETS, t);
  function mountTickets(root, ctx) {
    root.classList.add('lk-surface');
    root.innerHTML = `<div class="sf">
<p class="sf-plain" data-disclosure data-funny-skip>${esc(S.SAFETY_DISCLOSURE)}</p>
<section class="card"><h3>Resolution</h3><p class="small">Locked out of a toy lock? The fix is to delete this app's application-data folder yourself. The app opens it and stands back; it never deletes anything for you.</p>
<ol class="small"><li>Close Material VM Labs.</li><li>Delete the folder below in your file manager.</li><li>Start the app again: every lock, and every ticket here, is gone.</li></ol>
<div data-path></div><div class="row"><button type="button" class="btn primary" data-open>Open the folder</button><button type="button" class="btn" data-copy>Copy the path</button></div><p class="small" role="status" data-open-msg></p></section>
<section class="card"><h3>Open a ticket</h3><form data-new class="sf-grid">
<label class="field">Category<select data-cat>${CATS.map((c) => `<option>${c}</option>`).join('')}</select></label>
<label class="field">Severity (nobody will honour it)<select data-sev>${SEVS.map((s, i) => `<option${i === 2 ? ' selected' : ''}>${s}</option>`).join('')}</select></label>
<label class="field sf-wide">Description<textarea data-desc rows="3" maxlength="2000" class="sf-ta"></textarea></label>
<div class="row sf-wide"><button type="submit" class="btn primary">Submit ticket</button></div></form></section>
<div data-search></div>
<div class="row sf-bar"><button type="button" class="btn sm" data-all>Select all shown</button><span class="small" data-n>0 selected</span><span class="grow"></span><button type="button" class="btn sm" data-adv>Check for updates</button><button type="button" class="btn sm" data-exp>Export</button><button type="button" class="btn sm danger" data-del>Delete selected</button></div>
<ul class="sf-list" data-list aria-label="Tickets"></ul></div>`;
    let path = null;
    S.appData().then((a) => {
      path = a.ok ? a.path : null;
      root.querySelector('[data-path]').innerHTML = a.ok ? `<p class="mono sf-path-box" data-i18n-skip data-vocab-skip>${esc(a.path)}</p>` : `<p class="warn">The folder path is not known in this window: ${esc(a.reason)}</p>`;
      root.querySelector('[data-open]').disabled = !a.ok; root.querySelector('[data-copy]').disabled = !a.ok;
    });
    root.querySelector('[data-copy]').addEventListener('click', () => { if (path) S.copy(path, 'Path copied'); });
    root.querySelector('[data-open]').addEventListener('click', async () => {
      const msg = root.querySelector('[data-open-msg]'), b = S.bridge();
      if (!b) { msg.textContent = 'Opening the folder is unavailable here. ' + S.NO_BRIDGE; return; }
      const r = await b.openAppData();
      msg.textContent = r.ok ? `Opened ${r.path} in the file manager. Close the app before deleting it.` : `The file manager could not be opened: ${r.error}. The path above is copyable.`;
    });
    const sel = new Set();
    const search = window.MVL.makeSearch({ placeholder: 'Search tickets', label: 'Search tickets', onChange: () => draw() });
    root.querySelector('[data-search]').append(search.el);
    const shown = () => tickets().filter((t) => !search.active() || search.test([t.number, t.category, t.severity, STATUSES[t.status], t.description].join(' ')));
    function draw() {
      const all = tickets(), items = shown(), list = root.querySelector('[data-list]');
      search.setStatus(`${items.length} of ${all.length}`);
      for (const id of [...sel]) if (!all.some((t) => t.id === id)) sel.delete(id);
      root.querySelector('[data-n]').textContent = sel.size + ' selected';
      if (!all.length) { list.innerHTML = '<li class="empty-note">No tickets yet.</li>'; return; }
      if (!items.length) { list.innerHTML = '<li class="empty-note">Nothing matches that search.</li>'; return; }
      list.innerHTML = items.map((t) => `<li class="sf-entry" data-id="${esc(t.id)}"><input type="checkbox" class="sf-check" data-sel aria-label="Select ticket ${esc(t.number)}"${sel.has(t.id) ? ' checked' : ''}>
<div class="sf-entry-main"><div class="sf-entry-name"><strong class="mono" data-i18n-skip>${esc(t.number)}</strong><span class="chip">${esc(t.category)}</span><span class="chip">Severity: ${esc(t.severity)}</span><span class="chipst ${t.status >= 3 ? 'lime' : 'amber'}">${esc(STATUSES[t.status])}</span></div>
${t.description ? `<p class="small">${esc(t.description)}</p>` : ''}<ol class="lk-replies">${t.replies.map((r) => `<li><span class="small">${esc(new Date(r.at).toLocaleString())}</span> ${window.MVLFunny ? window.MVLFunny.html('info', r.text) : esc(r.text)}</li>`).join('')}</ol></div>
<div class="sf-entry-actions">${t.status < 3 ? '<button type="button" class="btn sm" data-adv1>Check for updates</button>' : ''}</div></li>`).join('');
    }
    function advance(ids) {
      const all = tickets(); let n = 0;
      for (const t of all) if (ids.includes(t.id) && t.status < 3) { t.status++; t.replies.push({ at: new Date().toISOString(), text: REPLIES[t.status] }); n++; }
      saveTickets(all); draw(); return n;
    }
    root.querySelector('[data-new]').addEventListener('submit', (e) => {
      e.preventDefault();
      const all = tickets();
      const n = (S.store.get('mvl-safety-ticket-seq', 1000) | 0) + 1; S.store.set('mvl-safety-ticket-seq', n);
      const t = { id: 't' + Date.now().toString(36) + C.randomBytes(2)[0], number: 'RD-' + n, category: root.querySelector('[data-cat]').value, severity: root.querySelector('[data-sev]').value, description: root.querySelector('[data-desc]').value.trim().slice(0, 2000), status: 0, created: new Date().toISOString(), replies: [{ at: new Date().toISOString(), text: REPLIES[0] }] };
      all.unshift(t); saveTickets(all);
      root.querySelector('[data-desc]').value = '';
      draw(); ctx.toast(`Ticket ${t.number} opened. It stays on this computer.`, 'success');
    });
    root.querySelector('[data-list]').addEventListener('change', (e) => { if (e.target.matches('[data-sel]')) { const id = e.target.closest('[data-id]').dataset.id; if (e.target.checked) sel.add(id); else sel.delete(id); root.querySelector('[data-n]').textContent = sel.size + ' selected'; } });
    root.querySelector('[data-list]').addEventListener('click', (e) => { const b = e.target.closest('[data-adv1]'); if (b) advance([b.closest('[data-id]').dataset.id]); });
    root.querySelector('[data-all]').addEventListener('click', () => { for (const t of shown()) sel.add(t.id); draw(); });
    root.querySelector('[data-adv]').addEventListener('click', () => { const ids = sel.size ? [...sel] : tickets().map((t) => t.id); const n = advance(ids); ctx.toast(n ? `Updated ${n} ${n === 1 ? 'ticket' : 'tickets'}.` : 'No open tickets to update.', 'info'); });
    root.querySelector('[data-exp]').addEventListener('click', () => {
      const list = sel.size ? tickets().filter((t) => sel.has(t.id)) : tickets();
      S.download(`support-tickets-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ format: 'mvl-support-tickets', v: 1, exported: new Date().toISOString(), note: S.SAFETY_DISCLOSURE, tickets: list }, null, 2));
      ctx.toast(`Exported ${list.length} ${list.length === 1 ? 'ticket' : 'tickets'}.`, 'success');
    });
    root.querySelector('[data-del]').addEventListener('click', async (e) => {
      if (!sel.size) { ctx.toast('Select tickets first.', 'info'); return; }
      const n = sel.size;
      const yes = await S.confirm(ctx, { action: `Delete ${n} ${n === 1 ? 'ticket' : 'tickets'}`, affected: 'The selected tickets on this computer. Locks and the application-data folder are not touched.', anchor: e.currentTarget });
      if (!yes) return;
      saveTickets(tickets().filter((t) => !sel.has(t.id))); sel.clear(); draw(); ctx.toast(`Deleted ${n}.`, 'success');
    });
    draw();
    return () => {};
  }

  // ---------- Registration ----------
  let un = {};
  const reg = (id, title, summary, fn) => window.MVLTools.register({ id, title, group: 'Safety', summary, mount: (el, ctx) => { un[id] = fn(el, ctx); }, unmount: () => { if (un[id]) un[id](); un[id] = null; } });
  reg('element-locks', 'Element locks', 'Toy locks on any element, just for fun', mountLocks);
  reg('unlock-ladder', 'Unlock ladder', 'Play your way out of a lockout wait', mountLadder);
  reg('support-tickets', 'Support Tickets', 'The local recovery desk for toy locks', mountTickets);
  if (window.MVLPalette) {
    window.MVLPalette.register({ id: 'help-support-tickets', title: 'Help: Support Tickets (locked out of a toy lock?)', group: 'Help', keywords: ['locked out', 'forgot', 'recovery', 'reset'], run: () => window.MVLTools.open('support-tickets') });
  }
  apply();
  Object.assign(S, { locks: { list: () => locks.map((l) => Object.assign({}, l, { locked: isLocked(l) })), openWizard, openUnlock: (id, el) => { const l = lockById(id); if (l) openUnlock(l, el || document.querySelector(l.selector)); }, relock, apply, POLICIES, selectorFor, checkFactor } });
})();
