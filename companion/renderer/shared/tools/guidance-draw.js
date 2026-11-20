'use strict';
// Drawing and annotation, built natively in the manager's own Material 3 chrome after Drawesome's
// toolset. Seven pens with their own width behaviour (Pencil, Pen and Brush thin as the stroke speeds
// up; Fineliner and Highlighter keep one width; Fountain Pen varies with direction), an area Eraser
// that removes only the part of a stroke it touches, Shift to lock a stroke to the nearest of eight
// directions, colours, sizes, undo and redo that survive a restart, a guarded clear, saved versions,
// and SVG and PNG (1x to 3x) exports drawn by the same code as the screen. One toolbar changes shape:
// pens, palette, sliders or a minimised disc. Strokes stay on this device.
(function () {
  const W = 1000, H = 625; // logical board; the screen and both exports scale this
  const KEY = 'mvl-draw-v1', PREFS = 'mvl-draw-prefs', VERS = 'mvl-draw-versions';
  const MAX_PAST = 40, MAX_VERS = 10;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const PENS = [
    { id: 'pencil', name: 'Pencil', key: '1', alpha: 0.85, note: 'thins as you speed up', width: (b, v) => b * 0.7 * clamp(1 - v * 0.6, 0.35, 1) },
    { id: 'pen', name: 'Pen', key: '2', alpha: 1, note: 'thins a little as you speed up', width: (b, v) => b * clamp(1 - v * 0.4, 0.45, 1) },
    { id: 'fineliner', name: 'Fineliner', key: '3', alpha: 1, note: 'one constant width', width: (b) => b * 0.55 },
    { id: 'marker', name: 'Marker', key: '4', alpha: 0.92, note: 'broad, constant width', width: (b) => b * 1.8 },
    { id: 'highlighter', name: 'Highlighter', key: '5', alpha: 0.35, note: 'wide, see-through, constant width', width: (b) => b * 3.2 },
    { id: 'brush', name: 'Brush', key: '6', alpha: 0.95, note: 'swells when slow, tapers when fast', width: (b, v) => b * 2.2 * clamp(1 - v * 0.9, 0.18, 1) },
    { id: 'fountain', name: 'Fountain Pen', key: '7', alpha: 1, note: 'width follows the direction of the nib', width: (b, v, a) => b * (0.3 + 1.1 * Math.abs(Math.sin(a - Math.PI / 4))) }
  ];
  const ERASER = { id: 'eraser', name: 'Eraser', key: 'E' };
  const COLOURS = ['#1d1b20', '#b3261e', '#e8590c', '#f2c94c', '#2e7d32', '#00838f', '#1e63d6', '#6750a4', '#c2185b', '#ffffff'];
  const ICON = {
    pen: 'M4 20l4-1 11-11-3-3L5 16zM14 6l3 3', eraser: 'M8 20h12M5 15l9-9 5 5-9 9H8z', palette: 'M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.5-1.6 0-1.4 1-1.9 2.2-1.9H18a3 3 0 0 0 3-3C21 7.9 17 3 12 3zM7.5 12h.01M9.5 8h.01M14.5 8h.01',
    size: 'M4 7h10M4 17h6M17 4v6M14 7h6M13 14v6M10 17h6', undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-2', redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h2',
    min: 'M6 12h12', back: 'M15 6l-6 6 6 6', trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3', save: 'M5 3h11l3 3v15H5zM8 3v6h7M8 21v-7h8v7'
  };
  const svgIcon = (d) => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"></path></svg>`;
  const read = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };

  // ---------- Geometry (shared by the screen and both exports) ----------
  // Turns sampled points into per-point widths for a pen.
  function widths(pen, size, pts) {
    const p = PENS.find((x) => x.id === pen) || PENS[1];
    let v = 0;
    return pts.map((pt, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const dt = Math.max(1, (b[2] || 0) - (a[2] || 0)), dist = Math.hypot(b[0] - a[0], b[1] - a[1]);
      v = v * 0.7 + (dist / dt) * 0.3; // smoothed speed, board units per ms
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const pressure = pt[3] ? 0.5 + pt[3] : 1;
      return Math.max(0.6, p.width(size, v, ang) * pressure);
    });
  }
  // Outline polygon of a variable-width stroke with round ends, as [x, y] pairs.
  function outline(pts, ws) {
    if (pts.length === 1) { const r = ws[0] / 2, out = []; for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; out.push([pts[0][0] + Math.cos(a) * r, pts[0][1] + Math.sin(a) * r]); } return out; }
    const left = [], right = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let nx = -(b[1] - a[1]), ny = b[0] - a[0]; const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
      const r = ws[i] / 2;
      left.push([pts[i][0] + nx * r, pts[i][1] + ny * r]); right.push([pts[i][0] - nx * r, pts[i][1] - ny * r]);
    }
    const cap = (c, from, r, steps) => { const out = []; for (let k = 1; k < steps; k++) { const a = from + (k / steps) * Math.PI; out.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]); } return out; };
    const e = pts[pts.length - 1], e0 = pts[pts.length - 2], s = pts[0], s1 = pts[1];
    const endA = Math.atan2(e[1] - e0[1], e[0] - e0[0]) + Math.PI / 2, startA = Math.atan2(s[1] - s1[1], s[0] - s1[0]) + Math.PI / 2;
    return left.concat(cap(e, endA - Math.PI, ws[ws.length - 1] / 2, 8).reverse(), right.reverse(), cap(s, startA - Math.PI, ws[0] / 2, 8).reverse());
  }
  const pathD = (poly) => poly.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join('') + 'Z';
  const strokeAlpha = (s) => (PENS.find((p) => p.id === s.pen) || PENS[1]).alpha;

  // Removes the parts of strokes within r of the eraser path; splits a stroke where a middle part goes.
  function erase(strokes, path, r) {
    const out = []; let changed = false;
    const hit = (pt) => path.some((q, i) => {
      const a = path[Math.max(0, i - 1)];
      const dx = q[0] - a[0], dy = q[1] - a[1], len = dx * dx + dy * dy;
      const t = len ? clamp(((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / len, 0, 1) : 0;
      return Math.hypot(pt[0] - (a[0] + t * dx), pt[1] - (a[1] + t * dy)) <= r;
    });
    for (const s of strokes) {
      if (!s.pts.some(hit)) { out.push(s); continue; }
      changed = true;
      let run = [], runW = [], part = 0;
      const flush = () => { if (run.length) out.push(Object.assign({}, s, { id: s.id + '.' + (part++), pts: run, w: runW })); run = []; runW = []; };
      s.pts.forEach((pt, i) => { if (hit(pt)) flush(); else { run.push(pt); runW.push(s.w[i]); } });
      flush();
    }
    return { strokes: out, changed };
  }
  // Locks a stroke to the nearest of eight directions from its first point.
  function lockLine(start, end, size) {
    const ang = Math.round(Math.atan2(end[1] - start[1], end[0] - start[0]) / (Math.PI / 4)) * (Math.PI / 4);
    const len = Math.hypot(end[0] - start[0], end[1] - start[1]);
    const n = Math.max(2, Math.ceil(len / Math.max(1.5, size / 3)));
    const dur = Math.max(1, (end[2] || 0) - (start[2] || 0));
    const pts = [];
    for (let k = 0; k <= n; k++) { const f = k / n; pts.push([start[0] + Math.cos(ang) * len * f, start[1] + Math.sin(ang) * len * f, (start[2] || 0) + dur * f, end[3] || 0]); }
    return pts;
  }

  function boardColour() { const cs = getComputedStyle(document.documentElement); return (cs.getPropertyValue('--md-sys-color-surface-container-lowest') || '#ffffff').trim() || '#ffffff'; }
  // Draws everything onto a 2D context at a scale (board units to pixels).
  function drawScene(g, scale, doc, bgImg, current) {
    g.save(); g.setTransform(scale, 0, 0, scale, 0, 0);
    g.fillStyle = doc.bg; g.fillRect(0, 0, W, H);
    if (bgImg && bgImg.complete && bgImg.naturalWidth) { const f = Math.min(W / bgImg.naturalWidth, H / bgImg.naturalHeight); const w = bgImg.naturalWidth * f, h = bgImg.naturalHeight * f; g.drawImage(bgImg, (W - w) / 2, (H - h) / 2, w, h); }
    for (const s of doc.strokes.concat(current ? [current] : [])) {
      if (!s.pts.length) continue;
      const poly = outline(s.pts, s.w || widths(s.pen, s.size, s.pts));
      g.globalAlpha = strokeAlpha(s); g.fillStyle = s.color;
      g.beginPath(); poly.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); g.fill('nonzero');
    }
    g.restore();
  }
  function toSVG(doc, bgData, cssW, cssH) {
    const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(cssW)}" height="${Math.round(cssH)}" viewBox="0 0 ${W} ${H}">`, `<rect width="${W}" height="${H}" fill="${esc(doc.bg)}"/>`];
    if (bgData && doc.bgSize) { const f = Math.min(W / doc.bgSize[0], H / doc.bgSize[1]); const w = doc.bgSize[0] * f, h = doc.bgSize[1] * f; parts.push(`<image href="${esc(bgData)}" x="${((W - w) / 2).toFixed(2)}" y="${((H - h) / 2).toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}"/>`); }
    for (const s of doc.strokes) parts.push(`<path d="${pathD(outline(s.pts, s.w))}" fill="${esc(s.color)}" fill-opacity="${strokeAlpha(s)}" data-pen="${esc(s.pen)}"/>`);
    parts.push('</svg>');
    return parts.join('\n');
  }

  // ---------- Tool ----------
  let disposeMenu = null, keyHandler = null, roHandle = null;
  function mount(el, ctx) {
    const prefs = Object.assign({ pen: 'pen', color: '#1d1b20', size: 4, eraser: 18, shape: 'pens', dock: 'top', startMin: false, board: 'theme' }, read(PREFS, {}));
    const saved = read(KEY, null);
    const doc = { strokes: saved && Array.isArray(saved.strokes) ? saved.strokes : [], past: saved && Array.isArray(saved.past) ? saved.past : [], future: saved && Array.isArray(saved.future) ? saved.future : [], bgData: saved && saved.bgData || '', bgSize: saved && saved.bgSize || null, bg: '#ffffff' };
    let tool = prefs.pen, shape = prefs.startMin ? 'disc' : 'pens';
    el.innerHTML = `<div class="dw-root" data-dock="${esc(prefs.dock)}">
<div class="dw-bar" role="toolbar" aria-label="Drawing tools" data-shape="${shape}"></div>
<div class="dw-stage"><canvas class="dw-canvas" tabindex="0" role="img" aria-label="Drawing board. With the board focused: arrow keys move the cursor, Space puts the pen down or lifts it, Shift with an arrow moves ten times as far."></canvas></div>
<div class="row dw-foot"><span class="small" data-dw-status role="status" aria-live="polite"></span><span class="grow"></span>
<label class="btn sm dw-file">Draw on an image<input type="file" accept="image/png,image/jpeg,image/webp" data-dw-image hidden></label><button type="button" class="btn sm" data-dw-blank>Blank board</button>
<div class="seg sm" role="group" aria-label="Toolbar place">${['top', 'bottom', 'left'].map((d) => `<button type="button" data-dw-dock="${d}" aria-pressed="${prefs.dock === d}">${d[0].toUpperCase() + d.slice(1)}</button>`).join('')}</div>
<label class="switch-row"><span class="small">Start minimised</span><input type="checkbox" role="switch" data-dw-startmin ${prefs.startMin ? 'checked' : ''}></label></div>
<details class="dw-more"><summary>Export and versions</summary><div class="row"><button type="button" class="btn sm" data-dw-svg aria-keyshortcuts="Control+E" title="Export SVG (Ctrl+E)">Export SVG</button>${[1, 2, 3].map((k) => `<button type="button" class="btn sm" data-dw-png="${k}" ${k === 1 ? 'aria-keyshortcuts="Control+Shift+E" title="Export PNG 1x (Ctrl+Shift+E)"' : `title="Export PNG ${k}x"`}>PNG ${k}x</button>`).join('')}<button type="button" class="btn sm" data-dw-version aria-keyshortcuts="Control+S" title="Save a version (Ctrl+S)">Save a version</button></div><ul class="dw-versions" data-dw-versions></ul></details></div>`;
    const bar = el.querySelector('.dw-bar'), canvas = el.querySelector('canvas'), g = canvas.getContext('2d'), status = el.querySelector('[data-dw-status]');
    const bgImg = new Image();
    const say = (t) => { status.textContent = t; };
    let cssW = 0, cssH = 0, dpr = 1, current = null, erasePath = null, kb = { x: W / 2, y: H / 2, down: false };

    function persist() {
      doc.past = doc.past.slice(-MAX_PAST);
      let ok = write(KEY, { strokes: doc.strokes, past: doc.past, future: doc.future.slice(-MAX_PAST), bgData: doc.bgData, bgSize: doc.bgSize });
      if (!ok) { doc.past = doc.past.slice(-5); ok = write(KEY, { strokes: doc.strokes, past: doc.past, future: [], bgData: doc.bgData.length < 1500000 ? doc.bgData : '', bgSize: doc.bgSize }); if (!ok) say('Not saved: this device\'s storage is full.'); }
    }
    const snapshot = () => JSON.stringify(doc.strokes);
    function commit(before) { doc.past.push(before); doc.future = []; persist(); renderBar(); }
    function undo() { if (!doc.past.length) { say('Nothing to undo.'); return; } doc.future.push(snapshot()); doc.strokes = JSON.parse(doc.past.pop()); persist(); paint(); renderBar(); say('Undone.'); }
    function redo() { if (!doc.future.length) { say('Nothing to redo.'); return; } doc.past.push(snapshot()); doc.strokes = JSON.parse(doc.future.pop()); persist(); paint(); renderBar(); say('Redone.'); }
    function saveVersion(label) { const v = read(VERS, []); v.unshift({ at: new Date().toISOString(), label: label || 'Saved by you', strokes: doc.strokes }); write(VERS, v.slice(0, MAX_VERS)); renderVersions(); }
    async function clearAll() {
      if (!doc.strokes.length) { say('The board is already empty.'); return; }
      const ok = await ctx.confirm({ action: 'Clear the drawing', affected: `Removes all ${doc.strokes.length} saved strokes from the board. A version is saved first, and Undo also brings them back.` });
      if (!ok) { say('Nothing was cleared.'); return; }
      saveVersion('Before clearing'); const b = snapshot(); doc.strokes = []; commit(b); paint(); say('Cleared. Undo or the saved version brings it back.');
    }
    function setTool(id) { tool = id; if (id !== 'eraser') prefs.pen = id; write(PREFS, prefs); renderBar(); const p = PENS.find((x) => x.id === id); say(p ? `${p.name}: ${p.note}.` : 'Eraser: drag over any part of a stroke to remove just that part.'); }
    let morphTimer = null;
    function setShape(s) {
      shape = s; bar.classList.add('dw-morph'); renderBar();
      clearTimeout(morphTimer); morphTimer = setTimeout(() => bar.classList.remove('dw-morph'), 600); // only a shape change animates
      const f = bar.querySelector('button'); if (f) f.focus();
    }

    // ---------- Toolbar: one surface that changes shape ----------
    function renderBar() {
      bar.dataset.shape = shape;
      const active = PENS.find((p) => p.id === tool) || ERASER;
      if (shape === 'disc') {
        bar.innerHTML = `<button type="button" class="dw-disc" data-dw-shape="pens" aria-label="Show the drawing tools. Active: ${esc(active.name)}" title="Show the tools (M)" aria-keyshortcuts="M" style="--dw-ink:${esc(prefs.color)}">${svgIcon(tool === 'eraser' ? ICON.eraser : ICON.pen)}<span class="dw-disc-label">${esc(active.name)}</span></button>`;
        return;
      }
      if (shape === 'palette') {
        bar.innerHTML = `<button type="button" class="iconbtn" data-dw-shape="pens" aria-label="Back to the pens" title="Back (Escape)">${svgIcon(ICON.back)}</button>` + COLOURS.map((c) => `<button type="button" class="dw-swatch" data-dw-colour="${c}" aria-pressed="${c === prefs.color}" aria-label="Colour ${c}" title="Colour ${c}"><i style="background:${c}"></i></button>`).join('') + `<label class="dw-custom" title="Any colour"><span class="small">Any</span><input type="color" data-dw-anycolour value="${esc(prefs.color)}" aria-label="Any colour"></label>`;
        return;
      }
      if (shape === 'sliders') {
        bar.innerHTML = `<button type="button" class="iconbtn" data-dw-shape="pens" aria-label="Back to the pens" title="Back (Escape)">${svgIcon(ICON.back)}</button><label class="dw-slider">Pen size <b data-v="size">${prefs.size}</b><input type="range" min="1" max="20" step="1" value="${prefs.size}" data-dw-size></label><label class="dw-slider">Eraser size <b data-v="eraser">${prefs.eraser}</b><input type="range" min="4" max="80" step="2" value="${prefs.eraser}" data-dw-esize></label>`;
        return;
      }
      bar.innerHTML = PENS.map((p) => `<button type="button" class="dw-tool" data-dw-tool="${p.id}" aria-pressed="${tool === p.id}" aria-keyshortcuts="${p.key}" aria-label="${esc(p.name)}, ${esc(p.note)}" title="${esc(p.name)} (${p.key})"><span class="dw-nib dw-${p.id}" style="--dw-ink:${esc(prefs.color)}"></span><span class="dw-k">${p.key}</span></button>`).join('')
        + `<button type="button" class="dw-tool" data-dw-tool="eraser" aria-pressed="${tool === 'eraser'}" aria-keyshortcuts="E" aria-label="Eraser, removes part of a stroke" title="Eraser (E)">${svgIcon(ICON.eraser)}<span class="dw-k">E</span></button>`
        + '<span class="dw-sep" aria-hidden="true"></span>'
        + `<button type="button" class="iconbtn" data-dw-shape="palette" aria-label="Colours" title="Colours (C)" aria-keyshortcuts="C"><span class="dw-dot" style="background:${esc(prefs.color)}"></span></button>`
        + `<button type="button" class="iconbtn" data-dw-shape="sliders" aria-label="Sizes" title="Sizes (S)" aria-keyshortcuts="S">${svgIcon(ICON.size)}</button>`
        + `<button type="button" class="iconbtn" data-dw-undo aria-label="Undo" title="Undo (Ctrl+Z)" aria-keyshortcuts="Control+Z" ${doc.past.length ? '' : 'disabled'}>${svgIcon(ICON.undo)}</button>`
        + `<button type="button" class="iconbtn" data-dw-redo aria-label="Redo" title="Redo (Ctrl+Y)" aria-keyshortcuts="Control+Y" ${doc.future.length ? '' : 'disabled'}>${svgIcon(ICON.redo)}</button>`
        + `<button type="button" class="iconbtn" data-dw-clear aria-label="Clear the drawing" title="Clear (Shift+Delete)" aria-keyshortcuts="Shift+Delete" ${doc.strokes.length ? '' : 'disabled'}>${svgIcon(ICON.trash)}</button>`
        + `<button type="button" class="iconbtn" data-dw-shape="disc" aria-label="Minimise the toolbar" title="Minimise (M)" aria-keyshortcuts="M">${svgIcon(ICON.min)}</button>`;
    }
    function renderVersions() {
      const v = read(VERS, []);
      el.querySelector('[data-dw-versions]').innerHTML = v.length ? v.map((x, i) => `<li class="row"><span class="small grow">${esc(new Date(x.at).toLocaleString())}, ${esc(x.label)}, ${x.strokes.length} strokes</span><button type="button" class="btn sm" data-dw-restore="${i}">Restore</button></li>`).join('') : '<li class="small">No saved versions yet. Clearing saves one automatically.</li>';
    }

    // ---------- Board ----------
    function resize() {
      const stage = canvas.parentElement; const w = stage.clientWidth || 600;
      cssW = w; cssH = w * H / W; dpr = window.devicePixelRatio || 1;
      canvas.style.width = cssW + 'px'; canvas.style.height = cssH + 'px';
      canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
      paint();
    }
    function paint() {
      doc.bg = prefs.board === 'theme' ? boardColour() : prefs.board;
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height);
      drawScene(g, (cssW / W) * dpr, doc, doc.bgData ? bgImg : null, current);
      if (document.activeElement === canvas && kbMode) { const s = (cssW / W) * dpr; g.save(); g.setTransform(s, 0, 0, s, 0, 0); g.strokeStyle = prefs.color; g.lineWidth = 1.5; g.beginPath(); g.arc(kb.x, kb.y, tool === 'eraser' ? prefs.eraser : 6, 0, Math.PI * 2); g.stroke(); g.restore(); }
    }
    let kbMode = false;
    const toBoard = (e) => { const r = canvas.getBoundingClientRect(); return [clamp((e.clientX - r.left) * W / r.width, 0, W), clamp((e.clientY - r.top) * H / r.height, 0, H), performance.now(), e.pointerType === 'pen' ? (e.pressure || 0.5) : 0]; };
    let raw = null;
    function begin(pt) {
      if (tool === 'eraser') { erasePath = [pt]; current = null; return; }
      raw = [pt]; current = { id: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), pen: tool, color: prefs.color, size: prefs.size, pts: [pt], w: null };
    }
    function extend(pt, shift) {
      if (erasePath) { erasePath.push(pt); const before = doc.strokes; const r = erase(doc.strokes, erasePath.slice(-2), prefs.eraser); if (r.changed) { if (!erasePath.changedFrom) erasePath.changedFrom = JSON.stringify(before); doc.strokes = r.strokes; } paint(); return; }
      if (!current) return;
      const last = raw[raw.length - 1];
      if (Math.hypot(pt[0] - last[0], pt[1] - last[1]) < 1.2) return;
      raw.push(pt);
      current.pts = shift ? lockLine(raw[0], pt, current.size) : raw.slice();
      current.w = widths(current.pen, current.size, current.pts);
      paint();
    }
    function end() {
      if (erasePath) { if (erasePath.changedFrom) { commit(erasePath.changedFrom); say('Erased part of the drawing.'); } erasePath = null; paint(); return; }
      if (!current) return;
      current.w = widths(current.pen, current.size, current.pts);
      const b = snapshot(); doc.strokes.push(current); current = null; raw = null; commit(b); paint();
    }
    canvas.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; canvas.setPointerCapture(e.pointerId); kbMode = false; begin(toBoard(e)); });
    canvas.addEventListener('pointermove', (e) => { if (e.buttons & 1) { const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e]; for (const c of evs) extend(toBoard(c), e.shiftKey); } });
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('focus', () => { kbMode = true; paint(); }); canvas.addEventListener('blur', () => { if (kb.down) { kb.down = false; end(); } paint(); });
    canvas.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 20 : 4, mv = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (mv) { e.preventDefault(); kbMode = true; kb.x = clamp(kb.x + mv[0] * step, 0, W); kb.y = clamp(kb.y + mv[1] * step, 0, H); if (kb.down) extend([kb.x, kb.y, performance.now(), 0], false); else paint(); return; }
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); kb.down = !kb.down; if (kb.down) { begin([kb.x, kb.y, performance.now(), 0]); say('Pen down. Move with the arrow keys; Space lifts it.'); } else { end(); say('Pen lifted.'); } }
    });

    // ---------- Exports ----------
    function download(name, blob) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
    const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    function exportSVG() { download(`drawing-${stamp()}.svg`, new Blob([toSVG(doc, doc.bgData, cssW, cssH)], { type: 'image/svg+xml' })); say('SVG exported: exactly what is on the board.'); }
    function exportPNG(k) {
      const c = document.createElement('canvas'); c.width = Math.round(cssW * k); c.height = Math.round(cssH * k);
      drawScene(c.getContext('2d'), (cssW / W) * k, doc, doc.bgData ? bgImg : null, null);
      c.toBlob((b) => { if (b) { download(`drawing-${stamp()}@${k}x.png`, b); say(`PNG exported at ${k}x (${c.width} by ${c.height} pixels).`); } else say('The PNG could not be made.'); }, 'image/png');
    }

    // ---------- Events ----------
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.dwTool) setTool(b.dataset.dwTool);
      else if (b.dataset.dwShape) setShape(b.dataset.dwShape);
      else if (b.dataset.dwColour) { prefs.color = b.dataset.dwColour; write(PREFS, prefs); if (tool === 'eraser') tool = prefs.pen; renderBar(); say('Colour ' + prefs.color + '.'); }
      else if (b.hasAttribute('data-dw-undo')) undo();
      else if (b.hasAttribute('data-dw-redo')) redo();
      else if (b.hasAttribute('data-dw-clear')) clearAll();
      else if (b.hasAttribute('data-dw-svg')) exportSVG();
      else if (b.dataset.dwPng) exportPNG(Number(b.dataset.dwPng));
      else if (b.hasAttribute('data-dw-version')) { saveVersion(); say('Version saved.'); }
      else if (b.dataset.dwRestore) { const v = read(VERS, [])[Number(b.dataset.dwRestore)]; if (v) { const s = snapshot(); doc.strokes = v.strokes; commit(s); paint(); say('Version restored. Undo goes back.'); } }
      else if (b.dataset.dwDock) { prefs.dock = b.dataset.dwDock; write(PREFS, prefs); el.querySelector('.dw-root').dataset.dock = prefs.dock; el.querySelectorAll('[data-dw-dock]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); resize(); }
      else if (b.hasAttribute('data-dw-blank')) { if (doc.bgData) { doc.bgData = ''; doc.bgSize = null; persist(); paint(); say('Blank board.'); } }
    });
    el.addEventListener('input', (e) => {
      const t = e.target;
      if (t.matches('[data-dw-size]')) { prefs.size = Number(t.value); bar.querySelector('[data-v=size]').textContent = t.value; write(PREFS, prefs); }
      if (t.matches('[data-dw-esize]')) { prefs.eraser = Number(t.value); bar.querySelector('[data-v=eraser]').textContent = t.value; write(PREFS, prefs); }
      if (t.matches('[data-dw-anycolour]')) { prefs.color = t.value; write(PREFS, prefs); }
    });
    el.addEventListener('change', (e) => {
      const t = e.target;
      if (t.matches('[data-dw-startmin]')) { prefs.startMin = t.checked; write(PREFS, prefs); }
      if (t.matches('[data-dw-image]') && t.files && t.files[0]) {
        const f = t.files[0]; if (f.size > 8 * 1024 * 1024) { say('That image is larger than 8 MB.'); return; }
        const fr = new FileReader();
        fr.onload = () => { const img = new Image(); img.onload = () => { doc.bgData = String(fr.result); doc.bgSize = [img.naturalWidth, img.naturalHeight]; bgImg.src = doc.bgData; persist(); say(doc.bgData.length > 1500000 ? 'Drawing on the image. It is large, so it may not be kept after a restart.' : 'Drawing on the image.'); }; img.src = String(fr.result); };
        fr.readAsDataURL(f); t.value = '';
      }
    });
    bgImg.onload = paint;
    if (doc.bgData) bgImg.src = doc.bgData;

    keyHandler = (e) => {
      if (!el.isConnected) return;
      if (e.target.closest && e.target.closest('input:not([type=range]):not([type=checkbox]), textarea')) return;
      const scope = el.closest('.tools-panel') || el; // the tool's own heading counts as inside
      if (!scope.contains(e.target) && e.target !== document.body) return;
      const k = e.key, ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && !e.shiftKey && (k === 'z' || k === 'Z')) { e.preventDefault(); undo(); return; }
      if (ctrl && ((e.shiftKey && (k === 'z' || k === 'Z')) || k === 'y' || k === 'Y')) { e.preventDefault(); redo(); return; }
      if (ctrl && !e.shiftKey && (k === 'e' || k === 'E')) { e.preventDefault(); exportSVG(); return; }
      if (ctrl && e.shiftKey && (k === 'e' || k === 'E')) { e.preventDefault(); exportPNG(1); return; }
      if (ctrl && (k === 's' || k === 'S')) { e.preventDefault(); saveVersion(); say('Version saved.'); return; }
      if (e.shiftKey && k === 'Delete') { e.preventDefault(); clearAll(); return; }
      if (ctrl || e.altKey) return;
      const p = PENS.find((x) => x.key === k); if (p) { setTool(p.id); return; }
      if (k === 'e' || k === 'E') setTool('eraser');
      else if (k === 'c' || k === 'C') setShape('palette');
      else if (k === 's' || k === 'S') setShape('sliders');
      else if (k === 'm' || k === 'M') setShape(shape === 'disc' ? 'pens' : 'disc');
      else if (k === 'Escape' && shape !== 'pens' && shape !== 'disc') { e.stopPropagation(); e.preventDefault(); setShape('pens'); }
    };
    document.addEventListener('keydown', keyHandler, true);
    if (window.MVLContext) {
      disposeMenu = window.MVLContext.register('.dw-root', () => PENS.map((p) => ({ label: p.name, shortcut: p.key, run: () => setTool(p.id) })).concat([
        { label: 'Eraser', shortcut: 'E', run: () => setTool('eraser') }, { label: 'Colours', shortcut: 'C', run: () => setShape('palette') }, { label: 'Sizes', shortcut: 'S', run: () => setShape('sliders') },
        { label: 'Minimise or show the toolbar', shortcut: 'M', run: () => setShape(shape === 'disc' ? 'pens' : 'disc') }, { label: 'Undo', shortcut: 'Ctrl+Z', run: undo }, { label: 'Redo', shortcut: 'Ctrl+Y', run: redo },
        { label: 'Export SVG', shortcut: 'Ctrl+E', run: exportSVG }, { label: 'Export PNG 1x', shortcut: 'Ctrl+Shift+E', run: () => exportPNG(1) }, { label: 'Save a version', shortcut: 'Ctrl+S', run: () => { saveVersion(); say('Version saved.'); } },
        { label: 'Clear the drawing', shortcut: 'Shift+Delete', danger: true, run: clearAll }
      ]));
    }
    renderBar(); renderVersions();
    if (window.ResizeObserver) { roHandle = new ResizeObserver(() => resize()); roHandle.observe(canvas.parentElement); }
    resize();
    say(doc.strokes.length ? `Restored ${doc.strokes.length} strokes from last time.` : 'Pick a pen and draw. Hold Shift for a straight line in one of eight directions.');
    el.__dw = { doc, setTool, undo, redo, exportSVG: () => toSVG(doc, doc.bgData, cssW, cssH), widths, erase };
  }
  function unmount() {
    if (disposeMenu) { disposeMenu(); disposeMenu = null; }
    if (keyHandler) { document.removeEventListener('keydown', keyHandler, true); keyHandler = null; }
    if (roHandle) { roHandle.disconnect(); roHandle = null; }
  }

  if (window.MVLTools) window.MVLTools.register({ id: 'drawing', title: 'Drawing and annotation', group: 'Create', summary: 'Draw on a blank board or an image with seven pens; export SVG or PNG', mount, unmount });
  window.MVLDraw = { widths, outline, erase, lockLine, toSVG, PENS };
})();
