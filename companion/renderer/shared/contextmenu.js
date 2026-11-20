'use strict';
// A context menu on every element. Right-click, the Menu key, Shift+F10 or a long press opens a
// Material 3 menu for the element under it: what the element itself does, copying its text or
// value, finding it in the command palette, and items the app registers for matching elements.
// Every item shows its working keyboard shortcut, and each shortcut also works without the menu.
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const registry = []; // { selector, items: (el) => [{ label, shortcut, run, danger }] }
  let menu = null, lastFocus = null;

  function nameOf(el) {
    if (!el) return '';
    const l = el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title'));
    if (l) return l.trim();
    if (el.labels && el.labels[0]) return el.labels[0].textContent.trim();
    return (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  }
  const actionable = (el) => el && el.closest('button, a[href], [role="tab"], [role="switch"], summary, label');

  function itemsFor(target) {
    const items = [];
    const act = actionable(target);
    if (act && !act.disabled) {
      const n = nameOf(act);
      items.push({ label: n ? `${act.matches('a[href]') ? 'Open' : 'Activate'}: ${n}` : 'Activate', shortcut: 'Enter', run: () => act.click() });
    }
    const field = target.closest('input, textarea, select');
    const sel = String(window.getSelection ? window.getSelection() : '');
    if (sel) items.push({ label: 'Copy selection', shortcut: 'Ctrl+C', run: () => copy(sel) });
    if (field && 'value' in field && field.type !== 'password' && field.type !== 'file') {
      items.push({ label: 'Copy value', shortcut: 'Ctrl+C', run: () => copy(field.value) });
      if (!field.readOnly && !field.disabled && field.tagName !== 'SELECT') items.push({ label: 'Clear', shortcut: 'Escape', run: () => { field.value = ''; field.dispatchEvent(new Event('input', { bubbles: true })); } });
    }
    const block = target.closest('pre, code, .mono, .kv dd, .mname, .ipbig, h1, h2, h3, p, li, td, .what');
    if (block && !field) { const t = block.textContent.trim(); if (t) items.push({ label: 'Copy text', shortcut: 'Ctrl+Shift+C', run: () => copy(t) }); }
    for (const r of registry) { const el = target.closest(r.selector); if (el) { try { items.push(...(r.items(el) || [])); } catch { /* a broken provider adds nothing */ } } }
    if (window.MVLPalette) items.push({ label: 'Find in the command palette', shortcut: 'Ctrl+Shift+F', run: () => window.MVLPalette.open(nameOf(act || target)) });
    if (window.MVLNotify) items.push({ label: 'Notifications', shortcut: 'Ctrl+Shift+N', run: () => window.MVLNotify.openCentre() });
    items.push({ label: 'Settings', shortcut: 'Ctrl+,', run: openSettings });
    return items;
  }

  function openSettings() {
    const tab = [...document.querySelectorAll('.rail .tab')].find((t) => /settings/i.test(t.textContent));
    if (tab) tab.click(); else if (window.MVL && window.MVL.settingsDialog) window.MVL.settingsDialog();
  }
  function copy(text) {
    const done = () => window.MVL && window.MVL.toast && window.MVL.toast('Copied');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(String(text)).then(done, () => fallbackCopy(text, done));
    else fallbackCopy(text, done);
  }
  function fallbackCopy(text, done) { const t = document.createElement('textarea'); t.value = String(text); t.style.position = 'fixed'; t.style.opacity = '0'; document.body.append(t); t.select(); try { document.execCommand('copy'); done(); } catch { /* clipboard blocked */ } t.remove(); }

  function close() { if (!menu) return; menu.remove(); menu = null; if (lastFocus && lastFocus.isConnected) lastFocus.focus(); }

  function open(target, x, y) {
    close();
    lastFocus = document.activeElement;
    const items = itemsFor(target);
    menu = document.createElement('div');
    menu.className = 'ctx-menu'; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', 'Actions for ' + (nameOf(actionable(target) || target) || 'this element'));
    menu.innerHTML = items.map((it, i) => `<button type="button" role="menuitem" class="ctx-item${it.danger ? ' danger' : ''}" data-i="${i}" tabindex="-1"><span class="ctx-label">${esc(it.label)}</span>${it.shortcut ? `<kbd class="ctx-key">${esc(it.shortcut)}</kbd>` : ''}</button>`).join('');
    document.body.append(menu);
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
    const btns = [...menu.querySelectorAll('[role="menuitem"]')];
    btns[0] && btns[0].focus();
    menu.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (!b) return; const it = items[+b.dataset.i]; close(); it.run(); });
    menu.addEventListener('keydown', (e) => {
      const i = btns.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); btns[(i + 1) % btns.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length].focus(); }
      else if (e.key === 'Home') { e.preventDefault(); btns[0].focus(); }
      else if (e.key === 'End') { e.preventDefault(); btns[btns.length - 1].focus(); }
      else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); close(); }
    });
  }

  document.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.ctx-menu')) return;
    e.preventDefault();
    open(e.target, e.clientX, e.clientY);
  });
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) && !e.target.closest('.ctx-menu')) {
      e.preventDefault(); const r = e.target.getBoundingClientRect ? e.target.getBoundingClientRect() : { left: 20, bottom: 20 };
      open(e.target === document.body ? document.body : e.target, r.left + 8, r.bottom);
    }
    // The shortcuts the menus show, working without the menu too.
    if (e.ctrlKey && e.shiftKey && (e.key === 'N' || e.key === 'n') && window.MVLNotify) { e.preventDefault(); window.MVLNotify.openCentre(); }
    if (e.ctrlKey && !e.shiftKey && e.key === ',') { e.preventDefault(); openSettings(); }
    if (e.ctrlKey && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
      const block = document.activeElement && document.activeElement.closest && document.activeElement.closest('pre, code, .mono, .kv dd, .mname, .ipbig');
      if (block) { e.preventDefault(); copy(block.textContent.trim()); }
    }
  });
  // Long press on touch screens.
  let pressTimer = null;
  document.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'touch') return; pressTimer = setTimeout(() => open(e.target, e.clientX, e.clientY), 550); });
  for (const ev of ['pointerup', 'pointermove', 'pointercancel']) document.addEventListener(ev, () => clearTimeout(pressTimer));
  document.addEventListener('pointerdown', (e) => { if (menu && !e.target.closest('.ctx-menu')) close(); }, true);
  window.addEventListener('blur', close);
  window.addEventListener('resize', close);

  window.MVLContext = { register: (selector, items) => { const r = { selector, items }; registry.push(r); return () => registry.splice(registry.indexOf(r), 1); }, open, close };
})();
