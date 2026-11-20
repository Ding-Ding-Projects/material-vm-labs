'use strict';
// Scheduled settings: rules that change the theme, language, seed colour, motion, display name and
// ADHD modes during chosen weekday and time windows. The schema, the matching and the precedence live
// in personal-core.js (and are tested there). Scheduled values are temporary overrides: they are never
// saved as your base settings, which return as soon as no rule applies.
// External sources (a versioned HTTPS API, a Home Assistant boolean entity) need a main-process
// fetcher and the operating-system credential vault. This build has neither, so such rules are kept,
// shown as unavailable with that reason, and skipped: the base setting or a lower rule stays in effect.
(function () {
  const C = window.MVLPersonalCore;
  const { esc, store, history } = C;
  const KEY = 'mvl-schedule';
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const SOURCES = { local: 'This device', api: 'HTTPS API (unavailable)', homeassistant: 'Home Assistant entity (unavailable)' };
  const UNAVAILABLE = 'External sources need a main-process fetcher and the operating-system credential vault, which this build does not include. The rule is kept but skipped, so your base setting stays in effect.';
  const listeners = new Set();
  let schedule = C.migrateSchedule(store.get(KEY, null));
  let applied = {}, lastReport = { values: {}, skipped: [] }, timer = null, started = false;
  const warned = new Set();

  const school = () => !!(window.MVLSchool && window.MVLSchool.active());
  const seeds = () => Object.keys(window.MVL_SCHEMES || { Violet: 1 });
  const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'the system timezone'; } catch { return 'the system timezone'; } };
  const newId = () => 'r' + Math.random().toString(36).slice(2, 10);
  const saved = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } };
  function persist(action, summary) { store.set(KEY, schedule); history.add('scheduled-settings', action, summary); evaluate(); }

  // ---------- applying overrides ----------
  const appliers = {
    theme: { on: (v) => window.MVL && window.MVL.applyTheme(v), off: () => window.MVL && window.MVL.applyTheme(saved('mvl-theme', 'system')) },
    lang: {
      on: (v) => { if (window.MVLSchool && window.MVLSchool.active()) return; C.setLangQuiet(v); },
      off: () => { if (window.MVLSchool && window.MVLSchool.active()) return; C.setLangQuiet(saved('mvl-lang', 'en')); }
    },
    seed: {
      on: (v) => { document.documentElement.dataset.seed = v; if (window.MVL) window.MVL.applyTheme(document.documentElement.dataset.themePref || 'system'); },
      off: () => { document.documentElement.dataset.seed = saved('mvl-seed', 'Violet'); if (window.MVL) window.MVL.applyTheme(document.documentElement.dataset.themePref || 'system'); }
    },
    reduceMotion: { on: (v) => { if (v) document.documentElement.dataset.reduceMotion = 'true'; else delete document.documentElement.dataset.reduceMotion; }, off: () => { if (saved('mvl-reduce-motion', 'false') === 'true') document.documentElement.dataset.reduceMotion = 'true'; else delete document.documentElement.dataset.reduceMotion; } },
    displayName: { on: (v) => window.MVLPersonal.displayName && window.MVLPersonal.displayName.setOverride(v), off: () => window.MVLPersonal.displayName && window.MVLPersonal.displayName.setOverride(null) }
  };
  for (const k of ['lowStimulation', 'focus', 'timeAwareness']) appliers['adhd.' + k] = { on: (v) => window.MVLPersonal.adhd && window.MVLPersonal.adhd.setOverride(k, v), off: () => window.MVLPersonal.adhd && window.MVLPersonal.adhd.setOverride(k, null) };

  function evaluate() {
    const report = C.resolve(schedule, new Date(), () => false);
    for (const k of Object.keys(appliers)) {
      const want = report.values[k], had = applied[k];
      if (want && (!had || had.value !== want.value)) { try { appliers[k].on(want.value); } catch { /* the base setting stays */ } }
      else if (!want && had) { try { appliers[k].off(); } catch { /* ignore */ } }
    }
    applied = report.values;
    for (const id of report.skipped) if (!warned.has(id)) {
      warned.add(id);
      const r = schedule.rules.find((x) => x.id === id);
      if (window.MVLNotify) window.MVLNotify.push({ kind: 'warning', title: 'Scheduled rule skipped', body: (r && r.label ? r.label + ': ' : '') + UNAVAILABLE, silent: true });
    }
    lastReport = report;
    for (const f of listeners) { try { f(report); } catch { /* listener errors stay local */ } }
  }

  // ---------- UI ----------
  function valueOptions(setting, current) {
    const def = C.SETTINGS[setting];
    if (setting === 'seed') return `<select data-f="value">${seeds().map((s) => `<option${s === current ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select>`;
    if (setting === 'displayName') return `<input type="text" maxlength="40" data-f="value" value="${esc(current || '')}">`;
    const label = (v) => ({ system: 'System', light: 'Light', dark: 'Dark', en: 'English', yue: 'Cantonese', bi: 'Bilingual', true: 'On', false: 'Off' })[String(v)] || String(v);
    return `<select data-f="value">${def.values.map((v) => `<option value="${esc(String(v))}"${String(v) === String(current) ? ' selected' : ''}>${esc(label(v))}</option>`).join('')}</select>`;
  }
  function describe(r) {
    const days = r.every ? 'Every day' : (r.days || []).slice().sort().map((d) => DAYS[d].slice(0, 3)).join(', ');
    const set = C.SETTINGS[r.setting] ? C.SETTINGS[r.setting].label : r.setting;
    const v = typeof r.value === 'boolean' ? (r.value ? 'on' : 'off') : r.value;
    const cross = r.start > r.end ? ' (crosses midnight)' : r.start === r.end ? ' (all day)' : '';
    const dates = r.startDate || r.endDate ? ', ' + (r.startDate || 'any date') + ' to ' + (r.endDate || 'no end date') : '';
    return `${days}, ${r.start} to ${r.end}${cross}${dates}: ${set} ${v}`;
  }
  function control() {
    const box = document.createElement('section');
    box.className = 'personal-card personal-schedule';
    const id = 'psc-' + Math.random().toString(36).slice(2, 7);
    box.setAttribute('aria-labelledby', id);
    box.innerHTML = `<h3 id="${id}">Scheduled settings</h3>
<p class="small" data-psc-tz></p>
<div data-psc-search></div>
<ol class="personal-rules" data-psc-list aria-label="Schedule rules, highest priority first"></ol>
<p class="small" data-psc-empty hidden>No rules yet. Your settings stay exactly as you set them until you add one.</p>
<div class="row"><button type="button" class="btn primary" data-psc-add>Add a rule</button><button type="button" class="btn" data-psc-export>Export rules</button><label class="btn personal-file">Import rules<input type="file" accept="application/json,.json" data-psc-import></label></div>
<p class="small" role="status" data-psc-status></p>
<form class="personal-form" data-psc-form hidden novalidate aria-label="Edit rule">
  <label class="field"><span>Label</span><input type="text" maxlength="60" data-f="label"></label>
  <label class="field"><span>Setting</span><select data-f="setting"></select></label>
  <label class="field"><span>Value</span><span data-psc-value></span></label>
  <div class="row"><label class="field"><span>Start time</span><input type="time" data-f="start" required></label><label class="field"><span>End time</span><input type="time" data-f="end" required></label></div>
  <label class="switch-row"><span>Every day</span><input type="checkbox" role="switch" data-f="every"></label>
  <fieldset class="personal-days" data-psc-days><legend>Weekdays</legend>${DAYS.map((d, i) => `<label class="chipbtn personal-day"><input type="checkbox" value="${i}" data-day> ${d.slice(0, 3)}</label>`).join('')}</fieldset>
  <div class="row"><label class="field"><span>From date (optional)</span><input type="date" data-f="startDate"></label><label class="field"><span>Until date (optional)</span><input type="date" data-f="endDate"></label></div>
  <label class="field"><span>Value comes from</span><select data-f="source">${Object.entries(SOURCES).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></label>
  <p class="small warn" data-psc-src hidden>${esc(UNAVAILABLE)}</p>
  <label class="switch-row"><span>Rule enabled</span><input type="checkbox" role="switch" data-f="enabled" checked></label>
  <p class="errbox" role="alert" data-psc-err hidden></p>
  <div class="row"><button type="submit" class="btn primary">Save rule</button><button type="button" class="btn" data-psc-cancel>Cancel</button></div>
</form>`;
    const $ = (s) => box.querySelector(s);
    const form = $('[data-psc-form]'), list = $('[data-psc-list]'), status = $('[data-psc-status]');
    const search = window.MVL && window.MVL.makeSearch ? window.MVL.makeSearch({ placeholder: 'Search rules', label: 'Search schedule rules', onChange: () => renderList() }) : null;
    if (search) $('[data-psc-search]').append(search.el);
    let editing = null;

    function renderList() {
      $('[data-psc-tz]').textContent = 'Times are wall-clock times in ' + tz() + '. When clocks go forward, a window that starts in the skipped hour begins once the clock passes its start; when clocks go back, the repeated hour counts as inside the window both times. A window whose end is earlier than its start crosses midnight and belongs to the day it started; equal start and end means all day. When two rules set the same thing, the one higher in this list wins.';
      const rules = schedule.rules.filter((r) => !(school() && r.setting === 'lang')).filter((r) => !search || !search.active() || search.test(r.label + ' ' + describe(r)));
      $('[data-psc-empty]').hidden = schedule.rules.length > 0;
      list.innerHTML = rules.map((r) => {
        const i = schedule.rules.indexOf(r), active = lastReport.values[r.setting] && lastReport.values[r.setting].ruleId === r.id;
        const skipped = lastReport.skipped.includes(r.id), errs = C.validateRule(r, seeds());
        const st = errs.length ? 'Invalid: ' + errs[0] : skipped ? 'Skipped: source unavailable' : active ? 'Applying now' : r.enabled === false ? 'Disabled' : 'Waiting';
        return `<li class="personal-rule${active ? ' is-active' : ''}"><div><strong>${esc(r.label || 'Untitled rule')}</strong><span class="small">${esc(describe(r))}</span><span class="chipst ${active ? 'lime' : skipped || errs.length ? 'amber' : ''}">${esc(st)}</span></div>
<div class="row"><button type="button" class="btn sm" data-act="edit" data-i="${i}" aria-label="Edit ${esc(r.label || 'rule')}">Edit</button><button type="button" class="btn sm" data-act="up" data-i="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Move ${esc(r.label || 'rule')} up">Up</button><button type="button" class="btn sm" data-act="down" data-i="${i}" ${i === schedule.rules.length - 1 ? 'disabled' : ''} aria-label="Move ${esc(r.label || 'rule')} down">Down</button><button type="button" class="btn sm danger" data-act="del" data-i="${i}" aria-label="Delete ${esc(r.label || 'rule')}">Delete</button></div></li>`;
      }).join('');
      if (search) search.setStatus(rules.length + ' of ' + schedule.rules.length + ' rules');
    }
    function fill(r) {
      editing = r;
      form.querySelector('[data-f="setting"]').innerHTML = Object.entries(C.SETTINGS).filter(([k]) => !(school() && k === 'lang')).map(([k, d]) => `<option value="${k}">${esc(d.label)}</option>`).join('');
      for (const el of form.querySelectorAll('[data-f]')) {
        const k = el.dataset.f; if (k === 'value') continue;
        if (el.type === 'checkbox') el.checked = k === 'enabled' ? r.enabled !== false : !!r[k]; else el.value = r[k] || (k === 'source' ? 'local' : '');
      }
      for (const d of form.querySelectorAll('[data-day]')) d.checked = (r.days || []).includes(Number(d.value));
      $('[data-psc-value]').innerHTML = valueOptions(r.setting, r.value);
      syncForm();
      $('[data-psc-err]').hidden = true; form.hidden = false; form.querySelector('[data-f="label"]').focus();
    }
    function syncForm() { $('[data-psc-days]').disabled = form.querySelector('[data-f="every"]').checked; $('[data-psc-src]').hidden = form.querySelector('[data-f="source"]').value === 'local'; }
    function read() {
      const r = { id: editing.id, label: form.querySelector('[data-f="label"]').value.trim(), enabled: form.querySelector('[data-f="enabled"]').checked, every: form.querySelector('[data-f="every"]').checked, days: [...form.querySelectorAll('[data-day]:checked')].map((d) => Number(d.value)), start: form.querySelector('[data-f="start"]').value, end: form.querySelector('[data-f="end"]').value, startDate: form.querySelector('[data-f="startDate"]').value, endDate: form.querySelector('[data-f="endDate"]').value, setting: form.querySelector('[data-f="setting"]').value, source: form.querySelector('[data-f="source"]').value };
      const v = form.querySelector('[data-f="value"]').value;
      r.value = C.SETTINGS[r.setting].values && C.SETTINGS[r.setting].values.includes(true) ? v === 'true' : v;
      if (r.every) r.days = [];
      return r;
    }
    form.addEventListener('change', (e) => { if (e.target.dataset.f === 'setting') $('[data-psc-value]').innerHTML = valueOptions(e.target.value, ''); syncForm(); });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const r = read(), errs = C.validateRule(r, seeds());
      if (errs.length) { const err = $('[data-psc-err]'); err.textContent = errs.join(' '); err.hidden = false; return; }
      const i = schedule.rules.findIndex((x) => x.id === r.id);
      if (i >= 0) schedule.rules[i] = r; else { if (schedule.rules.length >= C.MAX_RULES) { status.textContent = 'A schedule holds at most ' + C.MAX_RULES + ' rules.'; return; } schedule.rules.push(r); }
      persist(i >= 0 ? 'edit' : 'add', (i >= 0 ? 'Rule edited: ' : 'Rule added: ') + (r.label || describe(r)));
      form.hidden = true; status.textContent = 'Saved. ' + describe(r) + '.'; renderList(); $('[data-psc-add]').focus();
    });
    $('[data-psc-cancel]').addEventListener('click', () => { form.hidden = true; $('[data-psc-add]').focus(); });
    $('[data-psc-add]').addEventListener('click', () => fill({ id: newId(), label: '', enabled: true, every: true, days: [], start: '22:00', end: '07:00', startDate: '', endDate: '', setting: 'theme', value: 'dark', source: 'local' }));
    list.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const i = Number(b.dataset.i), r = schedule.rules[i]; if (!r) return;
      if (b.dataset.act === 'edit') fill(JSON.parse(JSON.stringify(r)));
      if (b.dataset.act === 'up' && i > 0) { schedule.rules.splice(i - 1, 0, schedule.rules.splice(i, 1)[0]); persist('reorder', 'Rule moved up'); renderList(); }
      if (b.dataset.act === 'down' && i < schedule.rules.length - 1) { schedule.rules.splice(i + 1, 0, schedule.rules.splice(i, 1)[0]); persist('reorder', 'Rule moved down'); renderList(); }
      if (b.dataset.act === 'del') {
        const ok = window.MVLSuperConfirm ? await C.confirm({ action: 'Delete the rule "' + (r.label || describe(r)) + '"', affected: 'This schedule rule. Your base settings are not changed.' }) : true;
        if (ok) { schedule.rules.splice(i, 1); persist('delete', 'Rule deleted'); status.textContent = 'Rule deleted.'; renderList(); }
      }
    });
    $('[data-psc-export]').addEventListener('click', () => { C.download('mvl-schedule.json', JSON.stringify(schedule, null, 2)); status.textContent = 'Exported ' + schedule.rules.length + ' rules. No credentials are ever part of a schedule.'; });
    $('[data-psc-import]').addEventListener('change', async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      try {
        const data = C.migrateSchedule(JSON.parse(await C.readTextFile(f)));
        const bad = data.rules.map((r) => C.validateRule(r, seeds())).findIndex((x) => x.length);
        if (bad >= 0) throw new Error('Rule ' + (bad + 1) + ' is invalid: ' + C.validateRule(data.rules[bad], seeds())[0]);
        if (new Set(data.rules.map((r) => r.id)).size !== data.rules.length) throw new Error('Two rules share an id.');
        schedule = data; persist('import', 'Imported ' + data.rules.length + ' rules'); status.textContent = 'Imported ' + data.rules.length + ' rules.'; renderList();
      } catch (ex) { status.textContent = 'Nothing was imported: ' + ex.message; }
    });
    listeners.add(renderList);
    renderList();
    return box;
  }

  function init() {
    if (started) return; started = true;
    const go = () => { evaluate(); timer = setInterval(evaluate, 30000); document.addEventListener('visibilitychange', () => { if (!document.hidden) evaluate(); }); };
    if (document.readyState === 'complete') setTimeout(go); else window.addEventListener('load', () => setTimeout(go), { once: true });
    if (window.MVLTools) window.MVLTools.register({ id: 'personal-schedule', title: 'Scheduled settings', group: 'Personal', summary: 'Change theme, language and more on a weekly schedule.', mount(el) { const c = control(); c.classList.add('in-tool'); el.append(c); } });
  }

  // Settings history integration. Temporary values (a schedule rule or School mode) are not changes by
  // the person, so overridesActive() lets the history skip them; the personal settings that are real
  // choices join the history as fields when MVLHistory is present.
  function overridesActive() { return Object.keys(applied).length > 0 || !!(window.MVLSchool && window.MVLSchool.active()); }
  function joinHistory() {
    const H = window.MVLHistory; if (!H || typeof H.field !== 'function') return;
    const P = window.MVLPersonal;
    H.field('displayName', { label: 'App name', read: () => (P.displayName ? (store.get('mvl-display-name', '') || '') : undefined), apply: (v) => { if (!P.displayName) return; if (v) P.displayName.set(v); else P.displayName.reset(); } });
    if (P.adhd) for (const m of P.adhd.modes) H.field('adhd.' + m.id, { label: m.label, read: () => !!(store.get('mvl-adhd', {}) || {})[m.id], apply: (v) => P.adhd.set(m.id, !!v), fmt: (v) => (v ? 'On' : 'Off') });
    H.field('accent', { label: 'App accent', read: () => store.get('mvl-accent', '') || '', apply: () => { throw new Error('Set the accent again in the Colour picker tool; history keeps only which accent was chosen.'); }, fmt: (v) => (C.isRainbow(v) ? 'Animated rainbow' : v || 'Follows the seed colour') });
    H.field('rainbowLevel', { label: 'Rainbow speed level', read: () => store.get('mvl-rainbow-level', 3), apply: (v) => P.color && P.color.setRainbowLevel(v) });
    H.field('logo', { label: 'App logo', read: () => { const v = store.get('mvl-logo', null); return v && v.kind === 'custom' ? 'custom image' : (v && v.id) || 'shipped'; }, apply: () => { throw new Error('A logo image is never kept in history. Choose the logo again in the App logo tool.'); } });
    H.field('schedule', { label: 'Schedule rules', read: () => schedule.rules.length, apply: () => { throw new Error('Schedule rules are restored by importing an exported rules file.'); }, fmt: (v) => v + ' rules' });
  }
  if (document.readyState === 'complete') setTimeout(joinHistory); else window.addEventListener('load', () => setTimeout(joinHistory), { once: true });

  window.MVLPersonal = window.MVLPersonal || {};
  window.MVLPersonal.overridesActive = overridesActive;
  window.MVLPersonal.schedule = { init, control, evaluate, report: () => lastReport, rules: () => schedule.rules.slice(), onChange: (f) => listeners.add(f), _stop: () => clearInterval(timer) };
  init();
})();
