'use strict';
// Tools host: one full-window Tools surface in every companion. Each tool registers itself with
// MVLTools.register({ id, title, group, summary, icon, mount(el, ctx), unmount? }) and appears in
// the Tools list, in the command palette and in the rail's Tools button. Tools stay local: the host
// gives them no network and no file system of their own.
(function () {
  const tools = new Map();
  let dlg = null, current = null;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ICON = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"></path></svg>';

  function register(tool) {
    if (!tool || !tool.id || typeof tool.mount !== 'function') throw new Error('A tool needs an id and a mount function.');
    tools.set(tool.id, tool);
    if (window.MVLPalette) window.MVLPalette.register({ id: 'tool-' + tool.id, title: 'Open ' + tool.title, group: 'Tools', keywords: [tool.group || '', tool.summary || ''], run: () => open(tool.id) });
    if (dlg && dlg.open) renderList();
  }

  function renderList() {
    const list = dlg.querySelector('[data-tools-list]');
    const groups = {};
    for (const t of tools.values()) (groups[t.group || 'Tools'] = groups[t.group || 'Tools'] || []).push(t);
    list.innerHTML = Object.keys(groups).sort().map((g) => `<li class="tools-group">${esc(g)}</li>` + groups[g].sort((a, b) => a.title.localeCompare(b.title)).map((t) => `<li><button type="button" class="tools-item" data-tool="${esc(t.id)}" aria-current="${current === t.id ? 'page' : 'false'}"><strong>${esc(t.title)}</strong><span>${esc(t.summary || '')}</span></button></li>`).join('')).join('');
  }

  function show(id) {
    const t = tools.get(id); if (!t) return;
    const panel = dlg.querySelector('[data-tools-panel]');
    const prev = current && tools.get(current);
    if (prev && prev.unmount) { try { prev.unmount(); } catch { /* a tool's teardown never blocks the host */ } }
    current = id;
    panel.innerHTML = `<header class="tools-head"><button type="button" class="iconbtn tools-back" data-tools-back aria-label="Back to the tools list">&larr;</button><h2 tabindex="-1">${esc(t.title)}</h2></header><div class="tools-body"></div>`;
    dlg.classList.add('has-tool');
    try { t.mount(panel.querySelector('.tools-body'), { toast: (m, k) => window.MVL && window.MVL.toast(m, k), notify: (n) => window.MVLNotify && window.MVLNotify.push(n), confirm: (o) => window.MVLSuperConfirm ? window.MVLSuperConfirm.ask(o) : Promise.resolve(window.confirm(o.action + '\n' + o.affected)) }); }
    catch (e) { panel.querySelector('.tools-body').innerHTML = `<p class="errbox">This tool could not start: ${esc(e.message)}</p>`; }
    renderList();
    panel.querySelector('h2').focus();
  }

  function open(id) {
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.className = 'tools-host'; dlg.setAttribute('aria-label', 'Tools');
      dlg.innerHTML = `<div class="tools-top"><h1>Tools</h1><button type="button" class="iconbtn" data-tools-close aria-label="Close tools">&times;</button></div><div class="tools-split"><nav aria-label="Tools list"><ul class="tools-list" data-tools-list></ul></nav><section class="tools-panel" data-tools-panel aria-live="polite"><p class="empty-note">Pick a tool. Everything here runs on this device.</p></section></div>`;
      dlg.addEventListener('click', (e) => {
        const b = e.target.closest('[data-tool]'); if (b) show(b.dataset.tool);
        if (e.target.closest('[data-tools-close]')) dlg.close();
        if (e.target.closest('[data-tools-back]')) { dlg.classList.remove('has-tool'); const f = dlg.querySelector('[aria-current="page"]'); if (f) f.focus(); }
      });
      // Escape inside a tool belongs to the tool (clearing a search, closing a menu), not to the Tools window.
      dlg.addEventListener('cancel', (e) => { const a = document.activeElement; if (a && a.closest('.tools-body')) e.preventDefault(); });
      dlg.addEventListener('close', () => { const t = current && tools.get(current); if (t && t.unmount) { try { t.unmount(); } catch { /* ignore */ } } current = null; dlg.classList.remove('has-tool'); });
      document.body.append(dlg);
    }
    renderList();
    if (!dlg.open) dlg.showModal();
    if (id) show(id);
  }

  function railButton() {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'iconbtn tools-rail'; b.setAttribute('aria-label', 'Tools'); b.title = 'Tools';
    b.innerHTML = ICON;
    b.addEventListener('click', () => open());
    return b;
  }
  function addRail() { const anchor = document.querySelector('.rail .notify-bell') || document.querySelector('.rail .rail-grow'); if (anchor && !document.querySelector('.tools-rail')) anchor.after(railButton()); }
  if (document.readyState !== 'loading') setTimeout(addRail, 50); else document.addEventListener('DOMContentLoaded', () => setTimeout(addRail, 50));
  document.addEventListener('keydown', (e) => { if (e.ctrlKey && e.shiftKey && (e.key === 'T' || e.key === 't')) { e.preventDefault(); open(); } });

  // Tool files load here, in order, so adding a tool never needs a page edit. "only" limits a file to one app.
  const APP = /\/(manager|docs|build)\/index\.html/.exec(location.pathname);
  const FILES = [
    { css: '../shared/tools/manager-p1.css', only: ['docs', 'build'] },
    { js: '../shared/tools/manager-p1-zh-hk.js', only: ['docs', 'build'] },
    { js: '../shared/tools/manager-p1-dates.js', only: ['docs', 'build'] },
    { js: '../shared/tools/manager-p1-export.js', only: ['docs', 'build'] },
    { js: '../shared/tools/manager-p1-bulk.js', only: ['docs', 'build'] },
    { js: '../shared/tools/manager-p1-history.js', only: ['docs', 'build'] },
    { js: '../shared/tools/manager-p1-changelog.js', only: ['docs', 'build'] },
    { css: '../shared/tools/dev-tools.css' },
    { css: '../shared/tools/regex-workbench.css' },
    { js: '../shared/tools/regex-zh-hk.js' },
    { js: '../shared/tools/regex-core.js' },
    { js: '../shared/tools/regex-workbench.js' },
    { css: '../shared/tools/safety-tools.css' },
    { js: '../shared/tools/safety-tools-zh-hk.js' },
    { js: '../shared/tools/safety-tools-core.js' },
    { js: '../shared/tools/safety-tools-kit.js' },
    { js: '../shared/tools/safety-tools-auth.js' },
    { js: '../shared/tools/safety-tools-locks.js' },
    { css: '../shared/tools/records-updates.css' },
    { js: '../shared/tools/records-zh-hk.js' },
    { js: '../shared/tools/records-provenance.js' },
    { js: '../shared/tools/records-updates.js' },
    { css: '../shared/tools/data-tools.css' },
    { js: '../shared/tools/data-tools-core.js' },
    { js: '../shared/tools/data-tools-ui.js' },
    { js: '../shared/tools/data-tools-base64.js' },
    { js: '../shared/tools/data-tools-converter.js' },
    { js: '../shared/tools/data-tools-zh-hk.js' },
    { css: '../shared/tools/system-suites.css' },
    { js: '../shared/tools/system-suites-ui.js' },
    { js: '../shared/tools/system-suites-ollama.js' },
    { js: '../shared/tools/system-suites-minecraft.js' },
    { js: '../shared/tools/system-suites-vdisk.js' },
    { js: '../shared/tools/system-suites-zh-hk.js' },
    { css: '../shared/tools/guidance.css' },
    { js: '../shared/tools/guidance-zh-hk.js' },
    { js: '../shared/tools/guidance-render.js' },
    { js: '../shared/tools/guidance-registry.js', only: 'manager' },
    { js: '../shared/tools/guidance-forms.js', only: 'manager' },
    { js: '../shared/tools/guidance-extensions.js', only: 'manager' },
    { js: '../shared/tools/guidance-editor.js', only: 'manager' },
    { js: '../shared/tools/guidance-draw.js' },
    { css: '../shared/tools/personal.css' },
    { js: '../shared/tools/personal-core.js' },
    { js: '../shared/tools/personal-zh-hk.js' },
    { js: '../shared/tools/personal-school.js' },
    { js: '../shared/tools/personal-name.js' },
    { js: '../shared/tools/personal-adhd.js' },
    { js: '../shared/tools/personal-color.js' },
    { js: '../shared/tools/personal-appearance.js' },
    { js: '../shared/tools/personal-logo.js' },
    { js: '../shared/tools/personal-schedule.js' },
    { js: '../shared/tools/dev-tools-zh-hk.js' },
    { js: '../shared/tools/dev-tools-typegen.js' },
    { js: '../shared/tools/dev-tools-chart.js' },
    { js: '../shared/tools/dev-tools-studio.js' },
    { js: '../shared/tools/dev-tools-live.js', only: 'manager' }
  ];
  function loadFiles(list) {
    const next = list.shift(); if (!next) return;
    if (next.only && (!APP || ![].concat(next.only).includes(APP[1]))) return loadFiles(list);
    if (next.css) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = next.css; document.head.append(l); return loadFiles(list); }
    const s = document.createElement('script'); s.src = next.js;
    s.onload = s.onerror = () => loadFiles(list);
    document.head.append(s);
  }
  if (document.readyState !== 'loading') setTimeout(() => loadFiles(FILES.slice()), 0); else document.addEventListener('DOMContentLoaded', () => loadFiles(FILES.slice()));

  window.MVLTools = { register, open, list: () => [...tools.values()].map((t) => ({ id: t.id, title: t.title, group: t.group })) };
})();
