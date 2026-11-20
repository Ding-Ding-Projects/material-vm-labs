'use strict';
(function () {
  MVL.initTheme();
  const reader = MvlDocsReader.mount(document.getElementById('reader'), window.mvlDocs, { rail: document.getElementById('rail') });
  const esc = MVL.esc;

  // First-run setup: pick the task to start with; finishing opens that article.
  const setup = window.MVLOnboarding.create({
    id: 'docs', app: 'Material VM Labs Docs', subtitle: 'First-run setup', finishLabel: 'Open the documentation',
    skipHint: () => 'Skipped. The documentation opens on Start here.',
    steps: [
      { id: 'welcome', label: 'Welcome', note: 'What is here', info: true, title: 'Everything is bundled offline',
        intro: 'These docs ship inside the app, so they match this version and work without a network. Search covers every article, with plain text or a regex.',
        render(body) { body.innerHTML = '<div class="onb-tiles"><div class="onb-tile"><strong>Tasks</strong><span class="small">Step-by-step guides grouped by what you want to do.</span></div><div class="onb-tile"><strong>Search</strong><span class="small">Press / to search every article. The regex button builds a pattern.</span></div><div class="onb-tile"><strong>Commands</strong><span class="small">Ctrl+Shift+F opens the command palette.</span></div></div>'; } },
      { id: 'task', label: 'Starting task', optional: true, title: 'Pick a starting task',
        intro: 'Choose the article you want open first. You can change it any time from the navigation rail.',
        render(body, ctx) {
          body.innerHTML = '<div class="onb-pick" role="radiogroup" aria-label="Starting task" data-list><p class="small">Loading the bundled documentation...</p></div><div class="errbox" data-err hidden></div><div class="row" data-retryrow hidden><button type="button" class="btn" data-retry>Try again</button></div>';
          const list = body.querySelector('[data-list]'), err = body.querySelector('[data-err]');
          const draw = (d) => {
            if (!list.isConnected) return;
            if (!d.docs.length) {
              list.innerHTML = '';
              err.hidden = false; err.textContent = d.error ? 'Could not load the bundled documentation: ' + d.error : 'No documentation is bundled in this build.';
              body.querySelector('[data-retryrow]').hidden = false;
              ctx.setResult('fail', err.textContent);
              return;
            }
            err.hidden = true; body.querySelector('[data-retryrow]').hidden = true;
            const docs = d.docs.filter((x) => x.categoryKey !== '_root');
            let group = null, h = '';
            for (const x of docs) {
              if (x.category !== group) { group = x.category; h += `<div class="onb-group">${esc(group)}</div>`; }
              h += `<button type="button" role="radio" data-id="${esc(x.id)}" aria-checked="${ctx.data.id === x.id}" tabindex="-1"><span>${esc(x.title)}</span><span class="small">${esc(x.summary || '')}</span></button>`;
            }
            list.innerHTML = h;
            const radios = [...list.querySelectorAll('[role=radio]')];
            (radios.find((r) => r.getAttribute('aria-checked') === 'true') || radios[0]).tabIndex = 0;
          };
          const pick = (b) => {
            for (const r of list.querySelectorAll('[role=radio]')) { r.setAttribute('aria-checked', String(r === b)); r.tabIndex = r === b ? 0 : -1; }
            ctx.data.id = b.dataset.id; ctx.data.title = b.querySelector('span').textContent; ctx.save();
            ctx.setResult('ok', 'Starts on ' + ctx.data.title + '.');
          };
          list.addEventListener('click', (e) => { const b = e.target.closest('[role=radio]'); if (b) pick(b); });
          list.addEventListener('keydown', (e) => {
            const rs = [...list.querySelectorAll('[role=radio]')]; const i = rs.indexOf(document.activeElement); if (i < 0) return;
            const d = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
            if (d) { e.preventDefault(); const n = rs[(i + d + rs.length) % rs.length]; pick(n); n.focus(); }
            if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); pick(rs[i]); }
          });
          body.querySelector('[data-retry]').addEventListener('click', () => { list.innerHTML = '<p class="small">Loading the bundled documentation...</p>'; reader.reload().then(draw); });
          reader.loaded().then(draw);
        } }
    ],
    onFinish: (results, data) => {
      const id = data.task && data.task.id;
      if (results.task && results.task.status === 'ok' && id) reader.go('#/doc/' + encodeURIComponent(id));
      else reader.go('#/');
    }
  });

  // Settings carries "Run setup again".
  document.getElementById('settingsBtn').addEventListener('click', () => {
    MVL.settingsDialog();
    const dlg = document.getElementById('settingsDialog');
    if (dlg && !dlg.querySelector('[data-setup-again]')) {
      const sec = document.createElement('section');
      sec.className = 'dlg-sec';
      sec.innerHTML = '<h3>Setup</h3><p class="small">Pick a different starting task, or read the welcome again.</p><button type="button" class="btn sm" data-setup-again>Run setup again</button>';
      sec.querySelector('[data-setup-again]').addEventListener('click', () => { dlg.close(); setup.start(true); });
      const closeRow = dlg.querySelector('[data-close]');
      const at = closeRow && closeRow.closest('.row, div');
      if (at && at.parentElement === dlg) dlg.insertBefore(sec, at); else dlg.append(sec);
      // History, exports and the changelog (shared/tools/manager-p1-*.js), when this build loads them.
      if (window.MVLHistory || window.MVLChangelog) {
        const more = document.createElement('section');
        more.className = 'dlg-sec';
        more.innerHTML = '<h3>History, exports and changelog</h3><p class="small">Every settings change is kept on this device with undo, redo and restore. Export your settings, or read what changed in each version.</p><div class="row"><button type="button" class="btn sm" data-p1="history">Settings history</button><button type="button" class="btn sm" data-p1="export">Export settings</button><button type="button" class="btn sm" data-p1="changelog">Changelog</button></div>';
        for (const b of more.querySelectorAll('[data-p1]')) b.hidden = b.dataset.p1 === 'changelog' ? !window.MVLChangelog : !window.MVLHistory;
        more.addEventListener('click', (e) => {
          const b = e.target.closest('[data-p1]'); if (!b) return;
          dlg.close(); // the sheets open above the page, so the modal settings dialog steps aside first
          if (b.dataset.p1 === 'export') window.MVLHistory.exportSettings();
          else if (b.dataset.p1 === 'history') window.MVLHistory.open(); else window.MVLChangelog.open();
        });
        dlg.insertBefore(more, sec);
      }
    }
  });
  if (window.MVLPalette) window.MVLPalette.register({ title: 'Run setup again', hint: 'First-run setup', keywords: ['onboarding', 'wizard', 'setup'], run: () => setup.start(true) });
  setup.startIfNeeded();
})();
