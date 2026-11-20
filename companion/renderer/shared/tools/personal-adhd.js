'use strict';
// ADHD modes: five independent, persisted interface accommodations, each off by default. They are
// named for what they do, never presented as medical, and their copy states facts without judging.
// Focus dims (never hides) everything but the current section; Low stimulation removes non-essential
// motion and quietens colour and info notifications, on top of any operating-system reduced-motion
// preference; Time awareness states how long the window has been open and since the last change;
// One thing at a time keeps one next action the person chose; Momentum offers a dismissible note
// when nothing has changed for a set time, with a "Not now" that holds for a stated period.
(function () {
  const C = window.MVLPersonalCore;
  const { esc, store, history } = C;
  const KEY = 'mvl-adhd';
  const MODES = [
    ['focus', 'Focus', 'Dims everything except the section you are working in. Nothing is hidden: hover anything to see it at full strength, or press Show everything.'],
    ['lowStimulation', 'Low stimulation', 'Stops non-essential motion, quietens colour and silences sounds for information-only notifications. It adds to your system reduced-motion setting and never turns it off.'],
    ['timeAwareness', 'Time awareness', 'Shows how long this window has been open and how long since anything changed.'],
    ['oneThing', 'One thing at a time', 'Keeps one next action you choose visible on every page, and remembers it.'],
    ['momentum', 'Momentum', 'Shows a short, dismissible note when nothing has changed for a while. Not now pauses it for the period you choose.']
  ];
  const DEF = { focus: false, lowStimulation: false, timeAwareness: false, oneThing: false, momentum: false, nextAction: '', momentumMinutes: 30, snoozeMinutes: 60, snoozeUntil: 0 };
  const raw = store.get(KEY, {});
  const prefs = Object.assign({}, DEF, raw && typeof raw === 'object' ? raw : {});
  for (const [k] of MODES) prefs[k] = !!prefs[k];
  if (![10, 20, 30, 45, 60].includes(prefs.momentumMinutes)) prefs.momentumMinutes = 30;
  if (![15, 30, 60, 120, 240].includes(prefs.snoozeMinutes)) prefs.snoozeMinutes = 60;
  prefs.nextAction = String(prefs.nextAction || '').slice(0, 120);
  const overrides = {};
  const listeners = new Set();
  const opened = Date.now();
  let lastChange = Date.now(), bar = null, tick = null, started = false, momentumShown = false;

  const on = (k) => (k in overrides ? overrides[k] : prefs[k]);
  const save = () => store.set(KEY, prefs);
  const mins = (ms) => Math.max(0, Math.floor(ms / 60000));
  const dur = (ms) => { const m = mins(ms); if (m < 1) return 'less than a minute'; if (m < 60) return m + (m === 1 ? ' minute' : ' minutes'); const h = Math.floor(m / 60), r = m % 60; return h + (h === 1 ? ' hour' : ' hours') + (r ? ' ' + r + (r === 1 ? ' minute' : ' minutes') : ''); };

  function set(k, v) {
    if (!MODES.some(([m]) => m === k)) return;
    prefs[k] = !!v; save();
    history.add('adhd-modes', k, MODES.find(([m]) => m === k)[1] + (v ? ' on' : ' off'));
    apply();
  }
  function setOverride(k, v) { if (v == null) delete overrides[k]; else overrides[k] = !!v; apply(); }

  // ---------- applying ----------
  function markCurrent(e) {
    if (!on('focus')) return;
    const t = e.target && e.target.closest && e.target.closest('.card, .mcard, .activity, article, section, li, tr, [role="tabpanel"]');
    if (!t || t.closest('.adhd-bar, dialog')) return;
    for (const el of document.querySelectorAll('[data-adhd-current]')) if (el !== t) el.removeAttribute('data-adhd-current');
    t.setAttribute('data-adhd-current', '');
  }
  function changed() { lastChange = Date.now(); momentumShown = false; const n = bar && bar.querySelector('[data-adhd-momentum]'); if (n) n.hidden = true; }
  function ensureBar() {
    if (bar || !document.body) return;
    bar = document.createElement('aside');
    bar.className = 'adhd-bar'; bar.setAttribute('aria-label', 'Attention aids');
    bar.innerHTML = `<p class="adhd-chip" data-adhd-time role="timer" aria-live="off"></p>
<p class="adhd-chip adhd-next" data-adhd-next></p>
<button type="button" class="btn sm" data-adhd-showall>Show everything</button>
<div class="adhd-momentum" data-adhd-momentum role="status" hidden><p data-adhd-momentum-text></p><div class="row"><button type="button" class="btn sm" data-adhd-snooze></button><button type="button" class="btn sm" data-adhd-dismiss>Dismiss</button></div></div>`;
    bar.addEventListener('click', (e) => {
      if (e.target.closest('[data-adhd-showall]')) { set('focus', false); for (const el of document.querySelectorAll('[data-adhd-current]')) el.removeAttribute('data-adhd-current'); }
      if (e.target.closest('[data-adhd-snooze]')) { prefs.snoozeUntil = Date.now() + prefs.snoozeMinutes * 60000; save(); bar.querySelector('[data-adhd-momentum]').hidden = true; }
      if (e.target.closest('[data-adhd-dismiss]')) { bar.querySelector('[data-adhd-momentum]').hidden = true; lastChange = Date.now(); }
    });
    document.body.append(bar);
  }
  function render() {
    if (!bar) return;
    const time = bar.querySelector('[data-adhd-time]'), next = bar.querySelector('[data-adhd-next]'), all = bar.querySelector('[data-adhd-showall]'), mom = bar.querySelector('[data-adhd-momentum]');
    time.hidden = !on('timeAwareness');
    time.textContent = 'Open for ' + dur(Date.now() - opened) + '. Last change ' + dur(Date.now() - lastChange) + ' ago.';
    next.hidden = !(on('oneThing') && prefs.nextAction);
    next.textContent = 'Next: ' + prefs.nextAction;
    all.hidden = !on('focus');
    if (on('momentum') && !momentumShown && Date.now() - lastChange >= prefs.momentumMinutes * 60000 && Date.now() >= prefs.snoozeUntil) {
      momentumShown = true;
      bar.querySelector('[data-adhd-momentum-text]').textContent = 'Nothing has changed here for ' + dur(Date.now() - lastChange) + '.' + (on('oneThing') && prefs.nextAction ? ' Your next action: ' + prefs.nextAction + '.' : '');
      bar.querySelector('[data-adhd-snooze]').textContent = 'Not now, for ' + dur(prefs.snoozeMinutes * 60000);
      mom.hidden = false;
    }
    if (!on('momentum')) mom.hidden = true;
    bar.hidden = time.hidden && next.hidden && all.hidden && mom.hidden;
  }
  function apply() {
    const html = document.documentElement;
    for (const [k] of MODES) { const attr = 'adhd' + k[0].toUpperCase() + k.slice(1); if (on(k)) html.dataset[attr] = 'on'; else delete html.dataset[attr]; }
    ensureBar(); render();
    for (const f of listeners) { try { f(state()); } catch { /* listener errors stay local */ } }
  }
  const state = () => { const s = {}; for (const [k] of MODES) s[k] = on(k); s.nextAction = prefs.nextAction; return s; };

  // ---------- UI ----------
  function control() {
    const box = document.createElement('section');
    box.className = 'personal-card personal-adhd';
    const id = 'pa-' + Math.random().toString(36).slice(2, 7);
    box.setAttribute('aria-labelledby', id);
    box.innerHTML = `<h3 id="${id}">ADHD modes</h3>
<p class="small">Interface accommodations, each separate and each off until you turn it on. They are not medical and say nothing about anyone who uses them.</p>
${MODES.map(([k, l, d]) => `<label class="switch-row"><span>${esc(l)}<br><span class="small">${esc(d)}</span><span class="small personal-sched" data-pa-sched="${k}" hidden></span></span><input type="checkbox" role="switch" data-pa="${k}"></label>`).join('')}
<label class="field"><span>Next action for One thing at a time</span><input type="text" maxlength="120" data-pa-next autocomplete="off"></label>
<div class="row"><label class="field"><span>Momentum note after</span><select data-pa-after>${[10, 20, 30, 45, 60].map((m) => `<option value="${m}">${m} minutes without a change</option>`).join('')}</select></label>
<label class="field"><span>Not now holds for</span><select data-pa-snooze>${[15, 30, 60, 120, 240].map((m) => `<option value="${m}">${dur(m * 60000)}</option>`).join('')}</select></label></div>
<p class="small" data-pa-school></p>`;
    const sync = () => {
      for (const [k] of MODES) {
        box.querySelector(`[data-pa="${k}"]`).checked = on(k);
        const s = box.querySelector(`[data-pa-sched="${k}"]`); s.hidden = !(k in overrides); s.textContent = k in overrides ? ' A schedule has set this to ' + (overrides[k] ? 'on' : 'off') + ' for now.' : '';
      }
      const n = box.querySelector('[data-pa-next]'); if (document.activeElement !== n) n.value = prefs.nextAction;
      box.querySelector('[data-pa-after]').value = String(prefs.momentumMinutes);
      box.querySelector('[data-pa-snooze]').value = String(prefs.snoozeMinutes);
      const school = window.MVLSchool ? window.MVLSchool.name() : '';
      box.querySelector('[data-pa-school]').textContent = school ? school + ' leaves these modes exactly as you set them; they stay available while it is on.' : '';
    };
    box.addEventListener('change', (e) => {
      const k = e.target.dataset.pa; if (k) set(k, e.target.checked);
      if (e.target.matches('[data-pa-after]')) { prefs.momentumMinutes = Number(e.target.value); save(); history.add('adhd-modes', 'momentum', 'Momentum delay set'); }
      if (e.target.matches('[data-pa-snooze]')) { prefs.snoozeMinutes = Number(e.target.value); save(); history.add('adhd-modes', 'snooze', 'Not now period set'); }
    });
    box.querySelector('[data-pa-next]').addEventListener('change', (e) => { prefs.nextAction = e.target.value.trim().slice(0, 120); save(); history.add('adhd-modes', 'next-action', prefs.nextAction ? 'Next action set' : 'Next action cleared'); render(); });
    listeners.add(sync); sync();
    return box;
  }

  function init() {
    if (started) return; started = true;
    const go = () => {
      apply();
      document.addEventListener('focusin', markCurrent, true);
      document.addEventListener('pointerdown', markCurrent, true);
      for (const ev of ['input', 'change']) document.addEventListener(ev, changed, true);
      document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('button, a[href], [role="tab"]') && !e.target.closest('.adhd-bar')) changed(); }, true);
      tick = setInterval(render, 30000);
    };
    if (document.body) go(); else document.addEventListener('DOMContentLoaded', go, { once: true });
    // Low stimulation: information-only notifications arrive without a sound.
    if (window.MVLNotify && typeof window.MVLNotify.push === 'function' && !window.MVLNotify.push._adhd) {
      const orig = window.MVLNotify.push;
      const wrapped = (n) => orig(on('lowStimulation') && n && (n.kind || 'info') === 'info' ? Object.assign({}, n, { silent: true }) : n);
      wrapped._adhd = true; window.MVLNotify.push = wrapped;
    }
    if (window.MVLTools) window.MVLTools.register({ id: 'personal-adhd', title: 'ADHD modes', group: 'Personal', summary: 'Focus, low stimulation, time awareness, one thing at a time and momentum.', mount(el) { const c = control(); c.classList.add('in-tool'); el.append(c); } });
    if (window.MVLPalette) for (const [k, l] of MODES) window.MVLPalette.register({ id: 'personal-adhd-' + k, title: 'Toggle ' + l, group: 'ADHD modes', keywords: ['adhd', 'attention'], run: () => set(k, !prefs[k]) });
  }

  window.MVLPersonal = window.MVLPersonal || {};
  window.MVLPersonal.adhd = { init, control, set, setOverride, state, modes: MODES.map(([k, l]) => ({ id: k, label: l })), onChange: (f) => listeners.add(f), _stop: () => clearInterval(tick) };
  init();
})();
