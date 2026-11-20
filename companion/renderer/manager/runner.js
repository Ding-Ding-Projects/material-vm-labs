'use strict';
// self-hosted runner hosting assist for the manager: pick a private repository, pick a Windows machine, name the labels,
// then host it. The real work (private check, registration token, install, online check) runs in the main process;
// this file only shows the steps and their true states. The registration token never reaches the renderer.
(function () {
  const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9._-]{1,100}$/;
  const LABEL_RE = /^[A-Za-z0-9._-]{1,50}$/;
  const STEPS = ['repository', 'Machine', 'Name and labels', 'Host it'];
  const PROGRESS = [['private', 'Private check'], ['token', 'Registration token'], ['install', 'Installed'], ['online', 'Online']];
  const WORD = { '': 'Waiting', run: 'Working', ok: 'Done', fail: 'Failed' };
  const DOT = { '': '', run: 'cyan', ok: 'lime', fail: 'red' };

  function create(ctx) {
    const { state, $, esc, makeSearch, toast, api, key, panel } = ctx;
    const W = { step: 0, repo: '', machine: '', labels: 'self-hosted, windows, material-vm-labs', repos: null, reposErr: '', reposWarn: [], loadingRepos: false, gh: null, ghChecked: false,
      steps: null, hosting: false, done: false, failedStep: '', wf: null, wfBusy: false, wfMsg: '' };

    const labelList = () => String(W.labels).split(',').map((x) => x.trim()).filter(Boolean);
    const labelsOk = () => { const l = labelList(); return l.length > 0 && l.every((x) => LABEL_RE.test(x)) && l.join(',').length <= 200; };
    const machines = () => state.machines || [];
    const machineObj = () => machines().find((m) => key(m.Name) === key(W.machine));
    const isLinux = (m) => !!(m && m.OS && m.OS !== 'windows');
    const valid = (i) => (i === 0 ? REPO_RE.test(W.repo) : i === 1 ? !!machineObj() && !isLinux(machineObj()) : i === 2 ? labelsOk() : true);
    const reachable = (i) => { for (let k = 0; k < i; k++) if (!valid(k)) return false; return true; };
    const dutyCount = (repo) => { let n = 0; for (const meta of Object.values(state.metas || {})) for (const r of (meta.runners || [])) if (r.repo === repo) n++; return n; };

    const repoSearch = makeSearch({ placeholder: 'Filter private repositories', label: 'Filter private repositories', onChange: () => renderRepoList() });
    const machSearch = makeSearch({ placeholder: 'Filter machines by name, project or system', label: 'Filter machines', onChange: () => renderMachineList() });
    const dutySearch = makeSearch({ placeholder: 'Search the self-hosted runners on duty', label: 'Search the self-hosted runners on duty', onChange: () => renderDuty() });

    panel.innerHTML = `<div class="gh-top"><span class="chip" id="ghChip" role="status"></span><button type="button" class="btn sm" id="ghRecheck">Check GitHub sign-in</button></div>
<section class="card gh-card" id="ghAssist" aria-label="Host a self-hosted runner"></section>
<section class="gh-duty" aria-labelledby="ghDutyH"><div class="row" style="align-items:baseline"><h2 id="ghDutyH" style="margin:0;font-size:22px">self-hosted runners on duty</h2><span class="small" id="ghDutyN"></span><span class="grow"></span><button type="button" class="btn sm" id="ghLive">Check live state</button></div><div class="small" id="ghLiveMsg" role="status"></div><div class="gh-dutylist" id="ghDuty"></div></section>`;
    const assist = $('#ghAssist', panel);

    // ---------- GitHub sign-in ----------
    function renderChip() {
      const c = $('#ghChip', panel);
      if (!W.ghChecked) { c.innerHTML = '<i></i>Checking GitHub sign-in'; return; }
      c.innerHTML = W.gh && W.gh.ok ? `<i class="on"></i>gh signed in · ${esc(W.gh.login)}` : `<i class="bad"></i>${esc((W.gh && W.gh.error) || 'GitHub sign-in unknown')}`;
    }
    async function checkGh() {
      W.ghChecked = false; renderChip();
      W.gh = await api.ghStatus();
      W.ghChecked = true; renderChip();
      if (W.gh.ok && W.repos === null) loadRepos();
      render();
    }
    $('#ghRecheck', panel).addEventListener('click', checkGh);

    async function loadRepos() {
      if (W.loadingRepos) return;
      W.loadingRepos = true; W.reposErr = ''; renderRepoList();
      const r = await api.ghRepos();
      W.loadingRepos = false;
      if (r.ok) { W.repos = r.repos; W.reposWarn = r.warnings || []; } else { W.repos = null; W.reposErr = r.error; }
      renderRepoList();
    }

    // ---------- the assist ----------
    function render() {
      const tabs = STEPS.map((l, i) => `<button type="button" class="gh-tab" role="tab" id="ghtab-${i}" aria-selected="${W.step === i}" aria-controls="ghpanel" tabindex="${W.step === i ? 0 : -1}" data-step="${i}" ${reachable(i) && !W.hosting ? '' : 'disabled'}><span class="n">${i + 1}</span>${esc(l)}</button>`).join('');
      assist.innerHTML = `<div class="gh-tabs" role="tablist" aria-label="self-hosted runner steps">${tabs}</div><div class="gh-body gh-rise" id="ghpanel" role="tabpanel" aria-labelledby="ghtab-${W.step}">${body()}</div><div class="gh-foot" id="ghFoot"></div>`;
      mountBody(); renderFoot();
    }
    function body() {
      if (W.step === 0) return `<h2 tabindex="-1" data-h>Which private repository?</h2><p class="small">Only private repositories are listed. A self-hosted runner never serves a public repository.</p><div data-slot="rs"></div><div id="ghRepoList" class="gh-list"></div>`;
      if (W.step === 1) return `<h2 tabindex="-1" data-h>Which lab machine hosts it?</h2><p class="small">Only Windows machines can host a self-hosted runner.</p><div data-slot="ms"></div><div id="ghMachList" class="gh-list"></div><div class="row"><button type="button" class="btn" id="ghCreate">+ Create a fresh one for it</button><span class="small">Opens the Create sheet set to Claude on Windows.</span></div>`;
      if (W.step === 2) {
        const l = labelList();
        return `<h2 tabindex="-1" data-h>Name and labels</h2><div class="row"><label class="field grow">self-hosted runner name<input class="mono" id="ghName" readonly value="mvl-${esc(W.machine)}" aria-describedby="ghNameNote"><span class="small" id="ghNameNote">Fixed: the CLI always names it mvl-&lt;machine&gt;.</span></label><label class="field grow">Labels, comma separated<input class="mono" id="ghLabels" value="${esc(W.labels)}" autocomplete="off" spellcheck="false" aria-describedby="ghLabelHint"><span class="small" id="ghLabelHint"></span></label></div><div class="gh-code"><span class="eyebrow">Put this in a workflow</span><code id="ghRuns">runs-on: [${esc(l.join(', '))}]</code></div>`;
      }
      return hostBody();
    }
    function hostBody() {
      const m = W.machine;
      return `<h2 tabindex="-1" data-h>${W.done ? 'The self-hosted runner is on duty' : 'Putting the self-hosted runner on duty'}</h2><p class="small">mvl-<b>${esc(m)}</b> for <b>${esc(W.repo)}</b> · labels ${esc(labelList().join(', '))}</p><div id="ghProg" class="gh-prog" aria-live="polite"></div><div id="ghAfter"></div>`;
    }
    function mountBody() {
      const slot = (n) => $(`[data-slot=${n}]`, assist);
      if (W.step === 0) { slot('rs').append(repoSearch.el); renderRepoList(); }
      if (W.step === 1) { slot('ms').append(machSearch.el); renderMachineList(); $('#ghCreate', assist).addEventListener('click', () => ctx.openCreate({ who: 'agent', os: 'windows' })); }
      if (W.step === 2) {
        const inp = $('#ghLabels', assist);
        const hint = () => { const ok = labelsOk(); $('#ghLabelHint', assist).textContent = ok ? '' : 'Use letters, digits, dot, dash and underscore, separated by commas.'; $('#ghLabelHint', assist).style.color = ok ? '' : 'var(--red)'; inp.setAttribute('aria-invalid', String(!ok)); $('#ghRuns', assist).textContent = `runs-on: [${labelList().join(', ')}]`; renderFoot(); };
        inp.addEventListener('input', () => { W.labels = inp.value; hint(); }); hint();
      }
      if (W.step === 3) { renderProgress(); renderAfter(); }
    }
    function renderFoot() {
      const f = $('#ghFoot', assist); if (!f) return;
      const last = W.step === 3;
      const canNext = valid(W.step);
      const hostBtn = W.hosting ? '<button type="button" class="btn danger" id="ghCancel">Cancel install</button>' : W.done ? '<button type="button" class="btn primary" id="ghAgain">Host another</button>' : `<button type="button" class="btn primary" id="ghHost">${W.failedStep ? 'Try again' : 'Host it'}</button>`;
      f.innerHTML = `<button type="button" class="btn" id="ghBack" ${W.step === 0 || W.hosting ? 'disabled' : ''}>Back</button><span class="grow"></span>${last ? hostBtn : `<button type="button" class="btn primary" id="ghNext" ${canNext ? '' : 'disabled'}>Next</button>`}`;
    }
    function go(i) { if (i < 0 || i > 3 || !reachable(i) || W.hosting) return; W.step = i; render(); const h = $('[data-h]', assist); if (h) h.focus(); }
    assist.addEventListener('click', (e) => {
      const t = e.target.closest('button'); if (!t || t.disabled) return;
      if (t.dataset.step) return go(Number(t.dataset.step));
      if (t.id === 'ghBack') return go(W.step - 1);
      if (t.id === 'ghNext') return go(W.step + 1);
      if (t.id === 'ghHost') return host();
      if (t.id === 'ghCancel') { api.cancel(jobId()); toast('Cancelling the install'); return; }
      if (t.id === 'ghAgain') { W.done = false; W.steps = null; W.failedStep = ''; W.wf = null; W.wfMsg = ''; W.step = 0; W.repo = ''; render(); return; }
      if (t.id === 'ghRefresh') return loadRepos();
      if (t.dataset.repo) { W.repo = t.dataset.repo; renderRepoList(); renderFoot(); return; }
      if (t.dataset.mach) { W.machine = t.dataset.mach; renderMachineList(); renderFoot(); return; }
      if (t.id === 'ghWfFind') return findWorkflows();
      if (t.dataset.wf) return runWorkflow(t.dataset.wf);
    });
    assist.addEventListener('keydown', (e) => {
      const tab = e.target.closest('[role=tab]'); if (!tab || !['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      const all = [0, 1, 2, 3].filter((i) => reachable(i) && !W.hosting); if (!all.length) return;
      const cur = all.indexOf(Number(tab.dataset.step));
      const next = e.key === 'Home' ? all[0] : e.key === 'End' ? all[all.length - 1] : all[(cur + (e.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length];
      go(next); const nt = $('#ghtab-' + next, assist); if (nt) nt.focus();
    });

    // ---------- step 1: repos ----------
    function renderRepoList() {
      const el = $('#ghRepoList', assist); if (!el || W.step !== 0) return;
      if (W.gh && !W.gh.ok) { el.innerHTML = `<div class="errbox" role="alert">${esc(W.gh.error)}</div>`; return; }
      if (W.loadingRepos || (W.repos === null && !W.reposErr)) { el.innerHTML = '<div class="small">Reading your private repositories from GitHub&hellip;</div>'; return; }
      if (W.reposErr) { el.innerHTML = `<div class="errbox" role="alert">${esc(W.reposErr)}</div><button type="button" class="btn sm" id="ghRefresh">Try again</button>`; return; }
      let list = W.repos;
      if (repoSearch.invalid()) { el.innerHTML = '<div class="errbox">That regex pattern is not valid, so nothing was filtered.</div>'; return; }
      if (repoSearch.active()) { list = list.filter((r) => repoSearch.test(r.nameWithOwner + ' ' + r.description)); repoSearch.setStatus(list.length + ' of ' + W.repos.length + ' repositories'); }
      const warn = W.reposWarn.length ? `<div class="warn">${esc(W.reposWarn.join(' · '))}</div>` : '';
      const rows = list.map((r) => { const n = dutyCount(r.nameWithOwner); return `<button type="button" class="gh-opt" data-repo="${esc(r.nameWithOwner)}" aria-pressed="${W.repo === r.nameWithOwner}"><span class="mono">${esc(r.nameWithOwner)}</span><span class="small">${esc(r.description || 'no description')}</span><span class="pill ${n ? 'amber' : 'cyan'}">${n ? n + ' self-hosted runner' + (n === 1 ? '' : 's') + ' here' : 'private'}</span></button>`; }).join('');
      el.innerHTML = warn + (rows || '<div class="empty"><h2>No private repository matches</h2><p>Try fewer words, or switch search mode.</p></div>') + '<button type="button" class="btn sm" id="ghRefresh">Reload the list</button>';
    }

    // ---------- step 2: machines ----------
    function renderMachineList() {
      const el = $('#ghMachList', assist); if (!el || W.step !== 1) return;
      if (state.machines === null) { el.innerHTML = '<div class="small">Loading machines&hellip;</div>'; return; }
      let list = machines();
      if (machSearch.invalid()) { el.innerHTML = '<div class="errbox">That regex pattern is not valid, so nothing was filtered.</div>'; return; }
      if (machSearch.active()) { list = list.filter((m) => machSearch.test([m.Name, m.Project, m.OS === 'windows' || !m.OS ? 'Windows 11' : m.OS, m.Hypervisor].join(' '))); machSearch.setStatus(list.length + ' of ' + machines().length + ' machines'); }
      if (!machines().length) { el.innerHTML = '<div class="empty"><h2>No machines yet</h2><p>Create a fresh Windows machine for the self-hosted runner.</p></div>'; return; }
      el.innerHTML = list.map((m) => {
        const lin = isLinux(m); const n = Number(m.Runners) || 0;
        const sys = lin ? m.OS : 'Windows 11';
        return `<button type="button" class="gh-opt" data-mach="${esc(m.Name)}" aria-pressed="${key(W.machine) === key(m.Name)}" ${lin ? 'disabled' : ''}><span class="mono">${esc(m.Name)}</span><span class="small">${esc([m.Project, sys, m.Power === 'running' ? 'running' : 'off'].filter(Boolean).join(' · '))}${n ? ' · ' + n + ' self-hosted runner on duty' : ''}</span><span class="pill ${lin ? 'red' : 'lime'}">${lin ? 'Windows only for self-hosted runners' : esc(m.Status === 'ready' ? 'ready' : m.Status || 'unknown')}</span></button>`;
      }).join('') || '<div class="empty"><h2>No machine matches</h2><p>Try fewer words, or switch search mode.</p></div>';
    }

    // ---------- step 4: hosting ----------
    const jobId = () => 'gh-' + String(W.machine).toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 40);
    function renderProgress() {
      const el = $('#ghProg', assist); if (!el) return;
      el.innerHTML = PROGRESS.map(([id, label]) => {
        const s = (W.steps && W.steps[id]) || { state: '', detail: '' };
        return `<div class="run"><span class="dot ${DOT[s.state]}" aria-hidden="true"></span><span class="what">${esc(label)}${s.detail ? `<br><span class="small" style="font-family:var(--font,inherit)">${esc(s.detail)}</span>` : ''}</span><span class="verdict" style="color:${s.state === 'fail' ? 'var(--red)' : s.state === 'ok' ? 'var(--lime-text)' : 'var(--mute)'}">${WORD[s.state]}</span></div>`;
      }).join('');
    }
    function renderAfter() {
      const el = $('#ghAfter', assist); if (!el) return;
      if (!W.done) { el.innerHTML = ''; return; }
      const wfs = W.wf;
      el.innerHTML = `<div class="gh-test"><h3 style="margin:0">Optional: run a test workflow</h3><p class="small" style="margin:0">Looks in ${esc(W.repo)} for a workflow that can be started by hand. It runs on whichever runner its runs-on line names.</p><div><button type="button" class="btn sm" id="ghWfFind" ${W.wfBusy ? 'disabled' : ''}>${W.wfBusy ? 'Looking&hellip;' : 'Look for a test workflow'}</button></div>${W.wfMsg ? `<div class="small" role="status">${esc(W.wfMsg)}</div>` : ''}${wfs ? wfs.map((w) => `<div class="run"><span class="what">${esc(w.name)}<br><span class="small">${esc(w.path)}</span></span><button type="button" class="btn sm" data-wf="${esc(w.path)}" ${W.wfBusy ? 'disabled' : ''}>Run it</button></div>`).join('') : ''}</div>`;
    }
    async function host() {
      if (W.hosting || !valid(0) || !valid(1) || !valid(2)) return;
      const name = machineObj().Name, repo = W.repo, labels = labelList().join(',');
      W.machine = name; W.hosting = true; W.done = false; W.failedStep = ''; W.wf = null; W.wfMsg = '';
      W.steps = {}; state.busy.add(key(name));
      render();
      const r = await api.runnerHost({ name, repo, labels });
      state.busy.delete(key(name));
      W.hosting = false;
      if (r.ok) { W.done = true; toast('The self-hosted runner is online'); checkLive(); }
      else { W.failedStep = r.step || 'private'; if (!W.steps[W.failedStep] || W.steps[W.failedStep].state !== 'fail') W.steps[W.failedStep] = { state: 'fail', detail: r.error || 'Failed' }; }
      render();
      ctx.refreshMachines();
    }
    api.onRunnerStep((p) => {
      if (!p || !W.hosting || key(p.name) !== key(W.machine)) return;
      if (!W.steps) W.steps = {};
      W.steps[p.step] = { state: p.state, detail: p.detail };
      renderProgress();
    });
    async function findWorkflows() {
      W.wfBusy = true; W.wf = null; W.wfMsg = ''; renderAfter();
      const r = await api.runnerWorkflows(W.repo);
      W.wfBusy = false;
      if (!r.ok) W.wfMsg = r.error; else { W.wf = r.workflows; W.wfMsg = r.workflows.length ? '' : (r.total ? `None of the ${r.total} workflow${r.total === 1 ? '' : 's'} in ${W.repo} lists workflow_dispatch, so none can be started by hand. Add it to a workflow to test this self-hosted runner.` : `${W.repo} has no workflows yet. Add one with runs-on: [${labelList().join(', ')}] and workflow_dispatch to test this self-hosted runner.`); }
      renderAfter();
    }
    async function runWorkflow(path) {
      W.wfBusy = true; W.wfMsg = 'Starting ' + path + '…'; renderAfter();
      const r = await api.runnerRunWorkflow(W.repo, path);
      W.wfBusy = false;
      W.wfMsg = r.ok ? (r.url ? 'Started. The run page opened in your browser: ' + r.url : (r.note || 'Started.')) : r.error;
      renderAfter();
    }

    // ---------- on duty ----------
    function dutyRows() {
      const rows = [];
      for (const m of machines()) {
        const n = Number(m.Runners) || 0; if (!n) continue;
        const rs = ((state.metas || {})[key(m.Name)] || {}).runners || [];
        if (rs.length) for (const r of rs) rows.push({ machine: m.Name, repo: r.repo || '', labels: r.labels || '' });
        else rows.push({ machine: m.Name, repo: '', labels: '', count: n });
      }
      return rows;
    }
    function renderDuty() {
      const el = $('#ghDuty', panel); if (!el) return;
      if (state.machines === null) { el.innerHTML = '<div class="small">Loading machines&hellip;</div>'; return; }
      let rows = dutyRows(); const total = rows.length;
      if (dutySearch.invalid()) { el.innerHTML = '<div class="errbox">That regex pattern is not valid, so nothing was filtered.</div>'; return; }
      if (dutySearch.active()) { rows = rows.filter((r) => dutySearch.test(`${r.machine} ${r.repo} ${r.labels}`)); dutySearch.setStatus(rows.length + ' of ' + total + ' self-hosted runners'); }
      $('#ghDutyN', panel).textContent = total ? total + ' registered' : '';
      const LIVE = { online: ['lime', 'Online'], offline: ['red', 'Offline'], missing: ['red', 'Not on GitHub'] };
      el.innerHTML = rows.length ? rows.map((r) => { const st = liveOf(r); const [c, w] = LIVE[st] || ['amber', 'Not checked']; return `<div class="run"><span class="dot ${c}" aria-hidden="true"></span><span class="what">${esc(r.repo || (r.count + ' registered, repository unknown'))}<br><span class="small">mvl-${esc(r.machine)}${r.labels ? ' · ' + esc(r.labels) : ''}</span></span><span class="verdict small" style="color:${c === 'lime' ? 'var(--lime-text)' : c === 'red' ? 'var(--red)' : 'var(--mute)'}">${w}</span>${r.repo ? `<button type="button" class="btn sm danger" data-rm="${esc(r.repo)}" data-m="${esc(r.machine)}" aria-label="Remove the self-hosted runner for ${esc(r.repo)} from ${esc(r.machine)}">Remove</button>` : ''}</div>`; }).join('') : `<div class="empty"><h2>${total ? 'No self-hosted runner matches' : 'No self-hosted runner on duty'}</h2><p>${total ? 'Try fewer words, or switch search mode.' : 'Use the steps above to put one to work.'}</p></div>`;
    }
    // Live state comes only from GitHub's runner list; until it is read every row says Not checked.
    function liveOf(r) { const m = r.repo && W.live && W.live[r.repo]; if (!m) return ''; return m['mvl-' + r.machine] || 'missing'; }
    async function checkLive() {
      const repos = [...new Set(dutyRows().map((r) => r.repo).filter(Boolean))];
      const msg = $('#ghLiveMsg', panel); const btn = $('#ghLive', panel);
      if (!repos.length) { if (msg) msg.textContent = ''; return; }
      if (!api.runnerLive) { if (msg) msg.textContent = 'This build cannot read live state.'; return; }
      W.liveBusy = true; if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }
      try {
        const r = await api.runnerLive(repos);
        W.live = Object.assign({}, W.live || {}, r.repos || {});
        const t = new Date(r.checked || Date.now()); const hh = String(t.getHours()).padStart(2, '0'), mm = String(t.getMinutes()).padStart(2, '0');
        if (msg) msg.textContent = (r.errors && r.errors.length) ? 'Some repositories could not be read: ' + r.errors.join('; ') : `Checked with GitHub at ${hh}:${mm}.`;
      } catch (e) { if (msg) msg.textContent = 'Live state could not be read: ' + (e && e.message || e); }
      W.liveBusy = false; if (btn) { btn.disabled = false; btn.textContent = 'Check live state'; }
      renderDuty();
    }
    $('#ghLive', panel).addEventListener('click', () => { if (!W.liveBusy) checkLive(); });
    $('#ghDuty', panel).addEventListener('click', async (e) => {
      const b = e.target.closest('[data-rm]'); if (!b) return;
      const ok = await ctx.confirmSheet({ title: 'Remove this self-hosted runner?', body: `mvl-${b.dataset.m} stops serving ${b.dataset.rm}. The repository keeps its other runners.`, label: 'Remove it', danger: true });
      if (ok) ctx.startJob(`Remove self-hosted runner ${b.dataset.rm} from ${b.dataset.m}`, 'runner-rm', { name: b.dataset.m, repo: b.dataset.rm }, { hold: key(b.dataset.m) });
    });

    // The dutySearch sits in the page header; the caller places it.
    function update() { renderDuty(); if (W.step === 1) renderMachineList(); if (W.step === 0) renderRepoList(); if (!machineObj() && W.machine && !W.hosting && W.step < 3) { W.machine = ''; renderFoot(); } }
    function show() { if (!W.liveBusy && !W.liveShown) { W.liveShown = true; checkLive(); } if (!W.ghChecked) checkGh(); else if (W.gh && W.gh.ok && W.repos === null && !W.loadingRepos) loadRepos(); }
    renderChip(); render(); renderDuty();
    return { update, show, dutySearch };
  }

  window.MVLRunner = { create };
})();
