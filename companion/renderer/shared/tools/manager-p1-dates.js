'use strict';
// Date range filter shared by the changelog viewer and the settings history.
//  - MVLDates.parse(text) reads a typed date: plain ISO (2026-11-20), the locale's day/month order
//    (20/11/2026 or 11/20/2026), and written months (20 Nov 2026, Nov 20 2026). A partial or invalid
//    entry is reported, never silently dropped.
//  - MVLDates.range({ label, onChange }) returns { el, get, set, active, describe, valid }: typed From
//    and To fields, named presets, and an anchored calendar with month and year jump and range
//    selection. Typing and the calendar stay in step; an invalid entry keeps what was typed.
(function (root) {
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
  const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

  // Day-first unless the locale writes the month first (en-US and friends).
  function localeOrder(locale) {
    try {
      const parts = new Intl.DateTimeFormat(locale || undefined).formatToParts(new Date(Date.UTC(2026, 10, 20)));
      const order = parts.filter((p) => p.type === 'day' || p.type === 'month' || p.type === 'year').map((p) => p.type[0]).join('');
      return order === 'mdy' ? 'mdy' : order === 'ymd' ? 'ymd' : 'dmy';
    } catch { return 'dmy'; }
  }

  function check(y, m, d) {
    if (!(y >= 1900 && y <= 2999)) return { ok: false, error: 'The year must be between 1900 and 2999.' };
    if (!(m >= 1 && m <= 12)) return { ok: false, error: 'The month must be 1 to 12.' };
    if (!(d >= 1 && d <= daysIn(y, m))) return { ok: false, error: `${MONTH_NAMES[m - 1]} ${y} has ${daysIn(y, m)} days.` };
    return { ok: true, date: iso(y, m, d) };
  }
  const monthOf = (w) => { const i = MONTHS.indexOf(String(w).slice(0, 3).toLowerCase()); return i < 0 ? 0 : i + 1; };

  function parse(text, order) {
    const s = String(text == null ? '' : text).trim();
    if (!s) return { empty: true, ok: true, date: '' };
    order = order || localeOrder();
    let m;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) return check(+m[1], +m[2], +m[3]);
    if ((m = /^(\d{4})(?:-(\d{1,2}))?-?$/.exec(s))) return { ok: false, partial: true, error: m[2] ? 'Add the day: YYYY-MM-DD.' : 'Add the month and day: YYYY-MM-DD.' };
    if ((m = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/.exec(s))) return check(+m[1], +m[2], +m[3]);
    if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s))) return order === 'mdy' ? check(+m[3], +m[1], +m[2]) : check(+m[3], +m[2], +m[1]);
    if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-]?$/.exec(s))) return { ok: false, partial: true, error: 'Add the year, for example ' + (order === 'mdy' ? '11/20/2026.' : '20/11/2026.') };
    if ((m = /^(\d{1,2})\s+([A-Za-z]{3,})\.?,?\s+(\d{4})$/.exec(s)) && monthOf(m[2])) return check(+m[3], monthOf(m[2]), +m[1]);
    if ((m = /^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s)) && monthOf(m[1])) return check(+m[3], monthOf(m[1]), +m[2]);
    if ((m = /^([A-Za-z]{3,})\.?\s+(\d{4})$/.exec(s)) && monthOf(m[1])) return { ok: false, partial: true, error: 'Add the day, for example 20 ' + MONTH_NAMES[monthOf(m[1]) - 1].slice(0, 3) + ' ' + m[2] + '.' };
    return { ok: false, error: 'Not a date. Use YYYY-MM-DD, ' + (order === 'mdy' ? 'MM/DD/YYYY' : 'DD/MM/YYYY') + ' or 20 Nov 2026.' };
  }

  const today = (now) => { const d = now || new Date(); return iso(d.getFullYear(), d.getMonth() + 1, d.getDate()); };
  function shift(isoDate, days) { const [y, m, d] = isoDate.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + days)); return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); }
  function presets(now) {
    const t = today(now), y = Number(t.slice(0, 4));
    return [
      { id: 'all', label: 'Any date', from: '', to: '' },
      { id: 'today', label: 'Today', from: t, to: t },
      { id: '7', label: 'Last 7 days', from: shift(t, -6), to: t },
      { id: '30', label: 'Last 30 days', from: shift(t, -29), to: t },
      { id: '90', label: 'Last 90 days', from: shift(t, -89), to: t },
      { id: 'year', label: 'This year', from: `${y}-01-01`, to: `${y}-12-31` },
      { id: 'lastyear', label: 'Last year', from: `${y - 1}-01-01`, to: `${y - 1}-12-31` }
    ];
  }
  // A date (ISO, or an ISO timestamp) inside an inclusive range; empty bounds are open.
  function inRange(value, from, to) {
    const d = String(value || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return !from && !to;
    return (!from || d >= from) && (!to || d <= to);
  }
  // A local ISO day for a timestamp, so "today" matches what the clock on this PC says.
  const localDay = (ts) => { const d = new Date(ts); return isNaN(d) ? '' : iso(d.getFullYear(), d.getMonth() + 1, d.getDate()); };

  // ---------- control ----------
  function range(opts) {
    opts = opts || {};
    const doc = root.document;
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const id = 'dr' + Math.random().toString(36).slice(2, 7);
    const order = localeOrder();
    const hint = order === 'mdy' ? 'YYYY-MM-DD or MM/DD/YYYY' : 'YYYY-MM-DD or DD/MM/YYYY';
    const el = doc.createElement('div');
    el.className = 'p1-range';
    el.setAttribute('role', 'group'); el.setAttribute('aria-label', opts.label || 'Date range');
    el.innerHTML = `<div class="p1-range-row">
<label class="field p1-date">From<input data-end="from" inputmode="numeric" autocomplete="off" spellcheck="false" placeholder="${esc(hint)}" aria-describedby="${id}-fe"><span class="p1-date-err" id="${id}-fe" role="status"></span></label>
<label class="field p1-date">To<input data-end="to" inputmode="numeric" autocomplete="off" spellcheck="false" placeholder="${esc(hint)}" aria-describedby="${id}-te"><span class="p1-date-err" id="${id}-te" role="status"></span></label>
<button type="button" class="btn sm" data-cal aria-expanded="false" aria-controls="${id}-cal">Calendar</button>
</div>
<div class="p1-presets" role="group" aria-label="Date presets">${presets().map((p) => `<button type="button" class="chipbtn p1-chip" data-preset="${p.id}" aria-pressed="${p.id === 'all'}">${esc(p.label)}</button>`).join('')}</div>
<div class="p1-cal" id="${id}-cal" hidden></div>`;
    const inputs = { from: el.querySelector('[data-end=from]'), to: el.querySelector('[data-end=to]') };
    const errs = { from: el.querySelector(`#${id}-fe`), to: el.querySelector(`#${id}-te`) };
    const cal = el.querySelector('.p1-cal'), calBtn = el.querySelector('[data-cal]');
    const st = { from: '', to: '', bad: { from: '', to: '' } };
    const now = new Date();
    let view = { y: now.getFullYear(), m: now.getMonth() + 1 };
    let picking = 'from';

    const fire = () => { syncPresets(); if (opts.onChange) opts.onChange(); };
    function syncPresets() { for (const b of el.querySelectorAll('[data-preset]')) { const p = presets().find((x) => x.id === b.dataset.preset); b.setAttribute('aria-pressed', String(!!p && p.from === st.from && p.to === st.to && !st.bad.from && !st.bad.to)); } }
    function readEnd(end) {
      const r = parse(inputs[end].value, order);
      if (r.ok) { st[end] = r.date; st.bad[end] = ''; errs[end].textContent = ''; inputs[end].removeAttribute('aria-invalid'); }
      else { st.bad[end] = r.error; errs[end].textContent = (r.partial ? 'Partial date: ' : '') + r.error + ' Not applied yet.'; inputs[end].setAttribute('aria-invalid', 'true'); }
      if (!st.bad.from && !st.bad.to && st.from && st.to && st.from > st.to) { errs.to.textContent = 'The end is before the start, so no date can match.'; }
    }
    for (const end of ['from', 'to']) {
      inputs[end].addEventListener('input', () => { readEnd(end); if (st[end] && !st.bad[end]) { const [y, m] = st[end].split('-').map(Number); view = { y, m }; } if (!cal.hidden) drawCal(); fire(); });
    }
    function set(from, to) {
      st.from = from || ''; st.to = to || ''; st.bad = { from: '', to: '' };
      inputs.from.value = st.from; inputs.to.value = st.to;
      for (const e of ['from', 'to']) { errs[e].textContent = ''; inputs[e].removeAttribute('aria-invalid'); }
      if (!cal.hidden) drawCal();
      fire();
    }
    el.querySelector('.p1-presets').addEventListener('click', (e) => { const b = e.target.closest('[data-preset]'); if (!b) return; const p = presets().find((x) => x.id === b.dataset.preset); if (p) set(p.from, p.to); });

    function drawCal() {
      const { y, m } = view;
      const first = new Date(y, m - 1, 1).getDay(); // 0 = Sunday
      const lead = (first + 6) % 7; // weeks start on Monday
      const n = daysIn(y, m);
      let cells = '';
      for (let i = 0; i < lead; i++) cells += '<span class="p1-cal-pad" aria-hidden="true"></span>';
      for (let d = 1; d <= n; d++) {
        const v = iso(y, m, d);
        const inR = st.from && st.to ? v >= st.from && v <= st.to : v === st.from || v === st.to;
        const edge = v === st.from || v === st.to;
        cells += `<button type="button" class="p1-day${inR ? ' in' : ''}${edge ? ' edge' : ''}${v === today() ? ' today' : ''}" data-day="${v}" aria-pressed="${inR}" aria-label="${d} ${MONTH_NAMES[m - 1]} ${y}${edge ? (v === st.from ? ', range start' : ', range end') : ''}" tabindex="-1">${d}</button>`;
      }
      cal.innerHTML = `<div class="p1-cal-head"><button type="button" class="iconbtn" data-nav="-1" aria-label="Previous month">&lsaquo;</button>
<label class="sr" for="${id}-mo">Month</label><select id="${id}-mo" data-mo>${MONTH_NAMES.map((n2, i) => `<option value="${i + 1}"${i + 1 === m ? ' selected' : ''}>${n2}</option>`).join('')}</select>
<label class="sr" for="${id}-yr">Year</label><input id="${id}-yr" data-yr type="number" min="1900" max="2999" value="${y}">
<button type="button" class="iconbtn" data-nav="1" aria-label="Next month">&rsaquo;</button></div>
<p class="small p1-cal-note" role="status">${picking === 'from' ? 'Pick the first day of the range.' : 'Pick the last day of the range.'}</p>
<div class="p1-cal-dow" aria-hidden="true"><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span><span>Su</span></div>
<div class="p1-cal-grid" role="group" aria-label="${MONTH_NAMES[m - 1]} ${y}">${cells}</div>`;
      const days = [...cal.querySelectorAll('[data-day]')];
      const focusDay = days.find((b) => b.classList.contains('edge')) || days.find((b) => b.classList.contains('today')) || days[0];
      if (focusDay) focusDay.tabIndex = 0;
    }
    cal.addEventListener('click', (e) => {
      const nav = e.target.closest('[data-nav]');
      if (nav) { let { y, m } = view; m += Number(nav.dataset.nav); if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; } view = { y, m }; drawCal(); cal.querySelector(`[data-nav="${nav.dataset.nav}"]`).focus(); return; }
      const day = e.target.closest('[data-day]'); if (!day) return;
      const v = day.dataset.day;
      if (picking === 'from') { st.from = v; st.to = ''; picking = 'to'; }
      else { if (v < st.from) { st.to = st.from; st.from = v; } else st.to = v; picking = 'from'; }
      st.bad = { from: '', to: '' };
      inputs.from.value = st.from; inputs.to.value = st.to; errs.from.textContent = ''; errs.to.textContent = '';
      drawCal(); const again = cal.querySelector(`[data-day="${v}"]`); if (again) again.focus();
      fire();
    });
    cal.addEventListener('change', (e) => {
      if (e.target.matches('[data-mo]')) { view.m = Number(e.target.value); drawCal(); cal.querySelector('[data-mo]').focus(); }
      if (e.target.matches('[data-yr]')) { const yv = Number(e.target.value); if (yv >= 1900 && yv <= 2999) { view.y = yv; drawCal(); cal.querySelector('[data-yr]').focus(); } }
    });
    cal.addEventListener('keydown', (e) => {
      const day = e.target.closest('[data-day]');
      if (e.key === 'Escape') { e.stopPropagation(); toggleCal(false); calBtn.focus(); return; }
      if (!day) return;
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
      if (!step) return;
      e.preventDefault();
      const next = shift(day.dataset.day, step); const [y, m] = next.split('-').map(Number);
      if (y !== view.y || m !== view.m) { view = { y, m }; drawCal(); }
      const b = cal.querySelector(`[data-day="${next}"]`); if (b) { for (const x of cal.querySelectorAll('[data-day]')) x.tabIndex = -1; b.tabIndex = 0; b.focus(); }
    });
    function toggleCal(open) {
      cal.hidden = !open; calBtn.setAttribute('aria-expanded', String(open));
      if (open) { picking = 'from'; drawCal(); const f = cal.querySelector('[data-day][tabindex="0"]'); if (f) f.focus(); }
    }
    calBtn.addEventListener('click', () => toggleCal(cal.hidden));

    return {
      el,
      get: () => ({ from: st.bad.from ? '' : st.from, to: st.bad.to ? '' : st.to }),
      set,
      valid: () => !st.bad.from && !st.bad.to,
      active: () => !!((st.from && !st.bad.from) || (st.to && !st.bad.to)),
      test: (value) => inRange(value, st.bad.from ? '' : st.from, st.bad.to ? '' : st.to),
      describe: () => {
        const f = st.bad.from ? '' : st.from, t = st.bad.to ? '' : st.to;
        return !f && !t ? 'any date' : f && t ? (f === t ? 'on ' + f : f + ' to ' + t) : f ? 'from ' + f : 'up to ' + t;
      }
    };
  }

  root.MVLDates = { parse, presets, inRange, localDay, localeOrder, shift, range };
})(typeof window !== 'undefined' ? window : globalThis);
