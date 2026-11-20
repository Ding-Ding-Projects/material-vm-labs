'use strict';
// MVLChart: a small live line and area chart in the Liveline style. The line eases toward each new
// state, the newest point carries a pulsing live dot with its momentum (shown as an arrow and in
// words, never by colour alone), the y range and badges ease together, and a crosshair scrubs by
// pointer or arrow keys. Under reduced motion it snaps and never pulses. It only ever draws the
// points it is given: nothing is interpolated into the data and nothing is invented to look alive.
// The pure scaling helpers are exported for the node tests (module.exports) and as MVLChart.math.
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MVLChart = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  // ---------------------------------------------------------------------------------------------
  // Pure math.
  // ---------------------------------------------------------------------------------------------
  const lerp = (a, b, f) => a + (b - a) * f;
  // Frame-rate independent easing: about 8% of the remaining distance per 60 Hz frame.
  const easeFactor = (dtMs, perFrame) => 1 - Math.pow(1 - (perFrame == null ? 0.08 : perFrame), Math.max(0, dtMs) / (1000 / 60));
  function scale(d0, d1, r0, r1) {
    const span = d1 - d0;
    return (v) => (span === 0 ? (r0 + r1) / 2 : r0 + ((v - d0) / span) * (r1 - r0));
  }
  function niceNum(x, round) {
    if (!(x > 0)) return 1;
    const e = Math.floor(Math.log10(x)), f = x / Math.pow(10, e);
    let nf;
    if (round) nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
    else nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
    return nf * Math.pow(10, e);
  }
  // Nice y ticks that cover [min, max]. Counts are often small whole numbers, so integer data keeps
  // an integer step. A flat series gets a range around its value instead of a zero-height axis.
  function niceTicks(min, max, count, opts) {
    count = Math.max(2, count || 5);
    const integer = !!(opts && opts.integer);
    if (!Number.isFinite(min) || !Number.isFinite(max)) { min = 0; max = 1; }
    if (min > max) { const t = min; min = max; max = t; }
    if (min === max) { const pad = Math.abs(min) > 0 ? Math.abs(min) * 0.5 : 1; min -= pad; max += pad; if (opts && opts.zero && min < 0 && max > 0 && (min + pad) >= 0) min = 0; }
    let step = niceNum(niceNum(max - min, false) / (count - 1), true);
    if (integer) step = Math.max(1, Math.round(step));
    const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.abs(v) < step / 1e9 ? 0 : +v.toFixed(10));
    return { min: lo, max: hi, step, ticks };
  }
  const TIME_STEPS = [1e3, 5e3, 15e3, 30e3, 60e3, 2 * 60e3, 5 * 60e3, 10 * 60e3, 15 * 60e3, 30 * 60e3, 3600e3, 2 * 3600e3, 3 * 3600e3, 6 * 3600e3, 12 * 3600e3, 86400e3, 2 * 86400e3, 7 * 86400e3, 14 * 86400e3, 30 * 86400e3, 91 * 86400e3, 182 * 86400e3, 365 * 86400e3];
  function timeTicks(t0, t1, count) {
    count = Math.max(2, count || 5);
    const span = Math.max(1, t1 - t0);
    const step = TIME_STEPS.find((s) => span / s <= count) || TIME_STEPS[TIME_STEPS.length - 1];
    const out = [];
    for (let v = Math.ceil(t0 / step) * step; v <= t1; v += step) out.push(v);
    return { step, ticks: out };
  }
  function nearestIndex(points, t) {
    if (!points || !points.length) return -1;
    let lo = 0, hi = points.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (points[mid].t < t) lo = mid; else hi = mid; }
    return Math.abs(points[lo].t - t) <= Math.abs(points[hi].t - t) ? lo : hi;
  }
  function momentum(points) {
    if (!points || points.length < 2) return 'flat';
    const a = points[points.length - 2].v, b = points[points.length - 1].v;
    return b > a ? 'up' : b < a ? 'down' : 'flat';
  }
  function extent(seriesList, t0, t1) {
    let min = Infinity, max = -Infinity;
    for (const pts of seriesList) for (const p of pts) if ((t0 == null || p.t >= t0) && (t1 == null || p.t <= t1)) { if (p.v < min) min = p.v; if (p.v > max) max = p.v; }
    return min === Infinity ? null : { min, max };
  }
  // Monotone cubic path through pixel points: smooth, and it never overshoots the data.
  function smoothPath(xy) {
    const n = xy.length;
    if (!n) return '';
    if (n === 1) return `M${xy[0][0]},${xy[0][1]}`;
    if (n === 2) return `M${xy[0][0]},${xy[0][1]}L${xy[1][0]},${xy[1][1]}`;
    const dx = [], dy = [], m = [];
    for (let i = 0; i < n - 1; i++) { dx.push(xy[i + 1][0] - xy[i][0]); dy.push(xy[i + 1][1] - xy[i][1]); m.push(dx[i] === 0 ? 0 : dy[i] / dx[i]); }
    const tan = [m[0]];
    for (let i = 1; i < n - 1; i++) tan.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
    tan.push(m[n - 2]);
    for (let i = 0; i < n - 1; i++) {
      if (m[i] === 0) { tan[i] = 0; tan[i + 1] = 0; continue; }
      const a = tan[i] / m[i], b = tan[i + 1] / m[i], s = a * a + b * b;
      if (s > 9) { const k = 3 / Math.sqrt(s); tan[i] = k * a * m[i]; tan[i + 1] = k * b * m[i]; }
    }
    const f = (v) => +v.toFixed(2);
    let d = `M${f(xy[0][0])},${f(xy[0][1])}`;
    for (let i = 0; i < n - 1; i++) {
      const h = dx[i] / 3;
      d += `C${f(xy[i][0] + h)},${f(xy[i][1] + tan[i] * h)} ${f(xy[i + 1][0] - h)},${f(xy[i + 1][1] - tan[i + 1] * h)} ${f(xy[i + 1][0])},${f(xy[i + 1][1])}`;
    }
    return d;
  }
  // Index runs [start, end] split wherever two neighbouring points are more than gapMs apart.
  function segments(points, gapMs) {
    const out = []; let start = 0;
    for (let i = 1; i < points.length; i++) if (gapMs && points[i].t - points[i - 1].t > gapMs) { out.push([start, i - 1]); start = i; }
    if (points.length) out.push([start, points.length - 1]);
    return out;
  }
  const math = { segments, lerp, easeFactor, scale, niceNum, niceTicks, timeTicks, nearestIndex, momentum, extent, smoothPath };
  if (typeof document === 'undefined') return { math };

  // ---------------------------------------------------------------------------------------------
  // Component.
  // ---------------------------------------------------------------------------------------------
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const NS = 'http://www.w3.org/2000/svg';
  let uid = 0;
  function reduced() {
    try {
      if (root.MVLMotion) { if (root.MVLMotion.reduced()) return true; const st = root.MVLMotion.get(); if (st && st.master === false) return true; }
      else if (root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
      return document.documentElement.dataset.motion === 'off' || document.documentElement.dataset.stimulation === 'low';
    } catch { return false; }
  }
  const timeFmt = (t, withSeconds) => new Date(t).toLocaleTimeString(undefined, withSeconds ? { hour: '2-digit', minute: '2-digit', second: '2-digit' } : { hour: '2-digit', minute: '2-digit' });
  const dateFmt = (t) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const ARROW = { up: 'M6 1 11 9H1z', down: 'M6 11 1 3h10z', flat: 'M1 5h10v2H1z' };

  function create(host, opts) {
    const o = Object.assign({ height: 240, live: true, windows: null, windowMs: null, unit: '', integer: false, format: null, emptyText: 'No data yet.' }, opts || {});
    const id = 'mvlc' + (++uid);
    const fmt = o.format || ((v) => (o.integer ? String(Math.round(v)) : (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1))) + (o.unit ? ' ' + o.unit : ''));
    const series = o.series.map((s) => ({ id: s.id, label: s.label, color: s.color, on: s.on !== false, points: [], shownLast: null }));
    let status = { state: 'loading', text: 'Loading' };
    let windowMs = o.windowMs;
    let disp = null; // eased view: { ymin, ymax }
    let scrub = -1; // index into scrubTimes
    let raf = 0, ticker = 0, lastFrame = 0;
    let width = 600;

    const el = document.createElement('section');
    el.className = 'mvlc';
    el.setAttribute('aria-label', o.title);
    el.innerHTML = `<header class="mvlc-head"><h3 class="mvlc-title">${esc(o.title)}</h3><span class="mvlc-state" data-dt-state role="status"></span></header>
<div class="mvlc-controls"><div class="seg sm mvlc-series" role="group" aria-label="Series to show"></div>${o.windows ? `<div class="seg sm mvlc-windows" role="group" aria-label="Time window">${o.windows.map((w) => `<button type="button" data-dt-win="${w.ms == null ? 'all' : w.ms}" aria-pressed="${w.ms === windowMs}">${esc(w.label)}</button>`).join('')}</div>` : ''}</div>
<div class="mvlc-plot" tabindex="0" role="group" aria-roledescription="chart" aria-label="${esc(o.title)}. Use the left and right arrow keys to read each point." aria-describedby="${id}-sum"><svg class="mvlc-svg" xmlns="${NS}" aria-hidden="true" focusable="false"></svg><div class="mvlc-tip" hidden></div><p class="mvlc-overlay" hidden></p></div>
<p class="mvlc-readout small" aria-live="polite"></p>
<p class="mvlc-sum small" id="${id}-sum"></p>
<details class="mvlc-table"><summary>Show the data as a table</summary><div class="mvlc-tablewrap"></div></details>`;
    host.append(el);
    const svg = el.querySelector('svg'), plot = el.querySelector('.mvlc-plot'), tip = el.querySelector('.mvlc-tip'), overlay = el.querySelector('.mvlc-overlay');
    const stateEl = el.querySelector('[data-dt-state]'), readout = el.querySelector('.mvlc-readout'), sumEl = el.querySelector('.mvlc-sum'), tableWrap = el.querySelector('.mvlc-tablewrap');

    function renderChips() {
      const box = el.querySelector('.mvlc-series');
      box.innerHTML = series.map((s) => {
        const last = s.points[s.points.length - 1];
        const mo = momentum(s.points);
        return `<button type="button" data-dt-series="${esc(s.id)}" aria-pressed="${s.on}"><span class="mvlc-key" style="background:${s.color}" aria-hidden="true"></span>${esc(s.label)}${last ? `<span class="n">${esc(fmt(last.v))}<span class="mvlc-vh"> ${mo}</span></span>` : ''}</button>`;
      }).join('');
      box.hidden = series.length < 2 && !series.some((s) => s.points.length);
    }
    el.addEventListener('click', (e) => {
      const sb = e.target.closest('[data-dt-series]');
      if (sb) { const s = series.find((x) => x.id === sb.dataset.dtSeries); if (s) { if (s.on && series.filter((x) => x.on).length === 1) return; s.on = !s.on; renderChips(); draw(true); summarize(); } }
      const wb = e.target.closest('[data-dt-win]');
      if (wb) { windowMs = wb.dataset.dtWin === 'all' ? null : Number(wb.dataset.dtWin); for (const b of el.querySelectorAll('[data-dt-win]')) b.setAttribute('aria-pressed', String(b === wb)); scrub = -1; draw(true); summarize(); }
    });

    const visible = () => series.filter((s) => s.on);
    function domainX(now) {
      const all = visible().flatMap((s) => s.points);
      if (!all.length) return null;
      let t1 = Math.max(...all.map((p) => p.t));
      if (o.live) t1 = Math.max(t1, now);
      let t0 = windowMs ? t1 - windowMs : Math.min(...all.map((p) => p.t));
      if (t1 - t0 < 1000) t0 = t1 - (o.live ? 60e3 : 3600e3);
      return [t0, t1];
    }
    function scrubTimes(dx) {
      const set = new Set();
      for (const s of visible()) for (const p of s.points) if (p.t >= dx[0] && p.t <= dx[1]) set.add(p.t);
      return [...set].sort((a, b) => a - b);
    }

    function draw(snap, dt) {
      const r = plot.getBoundingClientRect();
      if (r.width > 0) width = Math.round(r.width);
      const H = o.height, W = width;
      const pad = { l: 44, r: 76, t: 26, b: 30 };
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      svg.setAttribute('width', W); svg.setAttribute('height', H);
      const now = Date.now();
      const dx = domainX(now);
      const hasData = !!dx;
      overlay.hidden = hasData && status.state !== 'error';
      if (!hasData || status.state === 'error') {
        overlay.textContent = status.state === 'loading' ? 'Loading' : status.state === 'error' ? status.text : o.emptyText;
        if (!hasData) { svg.innerHTML = ''; return; }
      }
      const ext = extent(visible().map((s) => s.points), dx[0], dx[1]) || { min: 0, max: 1 };
      const nt = niceTicks(Math.min(ext.min, o.zero ? 0 : ext.min), ext.max, 5, { integer: o.integer, zero: o.zero });
      const target = { ymin: nt.min, ymax: nt.max };
      const instant = snap || reduced() || !disp;
      if (instant) disp = Object.assign({}, target);
      else { const f = easeFactor(dt || 16.7); disp.ymin = lerp(disp.ymin, target.ymin, f); disp.ymax = lerp(disp.ymax, target.ymax, f); if (Math.abs(disp.ymax - target.ymax) < 1e-3 && Math.abs(disp.ymin - target.ymin) < 1e-3) Object.assign(disp, target); }
      const sx = scale(dx[0], dx[1], pad.l, W - pad.r), sy = scale(disp.ymin, disp.ymax, H - pad.b, pad.t);
      const parts = [];
      parts.push(`<defs>${visible().map((s, i) => `<linearGradient id="${id}-g${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:${s.color};stop-opacity:.28"/><stop offset="1" style="stop-color:${s.color};stop-opacity:0"/></linearGradient>`).join('')}<clipPath id="${id}-clip"><rect x="${pad.l}" y="0" width="${W - pad.l - pad.r + 8}" height="${H}"/></clipPath></defs>`);
      // Quiet grid and y labels (labels follow the eased range, so they glide together).
      for (const v of nt.ticks) {
        const y = sy(v); if (y < pad.t - 1 || y > H - pad.b + 1) continue;
        parts.push(`<line class="mvlc-grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/><text class="mvlc-axis" x="${pad.l - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end">${esc(o.integer ? String(v) : fmt(v).replace(' ' + o.unit, ''))}</text>`);
      }
      const tt = timeTicks(dx[0], dx[1], Math.max(2, Math.floor((W - pad.l - pad.r) / 90)));
      const multiDay = dx[1] - dx[0] > 36 * 3600e3;
      for (const t of tt.ticks) {
        const x = sx(t);
        parts.push(`<text class="mvlc-axis" x="${x.toFixed(1)}" y="${H - 8}" text-anchor="middle">${esc(multiDay ? dateFmt(t) : timeFmt(t, tt.step < 60e3))}</text>`);
      }
      if (o.yLabel) parts.push(`<text class="mvlc-axis" x="8" y="14">${esc(o.yLabel)}</text>`);
      if (o.live) parts.push(`<line class="mvlc-now" x1="${W - pad.r}" x2="${W - pad.r}" y1="${pad.t}" y2="${H - pad.b}"/><text class="mvlc-axis" x="${W - pad.r}" y="14" text-anchor="middle">now</text>`);
      // Series: area and line. The newest point's height eases from where it was drawn last.
      const badges = [];
      visible().forEach((s, i) => {
        const pts = s.points.filter((p) => p.t >= dx[0] - (o.live ? 0 : 0) && p.t <= dx[1]);
        // Keep the point just before the window so the line enters from the edge.
        const before = s.points.filter((p) => p.t < dx[0]).pop();
        const use = before ? [before].concat(pts) : pts;
        if (!use.length) return;
        const last = use[use.length - 1];
        if (s.shownLast == null || instant) s.shownLast = last.v;
        else s.shownLast = lerp(s.shownLast, last.v, easeFactor(dt || 16.7));
        if (Math.abs(s.shownLast - last.v) < 1e-3) s.shownLast = last.v;
        const xy = use.map((p, j) => [sx(p.t), sy(j === use.length - 1 ? s.shownLast : p.v)]);
        const base = H - pad.b;
        // A gap longer than gapMs (a pause or failed reads) breaks the line instead of bridging it.
        for (const run of segments(use, o.gapMs)) {
          const seg = xy.slice(run[0], run[1] + 1);
          const line = smoothPath(seg);
          parts.push(`<g clip-path="url(#${id}-clip)"><path class="mvlc-area" d="${line}L${seg[seg.length - 1][0].toFixed(2)},${base}L${seg[0][0].toFixed(2)},${base}Z" style="fill:url(#${id}-g${i})"/><path class="mvlc-line" d="${line}" style="stroke:${s.color}"/></g>`);
        }
        for (const p of use) if (p !== last && p.t >= dx[0]) parts.push(`<circle class="mvlc-pt" cx="${sx(p.t).toFixed(1)}" cy="${sy(p.v).toFixed(1)}" r="2.5" style="fill:${s.color}"/>`);
        const lx = xy[xy.length - 1][0], ly = xy[xy.length - 1][1];
        const mo = momentum(s.points);
        parts.push(`<circle class="mvlc-dot${o.live && !reduced() && status.state === 'ok' ? ' pulse' : ''}" cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="9" style="fill:${s.color}"/><circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="4.5" class="mvlc-dotcore" style="fill:${s.color}"/>`);
        badges.push({ y: ly, s, v: last.v, mo });
      });
      // Value badges at the right edge, nudged apart so they never overlap.
      badges.sort((a, b) => a.y - b.y);
      for (let k = 1; k < badges.length; k++) if (badges[k].y - badges[k - 1].y < 24) badges[k].y = badges[k - 1].y + 24;
      for (const b of badges) {
        const by = Math.min(H - pad.b, Math.max(pad.t + 10, b.y));
        parts.push(`<g class="mvlc-badge" transform="translate(${W - pad.r + 8},${(by - 11).toFixed(1)})"><rect width="66" height="22" rx="11" style="fill:${b.s.color}"/><path transform="translate(8,5) scale(1)" d="${ARROW[b.mo]}" class="mvlc-badge-ink"/><text x="40" y="15" text-anchor="middle" class="mvlc-badge-ink">${esc(o.integer ? String(b.v) : fmt(b.v).replace(' ' + o.unit, ''))}</text></g>`);
      }
      // Crosshair.
      const times = scrubTimes(dx);
      if (scrub >= times.length) scrub = times.length - 1;
      if (scrub >= 0) {
        const t = times[scrub], x = sx(t);
        parts.push(`<line class="mvlc-cross" x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${pad.t}" y2="${H - pad.b}"/>`);
        const rows = [];
        for (const s of visible()) { const p = s.points.find((q) => q.t === t); if (p) { rows.push([s, p]); parts.push(`<circle class="mvlc-hit" cx="${x.toFixed(1)}" cy="${sy(p.v).toFixed(1)}" r="5" style="stroke:${s.color}"/>`); } }
        tip.hidden = false;
        tip.innerHTML = `<strong>${esc(multiDay ? dateFmt(t) + ' ' + timeFmt(t) : timeFmt(t, true))}</strong>` + rows.map(([s, p]) => `<span><i style="background:${s.color}" aria-hidden="true"></i>${esc(s.label)}: ${esc(fmt(p.v))}</span>`).join('');
        const tw = tip.offsetWidth || 160;
        tip.style.left = Math.max(4, Math.min(W - tw - 4, x + 12)) + 'px';
        tip.style.top = pad.t + 'px';
      } else tip.hidden = true;
      svg.innerHTML = parts.join('');
    }

    function summarize() {
      const vis = visible();
      const all = vis.flatMap((s) => s.points);
      if (!all.length) { sumEl.textContent = status.state === 'loading' ? 'Loading.' : status.state === 'error' ? status.text : o.emptyText; tableWrap.innerHTML = ''; return; }
      const t0 = Math.min(...all.map((p) => p.t)), t1 = Math.max(...all.map((p) => p.t));
      const latest = vis.filter((s) => s.points.length).map((s) => { const p = s.points[s.points.length - 1]; const mo = momentum(s.points); return `${s.label} ${fmt(p.v)}${s.points.length > 1 ? ` (${mo === 'flat' ? 'unchanged' : mo === 'up' ? 'up' : 'down'})` : ''}`; });
      const n = Math.max(...vis.map((s) => s.points.length));
      const span = t1 > t0 ? ` from ${multiDayText(t0, t1)}` : '';
      sumEl.textContent = `Latest, ${timeOrDate(t1, t1 - t0)}: ${latest.join(', ')}. ${n} ${n === 1 ? 'point' : 'points'}${span}.`;
      // Data table for the visible window.
      const times = [...new Set(all.map((p) => p.t))].sort((a, b) => b - a).slice(0, 200);
      tableWrap.innerHTML = `<table class="mvlc-tbl"><thead><tr><th scope="col">Time</th>${vis.map((s) => `<th scope="col">${esc(s.label)}</th>`).join('')}</tr></thead><tbody>${times.map((t) => `<tr><th scope="row">${esc(timeOrDate(t, t1 - t0))}</th>${vis.map((s) => { const p = s.points.find((q) => q.t === t); return `<td>${p ? esc(fmt(p.v)) : ''}</td>`; }).join('')}</tr>`).join('')}</tbody></table>${all.length > 200 ? '<p class="small">The newest 200 rows are shown.</p>' : ''}`;
    }
    const timeOrDate = (t, span) => (span > 36 * 3600e3 ? dateFmt(t) + ' ' + timeFmt(t) : timeFmt(t, true));
    const multiDayText = (t0, t1) => `${timeOrDate(t0, t1 - t0)} to ${timeOrDate(t1, t1 - t0)}`;

    function announceScrub() {
      const dx = domainX(Date.now()); if (!dx) return;
      const times = scrubTimes(dx);
      if (scrub < 0 || !times.length) { readout.textContent = ''; return; }
      const t = times[scrub];
      const vals = visible().map((s) => { const p = s.points.find((q) => q.t === t); return p ? `${s.label} ${fmt(p.v)}` : null; }).filter(Boolean);
      readout.textContent = `Point ${scrub + 1} of ${times.length}, ${timeOrDate(t, dx[1] - dx[0])}: ${vals.join(', ')}`;
    }
    plot.addEventListener('keydown', (e) => {
      const dx = domainX(Date.now()); if (!dx) return;
      const n = scrubTimes(dx).length; if (!n) return;
      if (e.key === 'ArrowLeft') scrub = scrub < 0 ? n - 1 : Math.max(0, scrub - 1);
      else if (e.key === 'ArrowRight') scrub = scrub < 0 ? n - 1 : Math.min(n - 1, scrub + 1);
      else if (e.key === 'Home') scrub = 0;
      else if (e.key === 'End') scrub = n - 1;
      else if (e.key === 'Escape') scrub = -1;
      else return;
      e.preventDefault(); draw(true); announceScrub();
    });
    plot.addEventListener('pointermove', (e) => {
      const dx = domainX(Date.now()); if (!dx) return;
      const times = scrubTimes(dx); if (!times.length) return;
      const r = plot.getBoundingClientRect();
      const t = scale(44, width - 76, dx[0], dx[1])(e.clientX - r.left);
      scrub = nearestIndex(times.map((x) => ({ t: x })), t);
      draw(true); announceScrub();
    });
    plot.addEventListener('pointerleave', () => { scrub = -1; draw(true); readout.textContent = ''; });
    plot.addEventListener('blur', () => { scrub = -1; draw(true); readout.textContent = ''; });

    function loop(ts) {
      raf = 0;
      if (!el.isConnected) return;
      const dt = lastFrame ? ts - lastFrame : 16.7; lastFrame = ts;
      draw(false, dt);
      if (o.live && !reduced()) raf = requestAnimationFrame(loop);
    }
    function kick() {
      if (reduced() || !o.live) { lastFrame = 0; draw(true); return; }
      if (!raf) raf = requestAnimationFrame(loop);
    }
    // Under reduced motion a live chart still advances its time axis once per second, without easing.
    if (o.live) ticker = setInterval(() => { if (reduced() && el.isConnected) draw(true); else kick(); }, 1000);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => draw(true)) : null;
    if (ro) ro.observe(plot);

    function setStatus(st) {
      status = Object.assign({ text: '' }, st);
      const label = { loading: 'Loading', ok: o.live ? 'Live' : '', paused: 'Paused', stale: 'Stale', error: 'Unavailable', empty: '' }[status.state] || '';
      stateEl.className = 'mvlc-state ' + status.state;
      stateEl.textContent = status.text && status.state !== 'ok' ? `${label}: ${status.text}` : label;
      stateEl.hidden = !stateEl.textContent;
      renderChips(); summarize(); kick(); draw(true);
    }
    renderChips(); setStatus(status);
    return {
      el,
      setSeries(sid, points) {
        const s = series.find((x) => x.id === sid); if (!s) return;
        s.points = (points || []).filter((p) => p && Number.isFinite(p.t) && Number.isFinite(p.v)).slice().sort((a, b) => a.t - b.t);
        renderChips(); summarize(); kick();
      },
      setStatus,
      setWindow(ms) { windowMs = ms; draw(true); },
      redraw() { draw(true); },
      destroy() { if (raf) cancelAnimationFrame(raf); clearInterval(ticker); if (ro) ro.disconnect(); el.remove(); }
    };
  }

  return { create, math };
});
