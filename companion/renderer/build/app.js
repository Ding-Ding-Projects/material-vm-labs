'use strict';
(function () {
  MVL.initTheme();
  const api = window.mvlBuild;
  MvlBuildPanel.mount(document.getElementById('bayRoot'), api, { rail: document.getElementById('rail') });
  const esc = MVL.esc;

  // The build wizard listens to the same build state stream as the panel; the panel keeps working underneath.
  const stateListeners = new Set();
  api.onState((s) => { for (const f of stateListeners) f(s); });

  const setup = window.MVLOnboarding.create({
    id: 'build', app: 'Material VM Labs Build', subtitle: 'First-run setup', finishLabel: 'Open the build view',
    skipHint: () => 'Skipped. Start a build any time from the rail.',
    steps: [
      { id: 'welcome', label: 'Welcome', note: 'What it does', info: true, title: 'Real builds from your checkout',
        intro: 'This runs the root build.bat and build-installer.bat of the checkout, shows each phase as it reports, and keeps the full log. Nothing is simulated.',
        render(body) { body.innerHTML = '<div class="onb-tiles"><div class="onb-tile"><strong>Build</strong><span class="small">Runs build.bat /s.</span></div><div class="onb-tile"><strong>Build and run</strong><span class="small">Builds, then opens mvl.bat tui.</span></div><div class="onb-tile"><strong>Installer</strong><span class="small">Makes an unsigned Squirrel.Windows installer.</span></div></div>'; } },
      { id: 'repo', label: 'Repository', note: 'Required check', title: 'Confirm the repository',
        intro: 'Builds run in the checkout this app found. Make sure it is the one you mean.',
        render(body, ctx) {
          body.innerHTML = '<div class="onb-rows" data-rows><div><span class="pill cyan">Checking</span><span class="grow small">Looking for the checkout...</span></div></div><div class="row"><button type="button" class="btn primary" data-ok disabled>This is the right checkout</button><button type="button" class="btn" data-again>Check again</button></div>';
          const rows = body.querySelector('[data-rows]'), ok = body.querySelector('[data-ok]');
          const check = async () => {
            ok.disabled = true;
            rows.innerHTML = '<div><span class="pill cyan">Checking</span><span class="grow small">Looking for the checkout...</span></div>';
            let i;
            try { i = await api.info(); } catch (e) { i = { repo: '', repoNote: (e && e.message) || String(e) }; }
            ctx.data.repo = i.repo || ''; ctx.save();
            if (!rows.isConnected) return;
            if (i.repo) {
              rows.innerHTML = `<div><span class="pill lime">Found</span><span class="grow"><strong class="mono">${esc(i.repo)}</strong><br><span class="small">${esc(i.repoNote || '')}${i.embedded ? esc(' This app embeds ' + i.embedded.files + ' tracked files of commit ' + String(i.embedded.commit).slice(0, 12) + '.') : ''}</span></span></div>`;
              ok.disabled = false;
              if (ctx.result && ctx.result.status === 'ok' && ctx.data.confirmed !== i.repo) ctx.setResult('stale', 'The checkout changed since you confirmed it. Confirm it again.');
            } else {
              rows.innerHTML = `<div><span class="pill red">Not found</span><span class="grow small">${esc('No checkout is available, so builds are disabled. ' + (i.repoNote || ''))}</span></div>`;
              ctx.setResult('fail', 'No checkout found: ' + (i.repoNote || 'builds are disabled') + '. Open this app from a checkout, then check again.');
            }
          };
          ok.addEventListener('click', () => { ctx.data.confirmed = ctx.data.repo; ctx.save(); ctx.setResult('ok', 'Builds run in ' + ctx.data.repo + '.'); });
          body.querySelector('[data-again]').addEventListener('click', check);
          check();
        } },
      { id: 'first', label: 'First build', optional: true, title: 'Run a first build',
        intro: 'Runs build.bat /s in the confirmed checkout. It can take several minutes; you can finish setup while it runs and watch it in the build view.',
        render(body, ctx) {
          body.innerHTML = '<div class="row"><button type="button" class="btn primary" data-go>Start the build</button></div>';
          const go = body.querySelector('[data-go]');
          const r = ctx.result;
          if (r && r.status === 'run') go.disabled = true;
          if (r && (r.status === 'fail' || r.status === 'stale')) go.textContent = 'Try again';
          if (r && r.status === 'ok') go.textContent = 'Build again';
          go.addEventListener('click', async () => {
            go.disabled = true;
            ctx.setResult('run', 'Starting build.bat /s...');
            const onState = (s) => {
              if (s.state === 'running') { ctx.setResult('run', 'Building. The live log is in the build view underneath.'); return; }
              stateListeners.delete(onState);
              const msg = (s.message || '') + ' (exit ' + (s.code == null ? 'none' : s.code) + ' after ' + s.seconds + ' s)';
              ctx.setResult(s.state === 'succeeded' ? 'ok' : 'fail', s.state === 'succeeded' ? 'The build succeeded. ' + msg : s.state === 'cancelled' ? 'The build was cancelled and is incomplete. ' + msg : 'The build failed. ' + msg);
              if (go.isConnected) { go.disabled = false; go.textContent = s.state === 'succeeded' ? 'Build again' : 'Try again'; }
            };
            stateListeners.add(onState);
            let res;
            try { res = await api.start('build'); } catch (e) { res = { ok: false, error: (e && e.message) || String(e) }; }
            if (!res || !res.ok) {
              stateListeners.delete(onState);
              ctx.setResult('fail', 'The build could not start: ' + ((res && res.error) || 'no detail'));
              go.disabled = false; go.textContent = 'Try again';
            }
          });
        } }
    ],
    onFinish: () => { const g = document.querySelector('[data-go]'); if (g) g.focus(); }
  });

  document.getElementById('settingsBtn').addEventListener('click', () => {
    MVL.settingsDialog();
    const dlg = document.getElementById('settingsDialog');
    if (dlg && !dlg.querySelector('[data-setup-again]')) {
      const sec = document.createElement('section');
      sec.className = 'dlg-sec';
      sec.innerHTML = '<h3>Setup</h3><p class="small">Confirm the checkout again or run a first build.</p><button type="button" class="btn sm" data-setup-again>Run setup again</button>';
      sec.querySelector('[data-setup-again]').addEventListener('click', () => { dlg.close(); setup.start(true); });
      const closeRow = dlg.querySelector('[data-close]');
      const at = closeRow && closeRow.closest('.row, div');
      if (at && at.parentElement === dlg) dlg.insertBefore(sec, at); else dlg.append(sec);
    }
  });
  if (window.MVLPalette) window.MVLPalette.register({ title: 'Run setup again', hint: 'First-run setup', keywords: ['onboarding', 'wizard', 'setup'], run: () => setup.start(true) });
  setup.startIfNeeded();
})();
