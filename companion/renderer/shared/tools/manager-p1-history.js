'use strict';
// Local version history of settings and preferences, kept on this device only.
//  - Records theme, seed colour, reduce motion, motion profile, language, funny levels, emoji, whether a
//    personal vocabulary is loaded (never its content), and what each app adds with MVLHistory.field
//    (the manager adds the default network and the state root).
//  - Every real change is one revision labelled with what changed; an unchanged state records nothing.
//  - Undo, redo and restore apply a past state and are themselves recorded as new revisions, so history
//    only grows; undoing an undo works. Storage is bounded: the oldest revisions go first, and the panel
//    says how many were removed.
//  - The panel (an MVLTools tool and MVLHistory.open()) filters by date range, by the actions found in
//    the history with their counts, and by text or regex; it exports, imports settings, labels, deletes
//    selected revisions and clears, the last two behind the super confirmation.
(function (root) {
  const KEY = 'mvl-settings-history';
  const LIMIT = 300;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const W = () => root;
  const ds = () => root.document.documentElement.dataset;
  const LANGS = { en: 'English', yue: 'Cantonese', bi: 'Bilingual' };

  // ---------- fields ----------
  const fields = new Map();
  function field(id, def) { fields.set(id, Object.assign({ id, label: id, fmt: (v) => (v === '' || v == null ? 'none' : String(v)) }, fields.get(id) || {}, def)); }
  field('theme', { label: 'Theme', read: () => ds().themePref || 'system', apply: (v) => W().MVL.setTheme(v), fmt: (v) => ({ system: 'System', light: 'Light', dark: 'Dark' }[v] || v) });
  field('seed', { label: 'Seed colour', read: () => ds().seed || '', apply: (v) => W().MVL.setSeed(v) });
  field('reduceMotion', { label: 'Reduce motion', read: () => ds().reduceMotion === 'true', apply: (v) => { W().MVL.setReduceMotion(!!v); if (W().MVLMotion) W().MVLMotion.apply(); }, fmt: (v) => (v ? 'On' : 'Off') });
  field('motionProfile', { label: 'Motion profile', read: () => (W().MVLMotion ? (W().MVLMotion.get() || {}).profile || '' : undefined), apply: (v) => W().MVLMotion && v && W().MVLMotion.setProfile(v) });
  field('language', { label: 'Language', read: () => (W().MVLI18n ? W().MVLI18n.mode() : undefined), apply: (v) => W().MVLI18n && W().MVLI18n.setMode(v), fmt: (v) => LANGS[v] || v });
  field('funnyEn', { label: 'Funny level, English', read: () => (W().MVLFunny ? W().MVLFunny.level('en') : undefined), apply: (v) => W().MVLFunny && W().MVLFunny.set('en', v) });
  field('funnyYue', { label: 'Funny level, Cantonese', read: () => (W().MVLFunny ? W().MVLFunny.level('yue') : undefined), apply: (v) => W().MVLFunny && W().MVLFunny.set('yue', v) });
  field('emoji', { label: 'Emoji in dialogs', read: () => (W().MVLFunny ? !!W().MVLFunny.emojiOn() : undefined), apply: (v) => W().MVLFunny && W().MVLFunny.setEmoji(!!v), fmt: (v) => (v ? 'On' : 'Off') });
  field('vocabulary', {
    label: 'Personal vocabulary', read: () => (W().MVLVocab ? (W().MVLVocab.status().loaded ? 'loaded' : 'not loaded') : undefined),
    apply: (v) => { if (v === 'not loaded') { W().MVLVocab.clear(); return; } throw new Error('A vocabulary file cannot be loaded again from history, because its content is never kept. Load the file again in Settings.'); },
    canApply: (v) => v === 'not loaded', fmt: (v) => (v === 'loaded' ? 'Loaded' : 'Not loaded')
  });

  function snapshot() {
    const s = {};
    for (const f of fields.values()) { try { const v = f.read(); if (v !== undefined) s[f.id] = v; } catch { /* a field that cannot be read is left out */ } }
    return s;
  }
  // Pure: the fields that differ between two snapshots, in field order.
  function diff(a, b, order) {
    const keys = order || [...new Set(Object.keys(a || {}).concat(Object.keys(b || {})))];
    const out = [];
    for (const k of keys) { const x = (a || {})[k], y = (b || {})[k]; if (x === undefined && y === undefined) continue; if (JSON.stringify(x) !== JSON.stringify(y)) out.push({ key: k, from: x, to: y }); }
    return out;
  }
  const fmtVal = (k, v) => (v === undefined ? 'not recorded' : (fields.get(k) ? fields.get(k).fmt(v) : String(v)));
  const lbl = (k) => (fields.get(k) ? fields.get(k).label : k);
  // Pure: a label that says what changed, not that something did.
  function describe(changes, verb) {
    if (!changes.length) return 'Nothing changed';
    if (changes.length === 1) { const c = changes[0]; return `${verb ? verb + ': ' : ''}${lbl(c.key)} from ${fmtVal(c.key, c.from)} to ${fmtVal(c.key, c.to)}`; }
    const names = changes.map((c) => lbl(c.key).toLowerCase());
    return `${verb ? verb + ': ' : ''}${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} changed`;
  }
  function actionFor(changes) {
    if (changes.length === 1 && changes[0].key === 'vocabulary') return changes[0].to === 'loaded' ? 'Vocabulary loaded' : 'Vocabulary cleared';
    return 'Settings changed';
  }

  // ---------- store ----------
  let st = load();
  function blank() { return { v: 1, items: [], undo: [], redo: [], pruned: 0, last: null, seq: 0 }; }
  function load() { try { const s = JSON.parse(root.localStorage.getItem(KEY) || 'null'); if (s && s.v === 1 && Array.isArray(s.items)) return Object.assign(blank(), s); } catch { /* fall through */ } return blank(); }
  function save() {
    try { root.localStorage.setItem(KEY, JSON.stringify(st)); }
    catch (e) { console.warn('Settings history could not be saved:', e && e.message); } // a history write never fails the change itself
    for (const f of listeners) { try { f(); } catch { /* ignore */ } }
  }
  const listeners = new Set();
  // Pure: keeps the newest `limit` revisions; returns how many were removed.
  function prune(state, limit) {
    const over = state.items.length - limit;
    if (over <= 0) return 0;
    const gone = new Set(state.items.slice(0, over).map((r) => r.id));
    state.items = state.items.slice(over);
    state.undo = state.undo.filter((id) => !gone.has(id)); state.redo = state.redo.filter((id) => !gone.has(id));
    state.pruned += over;
    return over;
  }
  // Pure: appends one revision to a state object.
  function append(state, rev, limit) {
    state.seq = (state.seq || 0) + 1;
    const r = Object.assign({ id: 'r' + state.seq + '-' + Date.now().toString(36), at: new Date().toISOString() }, rev);
    state.items.push(r);
    prune(state, limit || LIMIT);
    return r;
  }

  let applying = false, timer = null, started = false;
  function record(rev) { const r = append(st, rev); st.last = rev.after; save(); return r; }
  function check() {
    if (applying || !started) return;
    const now = snapshot();
    if (!st.last) { st.last = now; save(); return; }
    // A field that was not readable before (an app still loading its settings) is adopted, not recorded.
    const ch = diff(st.last, now).filter((c) => c.from !== undefined);
    if (!ch.length) { if (diff(st.last, now).length) { st.last = now; save(); } return; }
    record({ action: actionFor(ch), label: describe(ch), changes: ch, before: st.last, after: now });
    st.redo = []; st.undo.push(st.items[st.items.length - 1].id); save();
  }
  const soon = () => { clearTimeout(timer); timer = setTimeout(check, 350); };

  // Applies the given values field by field; returns what was applied and what was skipped.
  async function applyValues(values) {
    applying = true;
    const done = [], skipped = [];
    try {
      for (const [k, v] of Object.entries(values)) {
        const f = fields.get(k);
        if (!f || !f.apply) { skipped.push({ key: k, reason: 'This app does not have this setting.' }); continue; }
        if (f.canApply && !f.canApply(v)) { skipped.push({ key: k, reason: 'A vocabulary file cannot be loaded again from history, because its content is never kept. Load the file again in Settings.' }); continue; }
        try { await f.apply(v); done.push(k); } catch (e) { skipped.push({ key: k, reason: (e && e.message) || String(e) }); }
      }
    } finally {
      await new Promise((r) => setTimeout(r, 30));
      applying = false;
    }
    return { done, skipped };
  }
  async function applyRevision(target, action, labelText, pushTo) {
    const before = snapshot();
    const res = await applyValues(target);
    const after = snapshot();
    const ch = diff(before, after);
    if (!ch.length) { st.last = after; save(); return Object.assign(res, { revision: null, changes: [] }); }
    const r = record({ action, label: labelText + (res.skipped.length ? ` (${res.skipped.length} not restored)` : ''), changes: ch, before, after, skipped: res.skipped.map((s) => ({ key: s.key, reason: s.reason })) });
    if (pushTo === 'undo') st.undo.push(r.id); save();
    return Object.assign(res, { revision: r, changes: ch });
  }
  const byId = (id) => st.items.find((r) => r.id === id);
  async function undo() {
    const id = st.undo[st.undo.length - 1]; const r = byId(id);
    if (!r) return { ok: false, error: 'There is nothing to undo.' };
    st.undo.pop();
    const target = {}; for (const c of r.changes) target[c.key] = c.from;
    const res = await applyRevision(target, 'Undone', 'Undid: ' + r.label);
    st.redo.push(id); save();
    return Object.assign({ ok: true, of: r }, res);
  }
  async function redo() {
    const id = st.redo[st.redo.length - 1]; const r = byId(id);
    if (!r) return { ok: false, error: 'There is nothing to redo.' };
    st.redo.pop();
    const target = {}; for (const c of r.changes) target[c.key] = c.to;
    const res = await applyRevision(target, 'Redone', 'Redid: ' + r.label);
    st.undo.push(id); save();
    return Object.assign({ ok: true, of: r }, res);
  }
  async function restore(id) {
    const r = byId(id); if (!r) return { ok: false, error: 'That revision is no longer in the history.' };
    const res = await applyRevision(r.after, 'Restored', 'Restored the state of ' + new Date(r.at).toLocaleString(), 'undo');
    st.redo = []; save();
    return Object.assign({ ok: true }, res);
  }
  // Pure: validates an imported settings file; returns { ok, values } or { ok: false, error }.
  function parseImport(text, known) {
    let j; try { j = JSON.parse(text); } catch (e) { return { ok: false, error: 'Not JSON: ' + e.message }; }
    const src = j && j.meta && Array.isArray(j.items) ? j.items : null;
    let values = null;
    if (src) { values = {}; for (const row of src) if (row && typeof row.setting === 'string' && 'value' in row) values[row.setting] = row.value; }
    else if (j && j.format === 'material-vm-labs-settings' && j.settings && typeof j.settings === 'object') values = j.settings;
    if (!values) return { ok: false, error: 'This is not a Material VM Labs settings export.' };
    const out = {}, ignored = [];
    for (const [k, v] of Object.entries(values)) {
      if (!known.includes(k)) { ignored.push(k); continue; }
      if (!(typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) return { ok: false, error: `The value of ${k} is not a plain value.` };
      if (typeof v === 'string' && v.length > 400) return { ok: false, error: `The value of ${k} is too long.` };
      out[k] = v;
    }
    if (!Object.keys(out).length) return { ok: false, error: 'The file holds no setting this app knows.' };
    return { ok: true, values: out, ignored };
  }
  async function importValues(values) {
    const res = await applyRevision(values, 'Imported', 'Imported settings from a file', 'undo');
    st.redo = []; save();
    return res;
  }
  // The settings rows used by the export and the import (re-importable JSON, YAML, TOML or XML).
  function settingsRows() { const s = snapshot(); return Object.keys(s).map((k) => ({ setting: k, label: lbl(k), value: s[k], shown: fmtVal(k, s[k]) })); }
  const historyRows = (items) => items.map((r) => ({ id: r.id, at: r.at, action: r.action, label: r.label, note: r.note || '', changes: r.changes.map((c) => ({ setting: c.key, from: c.from === undefined ? null : c.from, to: c.to === undefined ? null : c.to })) }));

  // ---------- panel ----------
  function mount(el, ctx) {
    ctx = ctx || {};
    const toast = (m, k) => (ctx.toast ? ctx.toast(m, k) : root.MVL && root.MVL.toast(m, k));
    const confirmBig = (o) => root.MVLExport.askSuper(o); // moved into the Tools dialog so it paints on top
    const search = root.MVL.makeSearch({ placeholder: 'Search the history', label: 'Search the settings history', onChange: () => draw() });
    const dates = root.MVLDates.range({ label: 'Changed between', onChange: () => draw() });
    const sel = root.MVLBulk.selection(() => draw());
    const actOn = new Set();
    el.classList.add('p1-history');
    el.innerHTML = `<p class="small">Every change to the appearance, motion, language, funny levels and the other settings below is kept on this device, so any change can be undone. Undo, redo and restore are recorded too, so nothing is ever rewritten. The personal vocabulary is recorded only as loaded or not loaded, never its words.</p>
<div class="row p1-h-acts"><button type="button" class="btn primary sm" data-h="undo"></button><button type="button" class="btn sm" data-h="redo"></button><span class="grow"></span><button type="button" class="btn sm" data-h="export-settings">Export settings</button><label class="btn sm p1-file">Import settings<input type="file" accept=".json,application/json" data-h="import" class="sr"></label></div>
<div class="p1-h-search"></div><div class="p1-h-dates"></div>
<div class="p1-h-actions" role="group" aria-label="Filter by action"></div>
<p class="small" role="status" data-h="line"></p>
<div class="row p1-h-bulk"><button type="button" class="btn sm light" data-h="sel-shown"></button><button type="button" class="btn sm light" data-h="invert">Invert</button><button type="button" class="btn sm light" data-h="none">Clear selection</button><span class="grow"></span><button type="button" class="btn sm" data-h="export"></button><button type="button" class="btn sm danger" data-h="delete"></button></div>
<ol class="p1-timeline" aria-label="Settings history, newest first"></ol>
<p class="small" data-h="bound"></p>
<div class="row"><button type="button" class="btn sm danger" data-h="clear">Clear the whole history</button></div>`;
    el.querySelector('.p1-h-search').append(search.el);
    el.querySelector('.p1-h-dates').append(dates.el);
    const tl = el.querySelector('.p1-timeline');

    const filtered = () => st.items.slice().reverse().filter((r) => (!actOn.size || actOn.has(r.action)) && dates.test(root.MVLDates.localDay(r.at)) && (!search.active() || (!search.invalid() && search.test([r.label, r.action, r.note || '', r.changes.map((c) => lbl(c.key) + ' ' + fmtVal(c.key, c.from) + ' ' + fmtVal(c.key, c.to)).join(' ')].join(' ')))));
    function draw() {
      sel.prune(st.items.map((r) => r.id));
      const u = byId(st.undo[st.undo.length - 1]), rd = byId(st.redo[st.redo.length - 1]);
      const ub = el.querySelector('[data-h=undo]'), rb = el.querySelector('[data-h=redo]');
      ub.textContent = u ? 'Undo: ' + u.label : 'Nothing to undo'; ub.disabled = !u;
      rb.textContent = rd ? 'Redo: ' + rd.label : 'Nothing to redo'; rb.disabled = !rd;
      // Action filter: the actions actually recorded, with their counts.
      const counts = new Map(); for (const r of st.items) counts.set(r.action, (counts.get(r.action) || 0) + 1);
      for (const a of [...actOn]) if (!counts.has(a)) actOn.delete(a);
      el.querySelector('.p1-h-actions').innerHTML = counts.size ? [...counts].map(([a, n]) => `<button type="button" class="chipbtn p1-chip" data-act="${esc(a)}" aria-pressed="${actOn.has(a)}">${esc(a)} <span class="p1-n">${n}</span></button>`).join('') : '<span class="small">No actions recorded yet.</span>';
      const rows = filtered();
      const parts = [];
      if (search.active()) parts.push(`${search.isRegex() ? 'regex' : 'text'} "${search.term()}"`);
      if (dates.active()) parts.push(dates.describe());
      if (actOn.size) parts.push('actions: ' + [...actOn].join(', '));
      el.querySelector('[data-h=line]').textContent = !dates.valid() ? 'A date is not complete yet, so it is not applied. ' + `${rows.length} of ${st.items.length} shown.` : `${rows.length} of ${st.items.length} revisions shown${parts.length ? ', filtered by ' + parts.join('; ') : ''}. ${sel.size()} selected.`;
      if (search.active() && search.isRegex()) search.setStatus(`${rows.length} of ${st.items.length}`);
      const n = sel.size();
      el.querySelector('[data-h=sel-shown]').textContent = parts.length ? `Select the ${rows.length} shown` : `Select all ${rows.length}`;
      el.querySelector('[data-h=sel-shown]').disabled = !rows.length;
      el.querySelector('[data-h=export]').textContent = n ? `Export ${n} selected` : parts.length ? `Export the ${rows.length} shown` : 'Export the history';
      el.querySelector('[data-h=export]').disabled = !(n || rows.length);
      el.querySelector('[data-h=delete]').textContent = `Delete ${n} selected`; el.querySelector('[data-h=delete]').disabled = !n;
      el.querySelector('[data-h=none]').disabled = !n; el.querySelector('[data-h=invert]').disabled = !rows.length;
      el.querySelector('[data-h=clear]').disabled = !st.items.length;
      el.querySelector('[data-h=bound]').textContent = `Keeps the newest ${LIMIT} revisions on this device; older ones are removed first.` + (st.pruned ? ` ${st.pruned} older revision${st.pruned === 1 ? ' was' : 's were'} removed so far.` : ' None has been removed yet.');
      if (!st.items.length) { tl.innerHTML = '<li class="p1-empty">No settings change recorded yet. Change the theme, the language or another setting, and it shows up here.</li>'; return; }
      if (search.invalid()) { tl.innerHTML = '<li class="p1-empty">That regex pattern is not valid yet, so nothing is listed.</li>'; return; }
      if (!rows.length) { tl.innerHTML = `<li class="p1-empty">No revision matches${parts.length ? ' ' + esc(parts.join('; ')) : ''}. ${st.items.length} revision${st.items.length === 1 ? ' is' : 's are'} hidden by the filters.</li>`; return; }
      let day = '', h = '';
      for (const r of rows) {
        const d = root.MVLDates.localDay(r.at);
        if (d !== day) { day = d; h += `<li class="p1-day-h" aria-hidden="true">${esc(new Date(r.at).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }))}</li>`; }
        const isUndo = st.undo[st.undo.length - 1] === r.id;
        h += `<li class="p1-rev${sel.has(r.id) ? ' p1-selected' : ''}" data-rev="${esc(r.id)}">${root.MVLBulk.checkbox(r.id, r.label, sel.has(r.id))}<div class="grow p1-rev-body"><div class="row"><span class="pill ${r.action === 'Settings changed' ? 'cyan' : r.action === 'Undone' || r.action === 'Restored' ? 'amber' : 'lime'}">${esc(r.action)}</span><time class="small" datetime="${esc(r.at)}">${esc(new Date(r.at).toLocaleTimeString())}</time>${isUndo ? '<span class="small">Next undo</span>' : ''}</div>
<strong>${esc(r.label)}</strong>${r.note ? `<span class="p1-note">Label: ${esc(r.note)}</span>` : ''}
<ul class="p1-changes">${r.changes.map((c) => `<li>${esc(lbl(c.key))}: <s>${esc(fmtVal(c.key, c.from))}</s> to <b>${esc(fmtVal(c.key, c.to))}</b></li>`).join('')}${(r.skipped || []).map((s) => `<li class="p1-skip">${esc(lbl(s.key))} not restored: ${esc(s.reason)}</li>`).join('')}</ul>
<div class="row"><button type="button" class="btn sm" data-restore="${esc(r.id)}">Restore this state</button><button type="button" class="btn sm light" data-label="${esc(r.id)}">${r.note ? 'Change label' : 'Add a label'}</button></div></div></li>`;
      }
      tl.innerHTML = h;
    }
    const shownIds = () => filtered().map((r) => r.id);
    el.addEventListener('click', async (e) => {
      const c = e.target.closest('[data-sel-id]'); if (c) { sel.toggle(c.dataset.selId, shownIds(), e.shiftKey); const id = c.dataset.selId; setTimeout(() => { draw(); const a = el.querySelector(`[data-sel-id="${CSS.escape(id)}"]`); if (a) a.focus(); }); return; }
      const a = e.target.closest('[data-act]'); if (a) { if (actOn.has(a.dataset.act)) actOn.delete(a.dataset.act); else actOn.add(a.dataset.act); draw(); const again = el.querySelector(`[data-act="${CSS.escape(a.dataset.act)}"]`); if (again) again.focus(); return; }
      const rs = e.target.closest('[data-restore]');
      if (rs) {
        const r = byId(rs.dataset.restore); if (!r) return;
        const now = snapshot(); const ch = diff(now, r.after);
        if (!ch.length) { toast('The settings already match that state, so nothing would change.'); return; }
        const skip = ch.filter((x) => fields.get(x.key) && fields.get(x.key).canApply && !fields.get(x.key).canApply(x.to));
        const ok = await root.MVLBulk.review({ title: 'Restore the state of ' + new Date(r.at).toLocaleString(), selected: ch.length, countText: `${ch.length} setting${ch.length === 1 ? '' : 's'} differ from now.`, change: ch.filter((x) => !skip.includes(x)).map((x) => ({ name: lbl(x.key), note: `${fmtVal(x.key, x.from)} to ${fmtVal(x.key, x.to)}` })), skip: skip.map((x) => ({ name: lbl(x.key), reason: 'Its content is never kept, so it cannot be loaded again from history.' })), note: 'The restore is recorded as a new revision, so you can undo it.', confirmLabel: 'Restore' });
        if (!ok) return;
        const res = await restore(r.id);
        toast(res.revision ? `Restored ${res.changes.length} setting${res.changes.length === 1 ? '' : 's'}${res.skipped.length ? `; ${res.skipped.length} could not be restored` : ''}` : 'Nothing changed', res.skipped.length ? 'warning' : 'success');
        return;
      }
      const lb = e.target.closest('[data-label]');
      if (lb) {
        const r = byId(lb.dataset.label); if (!r) return;
        const row = lb.closest('.row');
        row.innerHTML = `<label class="field grow">Label<input data-label-in maxlength="120" value="${esc(r.note || '')}"></label><button type="button" class="btn sm primary" data-label-save="${esc(r.id)}">Save label</button>`;
        row.querySelector('input').focus();
        return;
      }
      const ls = e.target.closest('[data-label-save]');
      if (ls) { const r = byId(ls.dataset.labelSave); if (r) { r.note = ls.closest('.row').querySelector('input').value.trim().slice(0, 120); save(); toast(r.note ? 'Label saved' : 'Label removed'); } return; }
      const b = e.target.closest('[data-h]'); if (!b || b.tagName !== 'BUTTON') return;
      const k = b.dataset.h;
      if (k === 'undo' || k === 'redo') { const res = await (k === 'undo' ? undo() : redo()); toast(res.ok ? `${k === 'undo' ? 'Undid' : 'Redid'}: ${res.of.label}${res.skipped && res.skipped.length ? ` (${res.skipped.length} not applied)` : ''}` : res.error, res.ok ? 'success' : 'error'); }
      if (k === 'sel-shown') sel.add(shownIds());
      if (k === 'invert') sel.invert(shownIds());
      if (k === 'none') sel.clear();
      if (k === 'export') {
        const ids = sel.size() ? sel.ids() : shownIds();
        const items = st.items.filter((r) => ids.includes(r.id)).reverse();
        root.MVLExport.open({ title: 'Settings history', name: 'settings-history', schema: 'mvl.settings-history/1', rows: historyRows(items), scope: sel.size() ? `${items.length} selected` : el.querySelector('[data-h=line]').textContent.replace(/ \d+ selected\.$/, '') });
      }
      if (k === 'export-settings') exportSettings();
      if (k === 'delete') {
        const ids = sel.ids();
        const ok = await confirmBig({ action: `Delete ${ids.length} revision${ids.length === 1 ? '' : 's'} from the history`, affected: ids.map((id) => (byId(id) || {}).label).filter(Boolean).join('; ') + '. Deleted revisions cannot be undone or restored, and they leave the undo and redo lists. Your current settings stay as they are.', anchor: b });
        if (!ok) return;
        const gone = new Set(ids);
        st.items = st.items.filter((r) => !gone.has(r.id)); st.undo = st.undo.filter((x) => !gone.has(x)); st.redo = st.redo.filter((x) => !gone.has(x));
        sel.clear(); save(); toast(`Deleted ${ids.length} revision${ids.length === 1 ? '' : 's'}`, 'success');
      }
      if (k === 'clear') {
        const ok = await confirmBig({ action: 'Clear the whole settings history', affected: `All ${st.items.length} revisions are deleted from this device, with undo and redo. Your current settings stay as they are. This cannot be undone.`, anchor: b });
        if (!ok) return;
        const now = snapshot(); st = blank(); st.last = now; started = true; sel.clear(); save(); toast('The settings history is cleared', 'success');
      }
    });
    el.addEventListener('change', async (e) => {
      if (!e.target.matches('[data-h=import]')) return;
      const file = e.target.files && e.target.files[0]; e.target.value = '';
      if (!file) return;
      if (file.size > 256 * 1024) { toast('That file is larger than 256 KB, so it was not read.', 'error'); return; }
      const res = parseImport(await file.text(), [...fields.keys()]);
      if (!res.ok) { toast('Not imported: ' + res.error, 'error'); return; }
      const now = snapshot(); const ch = diff(now, Object.assign({}, now, res.values));
      if (!ch.length) { toast('The file matches the current settings, so nothing changed.'); return; }
      const ok = await root.MVLBulk.review({ title: 'Import settings from ' + file.name, selected: ch.length, countText: `${ch.length} setting${ch.length === 1 ? '' : 's'} differ from now.`, change: ch.map((x) => ({ name: lbl(x.key), note: `${fmtVal(x.key, x.from)} to ${fmtVal(x.key, x.to)}` })), skip: res.ignored.map((x) => ({ name: x, reason: 'Not a setting of this app.' })), note: 'The import is recorded as a new revision, so you can undo it.', confirmLabel: 'Import' });
      if (!ok) return;
      const r = await importValues(res.values);
      toast(`Imported ${r.changes.length} setting${r.changes.length === 1 ? '' : 's'}${r.skipped.length ? `; ${r.skipped.length} not applied` : ''}`, r.skipped.length ? 'warning' : 'success');
    });
    listeners.add(draw);
    draw();
    return () => listeners.delete(draw);
  }
  function exportSettings() {
    root.MVLExport.open({ title: 'Settings', name: 'settings', schema: 'mvl.settings/1', rows: settingsRows(), scope: 'every setting this app keeps; the personal vocabulary only as loaded or not loaded' });
  }
  function open() { if (root.MVLTools) root.MVLTools.open('settings-history'); }

  function start() {
    if (started) return;
    const doc = root.document;
    // Settle first: apps apply saved settings while they start, which is not a change by the person.
    setTimeout(() => {
      started = true;
      st.last = snapshot(); save();
      new MutationObserver(soon).observe(doc.documentElement, { attributes: true, attributeFilter: ['data-theme-pref', 'data-seed', 'data-reduce-motion', 'data-lang'] });
      for (const m of ['MVLI18n', 'MVLFunny', 'MVLMotion', 'MVLVocab']) if (root[m] && root[m].onChange) root[m].onChange(soon);
      doc.addEventListener('mvl-appearance', soon);
      root.addEventListener('storage', soon);
    }, 1200);
    if (root.MVLTools) root.MVLTools.register({ id: 'settings-history', title: 'Settings history', group: 'History and exports', summary: 'Every settings change with undo, redo, restore and export', mount: (el, ctx) => { const off = mount(el, ctx); toolOff = off; }, unmount: () => { if (toolOff) toolOff(); toolOff = null; } });
    if (root.MVLPalette) {
      root.MVLPalette.register({ id: 'p1-hist-undo', title: 'Undo the last settings change', hint: 'Settings history', keywords: ['undo', 'history', 'revert'], run: async () => { const r = await undo(); root.MVL.toast(r.ok ? 'Undid: ' + r.of.label : r.error, r.ok ? 'success' : 'error'); } });
      root.MVLPalette.register({ id: 'p1-hist-redo', title: 'Redo the last undone settings change', hint: 'Settings history', keywords: ['redo', 'history'], run: async () => { const r = await redo(); root.MVL.toast(r.ok ? 'Redid: ' + r.of.label : r.error, r.ok ? 'success' : 'error'); } });
      root.MVLPalette.register({ id: 'p1-hist-export', title: 'Export settings', hint: 'JSON, YAML, TOML, XML, CSV and more', keywords: ['export', 'settings', 'backup'], run: () => setTimeout(exportSettings) });
    }
  }
  let toolOff = null;

  root.MVLHistory = { field, snapshot, diff, describe, actionFor, prune, append, parseImport, check: () => soon(), undo, redo, restore, open, mount, exportSettings, settingsRows, historyRows, items: () => st.items.slice(), onChange: (f) => listeners.add(f), _state: () => st, LIMIT };
  if (root.document) { if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', start); else start(); }
})(typeof window !== 'undefined' ? window : globalThis);
