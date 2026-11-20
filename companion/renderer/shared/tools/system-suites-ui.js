'use strict';
// Small shared helpers for the System tools (Ollama, Minecraft servers, virtual disks): escaping,
// byte formatting, keyboard-operable sub-tabs, typed controls, guarded local storage and clipboard.
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function fmtBytes(n) {
    n = Number(n); if (!Number.isFinite(n) || n < 0) return 'unknown';
    const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return (i ? n.toFixed(n < 10 ? 2 : 1) : String(n)) + ' ' + u[i];
  }
  let seq = 0;
  const uid = (p) => (p || 'sys') + '-' + (++seq) + '-' + Math.random().toString(36).slice(2, 6);

  // Sub-tabs with arrow-key movement. tabs: [{ id, label }]. Returns { el, panel, select(id) }.
  function subtabs(tabs, onSelect, label) {
    const wrap = document.createElement('div');
    const base = uid('tab');
    wrap.innerHTML = `<div class="sys-tabs" role="tablist" aria-label="${esc(label || 'Sections')}">${tabs.map((t, i) => `<button type="button" role="tab" id="${base}-${t.id}" data-tab="${esc(t.id)}" aria-selected="${i === 0}" aria-controls="${base}-panel" tabindex="${i === 0 ? 0 : -1}">${esc(t.label)}</button>`).join('')}</div><div class="sys-panel" role="tabpanel" id="${base}-panel" tabindex="0"></div>`;
    const list = wrap.firstChild, panel = wrap.lastChild;
    let current = null;
    function select(id, focus) {
      const btn = list.querySelector(`[data-tab="${CSS.escape(id)}"]`); if (!btn) return;
      for (const b of list.children) { const on = b === btn; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; }
      panel.setAttribute('aria-labelledby', btn.id);
      if (focus) btn.focus();
      current = id; onSelect(id, panel);
    }
    list.addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) select(b.dataset.tab); });
    list.addEventListener('keydown', (e) => {
      const btns = [...list.children]; const i = btns.indexOf(document.activeElement); if (i < 0) return;
      let j = -1;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % btns.length;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + btns.length) % btns.length;
      else if (e.key === 'Home') j = 0; else if (e.key === 'End') j = btns.length - 1;
      if (j >= 0) { e.preventDefault(); select(btns[j].dataset.tab, true); }
    });
    return { el: wrap, panel, select, get current() { return current; } };
  }

  // Typed controls. Each returns an HTML string; read values back with value(root, key).
  const sw = (key, label, checked, help, disabled) => { const id = uid('sw'); return `<div class="switch-row sys-ctl"><label for="${id}"><span>${esc(label)}</span>${help ? `<small class="sys-help">${esc(help)}</small>` : ''}</label><input type="checkbox" role="switch" id="${id}" data-k="${esc(key)}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}></div>`; };
  const num = (key, label, val, min, max, step, help, unit) => { const id = uid('n'); return `<div class="field sys-ctl"><label for="${id}">${esc(label)}${unit ? ` <span class="sys-unit">(${esc(unit)})</span>` : ''}</label><div class="sys-step"><button type="button" class="iconbtn" data-step="-1" aria-label="Decrease ${esc(label)}">&minus;</button><input id="${id}" type="number" inputmode="numeric" data-k="${esc(key)}" value="${esc(val)}" ${min != null ? `min="${min}"` : ''} ${max != null ? `max="${max}"` : ''} step="${step || 1}"><button type="button" class="iconbtn" data-step="1" aria-label="Increase ${esc(label)}">+</button></div>${help ? `<small class="sys-help">${esc(help)}</small>` : ''}</div>`; };
  const sel = (key, label, val, choices, help) => { const id = uid('s'); return `<div class="field sys-ctl"><label for="${id}">${esc(label)}</label><select id="${id}" data-k="${esc(key)}">${choices.map((c) => { const [v, l] = Array.isArray(c) ? c : [c, c]; return `<option value="${esc(v)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(l)}</option>`; }).join('')}</select>${help ? `<small class="sys-help">${esc(help)}</small>` : ''}</div>`; };
  const txt = (key, label, val, help, attrs) => { const id = uid('t'); return `<div class="field sys-ctl"><label for="${id}">${esc(label)}</label><input id="${id}" type="text" data-k="${esc(key)}" value="${esc(val)}" spellcheck="false" ${attrs || ''}>${help ? `<small class="sys-help">${esc(help)}</small>` : ''}</div>`; };
  function wireSteppers(root) {
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-step]'); if (!b) return;
      const input = b.parentElement.querySelector('input'); const step = Number(input.step) || 1;
      let v = (Number(input.value) || 0) + Number(b.dataset.step) * step;
      if (input.min !== '') v = Math.max(Number(input.min), v); if (input.max !== '') v = Math.min(Number(input.max), v);
      input.value = String(v); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
  function value(root, key) {
    const el = root.querySelector(`[data-k="${CSS.escape(key)}"]`); if (!el) return undefined;
    if (el.type === 'checkbox') return el.checked;
    if (el.type === 'number') return el.value === '' ? null : Number(el.value);
    return el.value;
  }
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  };
  async function copy(text, ctx) {
    try { await navigator.clipboard.writeText(text); if (ctx) ctx.toast('Copied to the clipboard.'); return true; }
    catch { if (ctx) ctx.toast('The clipboard is not available here.', 'error'); return false; }
  }
  function download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  // A search box with the shared regex builder; returns { el, test(text) }.
  function search(label, onChange) {
    if (window.MVL && window.MVL.makeSearch) {
      const s = window.MVL.makeSearch({ label, placeholder: label, onChange });
      return { el: s.el, test: (t) => !s.active() || !!s.test(t), invalid: () => s.invalid() };
    }
    const el = document.createElement('input'); el.type = 'search'; el.setAttribute('aria-label', label); el.addEventListener('input', onChange);
    return { el, test: (t) => String(t).toLowerCase().includes(el.value.toLowerCase()), invalid: () => false };
  }
  const pill = (verdict) => ({ 'Runs well': 'lime', 'Runs with limits': 'amber', Unlikely: 'red', Unknown: '' }[verdict] || '');
  const unavailable = (title, reason) => `<div class="sys-unavail" role="note"><strong>${esc(title)}</strong><span>${esc(reason)}</span></div>`;

  window.MVLSys = { esc, fmtBytes, uid, subtabs, sw, num, sel, txt, wireSteppers, value, store, copy, download, search, pill, unavailable };
})();
