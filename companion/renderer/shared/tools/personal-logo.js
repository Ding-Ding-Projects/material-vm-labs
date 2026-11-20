'use strict';
// App logo customisation: shipped presets plus a local custom image. The real bytes are checked
// (signature, declared size, animation, bounds) before anything is decoded; decoding is bounded in
// time; every display size is generated, then each output is re-checked by signature and decoded
// again before the new logo becomes active. Any failure keeps the previous logo. The image never
// leaves this device, and the logo is presentation only: package identity, app id, executable name,
// installer, update feed and data folder never change.
(function () {
  const C = window.MVLPersonalCore;
  const { esc, store, history } = C;
  const KEY = 'mvl-logo';
  const SIZES = [16, 24, 32, 48, 64, 128, 256];
  const SVG = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  const PRESETS = [
    { id: 'shipped', name: 'Stacked machines (shipped)', svg: SVG('<rect x="3.5" y="4" width="17" height="7" rx="2"></rect><rect x="3.5" y="13" width="17" height="7" rx="2"></rect><path d="M7.5 7.5h.01M7.5 16.5h.01"></path>') },
    { id: 'monitor', name: 'Lab monitor', svg: SVG('<rect x="3" y="4" width="18" height="12" rx="2"></rect><path d="M8 20h8M12 16v4M7 9l2 2-2 2M11.5 13h4"></path>') },
    { id: 'flask', name: 'Lab flask', svg: SVG('<path d="M9 3h6M10 3v6L4.5 18.5A1.6 1.6 0 0 0 5.9 21h12.2a1.6 1.6 0 0 0 1.4-2.5L14 9V3"></path><path d="M7.5 15h9"></path>') },
    { id: 'cube', name: 'Clean machine cube', svg: SVG('<path d="M12 2.8 20 7v10l-8 4.2L4 17V7z"></path><path d="M4 7l8 4.2L20 7M12 11.2v10"></path>') },
    { id: 'receipt', name: 'Build receipt', svg: SVG('<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"></path><path d="M9 8h6M9 12h6M9 16h4"></path>') }
  ];
  const listeners = new Set();
  let active = load();

  function load() {
    const v = store.get(KEY, null);
    if (!v || typeof v !== 'object') return { kind: 'preset', id: 'shipped' };
    if (v.kind === 'preset' && PRESETS.some((p) => p.id === v.id)) return v;
    if (v.kind === 'custom' && v.variants && typeof v.variants === 'object' && SIZES.every((s) => typeof v.variants[s] === 'string' && v.variants[s].startsWith('data:image/png;base64,'))) return v;
    return { kind: 'preset', id: 'shipped', corrupt: true };
  }
  function markHTML(size, which) {
    const a = which || active;
    if (a.kind === 'custom') { const s = SIZES.find((x) => x >= size) || 256; return `<img src="${a.variants[s]}" width="${size}" height="${size}" alt="" class="app-logo-img">`; }
    return (PRESETS.find((p) => p.id === a.id) || PRESETS[0]).svg;
  }
  function mark(size) { const s = document.createElement('span'); s.className = 'logo app-logo'; s.dataset.appLogo = String(size || 24); s.innerHTML = markHTML(size || 24); return s; }
  function applyAll() {
    for (const el of document.querySelectorAll('[data-app-logo]')) el.innerHTML = markHTML(Number(el.dataset.appLogo) || 24);
    for (const el of document.querySelectorAll('.logo:not([data-app-logo])')) el.innerHTML = markHTML(22);
    for (const f of listeners) { try { f(active); } catch { /* ignore */ } }
  }
  function activate(next, summary) {
    const before = active;
    if (!store.set(KEY, next)) { active = before; throw new Error('There is not enough local storage for this logo. The previous logo is still active.'); }
    active = next; history.add('logo-customization', next.kind, summary); applyAll();
  }

  // ---------- custom image pipeline ----------
  async function decode(blob) {
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('Decoding took longer than 5 seconds, so it was stopped.')), 5000));
    return Promise.race([createImageBitmap(blob), timeout]);
  }
  function render(bmp, size, o) {
    const cv = document.createElement('canvas'); cv.width = size; cv.height = size;
    const g = cv.getContext('2d');
    if (o.background && o.background !== 'transparent') { const p = C.parse(o.background); if (p) { g.fillStyle = C.format(C.clip(p.color), 'hex8'); g.fillRect(0, 0, size, size); } }
    const iw = bmp.width, ih = bmp.height, zoom = o.zoom / 100;
    let dw, dh;
    if (o.fit === 'fill') { dw = size * zoom; dh = size * zoom; }
    else { const k = (o.fit === 'cover' ? Math.max : Math.min)(size / iw, size / ih) * zoom; dw = iw * k; dh = ih * k; }
    // The focal point (0..100 per axis) stays as close to the centre as the scaled image allows.
    const fx = o.focusX / 100, fy = o.focusY / 100;
    let dx = size / 2 - dw * fx, dy = size / 2 - dh * fy;
    // When the scaled image is smaller than the square on an axis it is centred on that axis.
    dx = dw >= size ? Math.min(0, Math.max(size - dw, dx)) : (size - dw) / 2;
    dy = dh >= size ? Math.min(0, Math.max(size - dh, dy)) : (size - dh) / 2;
    g.imageSmoothingQuality = 'high';
    g.drawImage(bmp, dx, dy, dw, dh);
    return cv.toDataURL('image/png');
  }
  async function verify(dataUrl, size) {
    const bin = atob(dataUrl.split(',')[1]); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const s = C.sniffImage(u);
    if (!s.ok || s.type !== 'png' || s.width !== size || s.height !== size) throw new Error('A generated ' + size + ' pixel image did not pass its check.');
    const b = await decode(new Blob([u], { type: 'image/png' }));
    if (b.width !== size || b.height !== size) throw new Error('A generated ' + size + ' pixel image did not decode at the right size.');
    b.close && b.close();
    return u.length;
  }
  async function convert(bmp, o) {
    const variants = {}; let total = 0;
    for (const s of SIZES) { const d = render(bmp, s, o); total += await verify(d, s); variants[s] = d; }
    if (total > 1.5 * 1024 * 1024) throw new Error('The generated sizes are larger than 1.5 MB together.');
    return variants;
  }
  function losses(info, o, bmp) {
    const out = [];
    if (info.width !== info.height && o.fit === 'cover') out.push('The image is not square, so cover crops part of it.');
    if (info.width !== info.height && o.fit === 'fill') out.push('The image is not square, so fill stretches it.');
    if (info.width !== info.height && o.fit === 'contain' && (!o.background || o.background === 'transparent')) out.push('The image is not square, so contain leaves transparent bands.');
    if (o.zoom > 100) out.push('Zoom above 100 percent crops the edges.');
    if (info.type !== 'png') out.push('The image is converted to PNG.');
    if (!info.alpha && o.background === 'transparent') out.push('This ' + info.type.toUpperCase() + ' has no transparency, so its background stays.');
    if (info.alpha && o.background && o.background !== 'transparent') out.push('Transparent areas are filled with the chosen background.');
    if (bmp && Math.max(info.width, info.height) < 256) out.push('The image is smaller than 256 pixels, so the largest sizes are upscaled and may look soft.');
    if (o.fit === 'contain' && o.zoom === 100) out.push('The focal point only moves the image once it is cropped, with Cover or a zoom above 100 percent.');
    out.push('Colour profiles are flattened to sRGB.');
    return out;
  }

  // ---------- UI ----------
  function control() {
    const box = document.createElement('section');
    box.className = 'personal-card personal-logo';
    const id = 'pl-' + Math.random().toString(36).slice(2, 7);
    box.setAttribute('aria-labelledby', id);
    box.innerHTML = `<h3 id="${id}">App logo</h3>
<p class="small">Changes how the logo looks inside the app. It never changes the app's identity: package, app id, executable name, installer, update feed and data folder stay the same, and the taskbar icon is not changed by this setting.</p>
<div data-pl-search></div>
<div class="pl-presets" role="radiogroup" aria-label="Logo presets" data-pl-presets></div>
<h4>Custom image</h4>
<p class="small">PNG, JPEG or WebP, still images only, up to 8 MB and 8192 pixels on a side. It is checked and converted on this device and never uploaded.</p>
<label class="btn personal-file">Choose an image<input type="file" accept="image/png,image/jpeg,image/webp" data-pl-file></label>
<p class="small" role="status" data-pl-status>No custom logo.</p>
<div class="pl-editor" data-pl-editor hidden>
  <div class="seg" role="group" aria-label="Fit" data-pl-fit><button type="button" data-fit="contain" aria-pressed="true">Contain</button><button type="button" data-fit="cover" aria-pressed="false">Cover</button><button type="button" data-fit="fill" aria-pressed="false">Fill</button></div>
  <label class="field cp-range"><span>Zoom: <output data-pl-out="zoom">100%</output></span><input type="range" min="100" max="300" value="100" data-pl="zoom"></label>
  <label class="field cp-range"><span>Focal point, across: <output data-pl-out="focusX">50%</output></span><input type="range" min="0" max="100" value="50" data-pl="focusX"></label>
  <label class="field cp-range"><span>Focal point, down: <output data-pl-out="focusY">50%</output></span><input type="range" min="0" max="100" value="50" data-pl="focusY"></label>
  <label class="switch-row"><span>Transparent background</span><input type="checkbox" role="switch" checked data-pl-transparent></label>
  <div data-pl-bg hidden></div>
  <label class="switch-row"><span>Show the safe area (the circle most icon shapes keep)</span><input type="checkbox" role="switch" data-pl-safe></label>
  <ul class="small pl-losses" data-pl-losses></ul>
  <div class="row"><button type="button" class="btn primary" data-pl-apply>Use this logo</button><button type="button" class="btn" data-pl-cancel>Discard</button></div>
</div>
<h4>Preview at every display size</h4>
<div class="pl-previews" data-pl-previews></div>
<div class="row"><button type="button" class="btn" data-pl-reset>Reset to the shipped logo</button></div>`;
    const $ = (s) => box.querySelector(s), status = $('[data-pl-status]'), editor = $('[data-pl-editor]');
    const o = { fit: 'contain', zoom: 100, focusX: 50, focusY: 50, background: 'transparent' };
    let bmp = null, info = null, preview = null, gen = 0;
    const search = window.MVL && window.MVL.makeSearch ? window.MVL.makeSearch({ placeholder: 'Search logo presets', label: 'Search logo presets', onChange: () => drawPresets() }) : null;
    if (search) $('[data-pl-search]').append(search.el);

    function drawPresets() {
      const shown = PRESETS.filter((p) => !search || !search.active() || search.test(p.name));
      $('[data-pl-presets]').innerHTML = shown.map((p) => `<button type="button" role="radio" class="pl-preset" data-preset="${p.id}" aria-checked="${active.kind === 'preset' && active.id === p.id}"><span class="logo">${p.svg}</span><span>${esc(p.name)}</span></button>`).join('') || '<p class="small">No preset matches.</p>';
      if (search) search.setStatus(shown.length + ' of ' + PRESETS.length);
    }
    function drawPreviews() {
      const which = preview || active;
      $('[data-pl-previews]').innerHTML = SIZES.map((s) => `<figure class="pl-prev${$('[data-pl-safe]').checked ? ' safe' : ''}"><span class="pl-box" style="width:${s}px;height:${s}px">${which.kind === 'custom' ? `<img src="${which.variants[s]}" width="${s}" height="${s}" alt="">` : (PRESETS.find((p) => p.id === which.id) || PRESETS[0]).svg}</span><figcaption>${s} px</figcaption></figure>`).join('');
      status.textContent = preview ? 'Previewing the converted image. It is not active until you choose Use this logo.' : active.kind === 'custom' ? 'A custom logo is active.' + (active.notes ? ' ' + active.notes : '') : active.corrupt ? 'The saved custom logo could not be read, so the shipped logo is shown. Choose an image again or pick a preset.' : 'No custom logo. Preset: ' + (PRESETS.find((p) => p.id === active.id) || PRESETS[0]).name + '.';
    }
    async function rebuild() {
      if (!bmp) return;
      const my = ++gen;
      status.textContent = 'Converting.';
      try {
        const variants = await convert(bmp, o);
        if (my !== gen) return;
        preview = { kind: 'custom', variants, notes: '' };
        $('[data-pl-losses]').innerHTML = losses(info, o, bmp).map((x) => `<li>${esc(x)}</li>`).join('');
        drawPreviews();
      } catch (e) { if (my === gen) { preview = null; drawPreviews(); status.textContent = 'Conversion failed: ' + e.message + ' The previous logo is still active.'; } }
    }
    $('[data-pl-file]').addEventListener('change', async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      preview = null; bmp = null; editor.hidden = true; status.textContent = 'Checking the file.';
      try {
        if (f.size > C.LOGO_LIMITS.bytes) throw new Error('The file is larger than 8 MB.');
        const u8 = new Uint8Array(await f.arrayBuffer());
        const s = C.sniffImage(u8);
        if (!s.ok) throw new Error(s.reason);
        const claim = C.claimedType(f.name, f.type);
        const mismatch = (claim.byExt && claim.byExt !== s.type) || (claim.byMime && claim.byMime !== s.type);
        if (mismatch) throw new Error('The file says it is ' + (claim.byExt || claim.byMime).toUpperCase() + ' but its bytes are ' + s.type.toUpperCase() + '. Rename or re-export it, then try again.');
        status.textContent = 'Decoding.';
        const b = await decode(new Blob([u8], { type: 'image/' + s.type }));
        if (b.width !== s.width || b.height !== s.height) throw new Error('The decoded size does not match the header.');
        bmp = b; info = s; editor.hidden = false;
        await rebuild();
      } catch (ex) { drawPreviews(); status.textContent = 'Not used: ' + ex.message + ' Nothing changed.'; }
    });
    editor.addEventListener('input', (e) => { const k = e.target.dataset.pl; if (k) { o[k] = Number(e.target.value); box.querySelector(`[data-pl-out="${k}"]`).textContent = o[k] + '%'; clearTimeout(rebuild.t); rebuild.t = setTimeout(rebuild, 120); } });
    editor.addEventListener('click', (e) => { const b = e.target.closest('[data-fit]'); if (b) { o.fit = b.dataset.fit; for (const x of editor.querySelectorAll('[data-fit]')) x.setAttribute('aria-pressed', String(x === b)); rebuild(); } });
    $('[data-pl-transparent]').addEventListener('change', (e) => {
      const host = $('[data-pl-bg]'); host.hidden = e.target.checked;
      if (e.target.checked) { o.background = 'transparent'; host.innerHTML = ''; rebuild(); return; }
      o.background = '#ffffff';
      if (window.MVLPersonal.color) { const p = window.MVLPersonal.color.picker({ value: o.background, onChange: (v) => { o.background = C.isRainbow(v) ? '#ffffff' : v; clearTimeout(rebuild.t); rebuild.t = setTimeout(rebuild, 150); } }); const rb = p.el.querySelector('.cp-rainbow-row'); if (rb) { rb.querySelector('input').disabled = true; rb.insertAdjacentHTML('beforeend', '<span class="small">An image file cannot animate, so the rainbow is not offered here.</span>'); } host.append(p.el); }
      rebuild();
    });
    $('[data-pl-safe]').addEventListener('change', drawPreviews);
    $('[data-pl-apply]').addEventListener('click', () => {
      if (!preview) { status.textContent = 'There is no converted image to use yet.'; return; }
      try { activate({ kind: 'custom', variants: preview.variants, notes: losses(info, o, bmp).join(' ') }, 'Custom logo applied'); preview = null; editor.hidden = true; bmp && bmp.close && bmp.close(); bmp = null; drawPresets(); drawPreviews(); status.textContent = 'The custom logo is active.'; }
      catch (e) { status.textContent = e.message; }
    });
    $('[data-pl-cancel]').addEventListener('click', () => { preview = null; bmp = null; editor.hidden = true; drawPreviews(); status.textContent = 'Discarded. Nothing changed.'; });
    $('[data-pl-presets]').addEventListener('click', (e) => { const b = e.target.closest('[data-preset]'); if (!b) return; try { activate({ kind: 'preset', id: b.dataset.preset }, 'Preset chosen'); preview = null; drawPresets(); drawPreviews(); } catch (ex) { status.textContent = ex.message; } });
    $('[data-pl-presets]').addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      const bs = [...box.querySelectorAll('[data-preset]')], i = bs.indexOf(document.activeElement); if (i < 0) return;
      e.preventDefault(); const n = bs[(i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length]; n.focus(); n.click();
    });
    $('[data-pl-reset]').addEventListener('click', () => { activate({ kind: 'preset', id: 'shipped' }, 'Logo reset'); preview = null; editor.hidden = true; drawPresets(); drawPreviews(); status.textContent = 'Reset. The shipped logo is back and the custom image was removed from this device.'; });
    drawPresets(); drawPreviews();
    return box;
  }

  function init() {
    const go = () => applyAll();
    if (document.body) go(); else document.addEventListener('DOMContentLoaded', go, { once: true });
    if (window.MVLTools) window.MVLTools.register({ id: 'personal-logo', title: 'App logo', group: 'Personal', summary: 'Logo presets or your own image, checked and converted on this device.', mount(el) { const c = control(); c.classList.add('in-tool'); el.append(c); } });
  }

  window.MVLPersonal = window.MVLPersonal || {};
  window.MVLPersonal.logo = { init, control, mark, presets: PRESETS.map((p) => ({ id: p.id, name: p.name })), active: () => Object.assign({}, active, { variants: undefined }), onChange: (f) => listeners.add(f) };
  init();
})();
