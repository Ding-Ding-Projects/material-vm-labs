'use strict';
// Regex workbench (Tools > Developer tools). Construction from tokens with a plain-English
// explanation tree, flags, live testing with match and capture highlighting, replace preview,
// split, a step debugger, a time-limited benchmark, a local library with parameters, flavour notes
// and conversion, code generation, read-only GREP over pasted text or picked files, history and
// export/import. Every pattern runs in regex-worker.js under a time budget, so catastrophic
// backtracking stops the worker, never the interface. Each search field that opens the workbench
// gets its own session; nothing is shared between fields.
(function () {
  const R = window.MVLRegex;
  if (!R || !window.MVLTools) return;
  const SRC = document.currentScript && document.currentScript.src;
  const WORKER_URL = SRC ? new URL('regex-worker.js', SRC).href : '../shared/tools/regex-worker.js';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch { /* storage may be unavailable */ } }
  };
  const LIB_KEY = 'mvl-regex-library-v1', HIST_KEY = 'mvl-regex-history-v1', HIST_ON = 'mvl-regex-history-keep';
  const ENGINE = R.engineInfo();

  const BUILTIN = [
    { id: 'b-date', builtin: true, name: 'ISO date', description: 'A calendar date written as year-month-day, captured by name.', pattern: '\\b(?<year>\\d{4})-(?<month>0[1-9]|1[0-2])-(?<day>0[1-9]|[12]\\d|3[01])\\b', flags: 'g', replacement: '$<day>/$<month>/$<year>', tests: [{ text: '2026-11-20', expect: true }, { text: '2026-13-01', expect: false }] },
    { id: 'b-ipv4', builtin: true, name: 'IPv4 address', description: 'Four numbers from 0 to 255 separated by dots.', pattern: '\\b(?:(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\b', flags: 'g', replacement: '', tests: [{ text: '192.0.2.10', expect: true }, { text: '256.1.1.1', expect: false }] },
    { id: 'b-dup', builtin: true, name: 'Repeated word', description: 'The same word twice in a row, found with a backreference.', pattern: '\\b(\\w+)\\s+\\1\\b', flags: 'gi', replacement: '$1', tests: [{ text: 'the the cat', expect: true }, { text: 'the cat', expect: false }] },
    { id: 'b-trail', builtin: true, name: 'Trailing whitespace', description: 'Spaces or tabs at the end of each line.', pattern: '[ \\t]+$', flags: 'gm', replacement: '', tests: [{ text: 'line  ', expect: true }, { text: 'line', expect: false }] },
    { id: 'b-hex', builtin: true, name: 'Hex colour', description: 'A CSS colour such as #6750A4 or #fff.', pattern: '#(?:[0-9a-f]{3}){1,2}\\b', flags: 'gi', replacement: '', tests: [{ text: '#6750A4', expect: true }, { text: '#12', expect: false }] },
    { id: 'b-word', builtin: true, name: 'Whole word (parameter)', description: 'Finds a word you type when you use it. The %word% parameter is escaped so it is always literal.', pattern: '\\b%word%\\b', flags: 'gi', replacement: '', tests: [] }
  ];

  const T = (label, ins, help, opt) => Object.assign({ label, ins, help }, opt || {});
  const TOKENS = [
    ['Characters', [
      T('Any character', '.', 'Any single character except line breaks, or including them with the s flag.'),
      T('Digit', '\\d', 'A digit 0 to 9.'), T('Not a digit', '\\D', 'Any character except 0 to 9.'),
      T('Word character', '\\w', 'A to Z, a to z, 0 to 9 or underscore.'), T('Not a word character', '\\W', 'Any character except a word character.'),
      T('Whitespace', '\\s', 'Space, tab, line breaks and Unicode spaces.'), T('Not whitespace', '\\S', 'Any character except whitespace.'),
      T('Tab', '\\t', 'The tab character.'), T('Line feed', '\\n', 'The line feed (newline) character.'), T('Carriage return', '\\r', 'The carriage return character.'),
      T('Hex character', '\\x41', 'A character by two hex digits; \\x41 is "A".'), T('Code unit', '\\u00E9', 'A character by four hex digits; \\u00E9 is "e" with an acute accent.'),
      T('Code point', '\\u{1F600}', 'Any Unicode code point by hex value. Needs the u or v flag.', { needs: 'uv' }),
      T('Escape selection as literal', null, 'Escapes the selected text so every character is matched literally.', { action: 'escape' })
    ]],
    ['Classes', [
      T('Set', ['[', ']'], 'One character from the set. Wraps the selection.'), T('Negated set', ['[^', ']'], 'One character not in the set. Wraps the selection.'),
      T('Range', '[a-z]', 'One character in a range.'), T('Letter (Unicode)', '\\p{L}', 'Any letter in any script. Needs the u or v flag.', { needs: 'uv' }),
      T('Script', '\\p{Script=Han}', 'Characters of one script, here Han. Needs the u or v flag.', { needs: 'uv' }), T('Not a letter', '\\P{L}', 'Anything that is not a letter. Needs the u or v flag.', { needs: 'uv' }),
      T('Intersection', '[\\p{L}&&\\p{ASCII}]', 'Characters in both sets. Needs the v flag.', { needs: 'v' }), T('Subtraction', '[\\p{L}--[a-z]]', 'Characters in the first set but not the second. Needs the v flag.', { needs: 'v' }),
      T('String alternatives', '[\\q{abc|def}]', 'Whole strings inside a class. Needs the v flag.', { needs: 'v' })
    ]],
    ['Anchors', [
      T('Start', '^', 'Start of the text, or of a line with the m flag.'), T('End', '$', 'End of the text, or of a line with the m flag.'),
      T('Word boundary', '\\b', 'Between a word character and a non-word character.'), T('Not a word boundary', '\\B', 'Anywhere that is not a word boundary.')
    ]],
    ['Groups', [
      T('Capture group', ['(', ')'], 'Captures what it matches. Wraps the selection.'), T('Named group', ['(?<name>', ')'], 'Captures under a name. Wraps the selection.'),
      T('Group without capture', ['(?:', ')'], 'Groups without capturing. Wraps the selection.'), T('Or', '|', 'Alternation: either side may match.'),
      T('Modifier group', ['(?i:', ')'], 'Turns a flag on for part of the pattern.', { feature: 'modifiers' }),
      T('Atomic group', null, '', { off: 'The JavaScript engine has no atomic groups. Emulate one with (?=(...))\\1.' }),
      T('Conditional', null, '', { off: 'The JavaScript engine has no conditionals such as (?(1)yes|no).' }),
      T('Recursion or subroutine', null, '', { off: 'The JavaScript engine has no recursion or subroutine calls such as (?R) or (?1).' }),
      T('Balancing group', null, '', { off: 'Balancing groups are a .NET feature; the JavaScript engine has none.' }),
      T('Comment', null, '', { off: 'The JavaScript engine has no inline comments (?#...) or free-spacing mode.' })
    ]],
    ['Repeat', [
      T('Zero or more', '*', 'Repeat the previous item zero or more times.'), T('One or more', '+', 'Repeat the previous item one or more times.'),
      T('Optional', '?', 'The previous item zero or one time.'), T('Exactly n', '{2}', 'Exactly two times; edit the number.'),
      T('Between n and m', '{2,5}', 'Between two and five times.'), T('At least n', '{2,}', 'Two or more times.'),
      T('Lazy zero or more', '*?', 'As few as possible.'), T('Lazy one or more', '+?', 'As few as possible, at least one.'),
      T('Possessive', null, '', { off: 'The JavaScript engine has no possessive quantifiers such as a*+.' })
    ]],
    ['Lookaround', [
      T('Followed by', ['(?=', ')'], 'Lookahead. Wraps the selection.'), T('Not followed by', ['(?!', ')'], 'Negative lookahead. Wraps the selection.'),
      T('Preceded by', ['(?<=', ')'], 'Lookbehind. Wraps the selection.'), T('Not preceded by', ['(?<!', ')'], 'Negative lookbehind. Wraps the selection.')
    ]],
    ['Backreferences', [
      T('Group 1 again', '\\1', 'The text that group 1 captured.'), T('Named group again', '\\k<name>', 'The text that the named group captured.')
    ]]
  ];
  const TABS = [['build', 'Build'], ['test', 'Test'], ['replace', 'Replace'], ['split', 'Split'], ['debug', 'Debug'], ['bench', 'Benchmark'], ['compare', 'Compare'], ['code', 'Code'], ['library', 'Library'], ['grep', 'GREP'], ['history', 'History'], ['share', 'Export and import']];

  // ---------- sessions: one per origin, never shared ----------
  const sessions = new Map();
  function session(key, init) {
    let s = sessions.get(key);
    if (!s) {
      s = { key, label: (init && init.label) || 'Workbench', pattern: '', flags: 'g', subject: 'Order 2026-11-20 shipped to 192.0.2.10.\nThe the cat sat on the mat.\nCafé über naïve 😀 漢字', replacement: '', splitLimit: '', tests: [], tab: 'build', onApply: null, benchExtra: ['', ''], benchMiss: '', growth: { unit: 'a', prefix: '', suffix: '!' }, convertTo: 'python', codeLang: 'javascript', codeAction: 'all', debugFrom: 0, grepText: '', grepFiles: [], grepHist: [], undoSubject: null };
      sessions.set(key, s);
    }
    if (init) { if (init.pattern != null) s.pattern = init.pattern; if (init.flags != null) s.flags = R.normFlags(init.flags); if (init.onApply) s.onApply = init.onApply; if (init.label) s.label = init.label; }
    return s;
  }
  let activeKey = 'standalone';
  session('standalone', { label: 'Workbench' });
  let history = store.get(HIST_ON, false) ? store.get(HIST_KEY, []) : [];

  let root = null, ctx = null, runners = null, timers = {};
  const runner = (name) => { if (!runners[name]) runners[name] = R.createRunner(() => new Worker(WORKER_URL), { budgetMs: 1500 }); return runners[name]; };
  const S = () => sessions.get(activeKey);
  const q = (sel) => root.querySelector(sel);
  function later(name, fn, ms) { clearTimeout(timers[name]); timers[name] = setTimeout(fn, ms || 180); }
  function notify(msg, kind) { if (ctx) ctx.toast(msg, kind || 'info'); }
  async function copy(text, what) {
    try { await navigator.clipboard.writeText(text); notify((what || 'Text') + ' copied.', 'success'); }
    catch { notify('Copying is not available here. Select the text and copy it by hand.', 'error'); }
  }
  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: type || 'text/plain' }));
    a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    notify('Saved ' + name + ' to your downloads.', 'success');
  }
  function failText(res) { return res.timeout ? res.error : res.cancelled ? '' : (res.unavailable ? res.error : 'Could not run: ' + res.error); }

  // ---------- shell ----------
  function mount(el, c) {
    ctx = c; runners = {}; root = document.createElement('div');
    root.className = 'rxw';
    el.append(root);
    render();
  }
  function unmount() { for (const k in runners) runners[k].dispose(); runners = {}; for (const k in timers) clearTimeout(timers[k]); root = null; }

  function render() {
    const s = S();
    root.innerHTML = `
<div class="rxw-sessions" role="group" aria-label="Sessions">${[...sessions.values()].map((x) => `<button type="button" class="chipbtn rxw-chip" data-session="${esc(x.key)}" aria-pressed="${x.key === activeKey}">${esc(x.label)}</button>`).join('')}</div>
<div class="rxw-top">
  <label class="rxw-lab" for="rxw-pat">Pattern</label>
  <textarea id="rxw-pat" class="rxw-pat" rows="2" spellcheck="false" autocomplete="off" aria-describedby="rxw-valid" maxlength="${R.LIMITS.pattern}"></textarea>
  <div class="rxw-flags" role="group" aria-label="Flags">${R.FLAG_ORDER.split('').map((f) => `<button type="button" class="chipbtn rxw-flag" data-flag="${f}" aria-pressed="false" title="${esc(R.FLAG_INFO[f])}" aria-label="${f}: ${esc(R.FLAG_INFO[f])}" ${ENGINE.flags.includes(f) ? '' : 'disabled'}>${f}</button>`).join('')}</div>
  <p id="rxw-valid" class="rxw-valid" role="status" aria-live="polite"></p>
  <p class="rxw-engine small">Engine: ${esc(ENGINE.name)}, ${esc(ENGINE.version)}. Patterns run in an isolated worker with a time limit.</p>
  <div class="rxw-applyrow" ${s.onApply ? '' : 'hidden'}><button type="button" class="btn primary" data-act="apply">Use in ${esc(s.label)}</button></div>
</div>
<div class="rxw-tabs" role="tablist" aria-label="Workbench sections">${TABS.map(([id, label]) => `<button type="button" role="tab" class="rxw-tab" id="rxw-tab-${id}" data-tab="${id}" aria-controls="rxw-panel" aria-selected="${s.tab === id}" tabindex="${s.tab === id ? 0 : -1}">${label}</button>`).join('')}</div>
<section id="rxw-panel" class="rxw-panel" role="tabpanel" aria-labelledby="rxw-tab-${s.tab}" tabindex="0"></section>`;
    q('#rxw-pat').value = s.pattern;
    syncFlags();
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onChange);
    root.addEventListener('keydown', onKey);
    q('#rxw-pat').addEventListener('keyup', caretSync);
    q('#rxw-pat').addEventListener('click', caretSync);
    patternChanged(true);
  }
  function syncFlags() { const f = S().flags; for (const b of root.querySelectorAll('[data-flag]')) b.setAttribute('aria-pressed', String(f.includes(b.dataset.flag))); }

  function validity() {
    const s = S();
    const v = R.validate(s.pattern, s.flags);
    const el = q('#rxw-valid');
    if (!s.pattern) { el.className = 'rxw-valid'; el.textContent = 'Type a pattern or insert tokens from Build. An empty pattern matches the empty string everywhere.'; return v; }
    if (!v.ok) { el.className = 'rxw-valid bad'; el.textContent = 'Invalid: ' + v.error; return v; }
    const risks = R.riskOf(s.pattern, s.flags);
    el.className = 'rxw-valid' + (risks.length ? ' risk' : ' ok');
    el.textContent = risks.length ? 'Valid, with a backtracking risk. See Build for details.' : 'Valid pattern.';
    return v;
  }
  function patternChanged(first) {
    validity();
    renderPanel();
    if (!first) later('hist', recordHistory, 1500);
  }
  function renderPanel() {
    const s = S(); const p = q('#rxw-panel');
    p.setAttribute('aria-labelledby', 'rxw-tab-' + s.tab);
    ({ build: panelBuild, test: panelTest, replace: panelReplace, split: panelSplit, debug: panelDebug, bench: panelBench, compare: panelCompare, code: panelCode, library: panelLibrary, grep: panelGrep, history: panelHistory, share: panelShare })[s.tab](p, s);
  }
  function setTab(id, focus) {
    S().tab = id;
    for (const b of root.querySelectorAll('[role=tab]')) { const on = b.dataset.tab === id; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus(); }
    renderPanel();
  }

  // ---------- event routing ----------
  function onKey(e) {
    const tab = e.target.closest('[role=tab]');
    if (tab && /^(ArrowLeft|ArrowRight|Home|End)$/.test(e.key)) {
      e.preventDefault();
      const ids = TABS.map((x) => x[0]); let k = ids.indexOf(tab.dataset.tab);
      k = e.key === 'Home' ? 0 : e.key === 'End' ? ids.length - 1 : (k + (e.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length;
      setTab(ids[k], true);
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && root.contains(e.target)) { e.preventDefault(); renderPanel(); }
  }
  function onInput(e) {
    const s = S(); const t = e.target;
    if (t.id === 'rxw-pat') { s.pattern = t.value; validity(); later('panel', () => patternChanged(), 220); return; }
    if (t.dataset.bind) { s[t.dataset.bind] = t.value; later('panel', () => liveUpdate(t.dataset.bind), 220); }
    if (t.dataset.growth) { s.growth[t.dataset.growth] = t.value; }
    if (t.dataset.benchExtra != null) { s.benchExtra[+t.dataset.benchExtra] = t.value; }
  }
  function onChange(e) {
    const t = e.target;
    if (t.dataset.file === 'subject') loadSubjectFile(t);
    if (t.dataset.file === 'grep') pickGrepFiles(t);
    if (t.dataset.file === 'import') importFile(t);
    if (t.dataset.histKeep != null) { store.set(HIST_ON, t.checked); if (t.checked) store.set(HIST_KEY, history); else store.del(HIST_KEY); notify(t.checked ? 'History is now kept on this device.' : 'History is kept only until you close the app.', 'info'); }
  }
  function liveUpdate(bind) {
    const s = S();
    if (bind === 'subject' && (s.tab === 'test')) runTest();
    else if ((bind === 'replacement' || bind === 'subject') && s.tab === 'replace') runReplace();
    else if ((bind === 'splitLimit' || bind === 'subject') && s.tab === 'split') runSplit();
    else if (bind === 'grepText' && s.tab === 'grep') { /* GREP runs on request */ }
  }
  function onClick(e) {
    const s = S();
    const b = e.target.closest('button'); if (!b || !root.contains(b)) return;
    if (b.dataset.session) { activeKey = b.dataset.session; root.removeEventListener('click', onClick); root.removeEventListener('input', onInput); root.removeEventListener('change', onChange); root.removeEventListener('keydown', onKey); render(); return; }
    if (b.dataset.flag) {
      let f = s.flags; const k = b.dataset.flag;
      if (f.includes(k)) f = f.replace(k, ''); else { f += k; if (k === 'u') f = f.replace('v', ''); if (k === 'v') f = f.replace('u', ''); }
      s.flags = R.normFlags(f); syncFlags(); patternChanged(); return;
    }
    if (b.dataset.tab) { setTab(b.dataset.tab); return; }
    if (b.dataset.tok != null) { insertToken(+b.dataset.grp, +b.dataset.tok); return; }
    if (b.dataset.node) { selectNode(b); return; }
    if (b.dataset.step != null) { showStep(+b.dataset.step); return; }
    if (b.dataset.match != null) { selectMatch(+b.dataset.match); return; }
    const act = b.dataset.act; if (!act) return;
    const A = {
      apply: () => { if (!s.onApply) return; if (!R.validate(s.pattern, s.flags).ok) { notify('Fix the pattern first: the engine rejects it.', 'error'); return; } s.onApply({ pattern: s.pattern, flags: s.flags }); },
      'copy-expl': () => { try { copy(R.explainText(R.explain(s.pattern, s.flags).tree), 'Explanation'); } catch (er) { notify(er.message, 'error'); } },
      'dl-expl-md': () => exportExplanation('md'), 'dl-expl-json': () => exportExplanation('json'), 'dl-expl-html': () => exportExplanation('html'),
      'match-prev': () => selectMatch(Math.max(0, (s.sel || 0) - 1)), 'match-next': () => selectMatch(Math.min((s.lastMatches || []).length - 1, (s.sel || 0) + 1)),
      'case-add': () => { const t = q('[data-case-text]'); if (!t.value) { t.focus(); return; } s.tests.push({ text: t.value, expect: q('[data-case-expect]').getAttribute('aria-pressed') === 'true' }); t.value = ''; runTest(); },
      'case-expect': () => { const on = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', String(on)); b.textContent = on ? 'Must match' : 'Must not match'; },
      'case-del': () => { s.tests.splice(+b.dataset.k, 1); runTest(); },
      'copy-result': () => copy(s.lastReplace || '', 'Result'),
      'apply-subject': () => applyToSubject(), 'undo-subject': () => { if (s.undoSubject != null) { s.subject = s.undoSubject; s.undoSubject = null; renderPanel(); notify('The test subject was restored.', 'success'); } },
      'copy-split': () => copy(JSON.stringify(s.lastSplit || [], null, 2), 'Parts'),
      'trace': () => runTrace(false), 'trace-cut': () => runTrace(true),
      'bench': () => runBench(), 'growth': () => runGrowth(), 'cancel-bench': () => { runner('bench').cancel(); },
      'convert-to': () => { s.convertTo = b.dataset.v; renderPanel(); }, 'copy-converted': () => copy(q('[data-converted]').textContent, 'Converted pattern'),
      'code-lang': () => { s.codeLang = b.dataset.v; renderPanel(); }, 'code-action': () => { s.codeAction = b.dataset.v; renderPanel(); }, 'copy-code': () => copy(q('[data-code]').textContent, 'Code'),
      'lib-save': () => librarySave(), 'lib-use': () => libraryUse(b.dataset.id), 'lib-del': () => libraryDelete(b.dataset.id), 'lib-fill': () => libraryFill(b.dataset.id),
      'grep': () => runGrep(), 'grep-cancel': () => runner('grep').cancel(), 'grep-export': () => grepExport(b.dataset.v), 'grep-clear-files': () => { s.grepFiles = []; renderPanel(); }, 'grep-recall': () => { s.pattern = s.grepHist[+b.dataset.k].pattern; s.flags = s.grepHist[+b.dataset.k].flags; q('#rxw-pat').value = s.pattern; syncFlags(); patternChanged(); },
      'hist-recall': () => { const h = history[+b.dataset.k]; s.pattern = h.pattern; s.flags = h.flags; s.replacement = h.replacement || ''; q('#rxw-pat').value = s.pattern; syncFlags(); patternChanged(); notify('Recalled from history.', 'info'); },
      'hist-del': () => { history.splice(+b.dataset.k, 1); saveHistory(); renderPanel(); },
      'hist-clear': async () => { if (!history.length) return; const ok = await ctx.confirm({ action: 'Clear the regex history', affected: history.length + ' history entries in this workbench. Saved library patterns are not affected.' }); if (ok) { history = []; saveHistory(); renderPanel(); notify('History cleared.', 'success'); } },
      'export-session': () => exportSession(), 'export-library': () => exportLibrary(), 'import-add': () => importAdd(),
      'copy-js': () => copy('/' + s.pattern.replace(/(^|[^\\])\//g, '$1\\/') + '/' + s.flags, 'Regex literal'), 'copy-json': () => copy(JSON.stringify({ pattern: s.pattern, flags: s.flags }), 'Pattern as JSON')
    };
    if (A[act]) A[act]();
  }

  // ---------- Build ----------
  function tokenState(t) {
    const f = S().flags;
    if (t.off) return t.off;
    if (t.needs === 'uv' && !/[uv]/.test(f)) return 'Turn on the u or v flag to use this.';
    if (t.needs === 'v' && !f.includes('v')) return 'Turn on the v flag to use this.';
    if (t.feature && !ENGINE.features[t.feature]) return 'This engine (' + ENGINE.version + ') does not support modifier groups yet.';
    return '';
  }
  function panelBuild(p, s) {
    let explHtml = '', diags = [];
    if (s.pattern) {
      try { const ex = R.explain(s.pattern, s.flags); explHtml = '<ul class="rxw-tree" aria-label="Explanation">' + treeHtml(ex.tree, '') + '</ul>'; }
      catch (e) { explHtml = `<p class="errbox">The explanation stops at position ${esc(e.at)}: ${esc(e.message)}</p>`; }
      diags = R.diagnose(s.pattern, s.flags);
    }
    p.innerHTML = `
<div class="rxw-grid">
  <div class="rxw-col">
    <h3>Insert a token</h3>
    <p class="small muted">Tokens go in at the cursor. Group tokens wrap the selected text.</p>
    ${TOKENS.map(([g, list], gi) => `<div class="rxw-tokgroup"><h4>${g}</h4><div class="rxw-toks">${list.map((t, ti) => { const off = tokenState(t); return `<button type="button" class="chipbtn rxw-tok" data-grp="${gi}" data-tok="${ti}" ${off ? 'aria-disabled="true"' : ''} title="${esc(off || t.help)}"><span>${esc(t.label)}</span>${t.ins ? `<code>${esc(Array.isArray(t.ins) ? t.ins[0] + '...' + t.ins[1] : t.ins)}</code>` : ''}</button>`; }).join('')}</div></div>`).join('')}
    <p class="small muted" role="status" data-tokmsg></p>
  </div>
  <div class="rxw-col">
    <h3>Explanation</h3>
    ${s.pattern ? explHtml : '<p class="muted">The explanation appears here as you build the pattern. Select a line to select that part of the pattern; move the cursor in the pattern to find its line.</p>'}
    <div class="row rxw-actions"><button type="button" class="btn sm" data-act="copy-expl" ${s.pattern ? '' : 'disabled'}>Copy as text</button><button type="button" class="btn sm" data-act="dl-expl-md" ${s.pattern ? '' : 'disabled'}>Save as Markdown</button><button type="button" class="btn sm" data-act="dl-expl-html" ${s.pattern ? '' : 'disabled'}>Save as HTML</button><button type="button" class="btn sm" data-act="dl-expl-json" ${s.pattern ? '' : 'disabled'}>Save as JSON</button></div>
    <h3>Diagnostics</h3>
    ${diags.length ? `<ul class="rxw-diags">${diags.map((d) => `<li class="rxw-d-${d.level}"><strong>${({ error: 'Error', warn: 'Warning', risk: 'Backtracking risk', info: 'Note' })[d.level]}:</strong> ${esc(d.text)}</li>`).join('')}</ul>` : `<p class="muted">${s.pattern ? 'No problems found.' : 'Nothing to check yet.'}</p>`}
    <h3>This engine</h3>
    <dl class="kv rxw-kv"><dt>Engine</dt><dd>${esc(ENGINE.name)}</dd><dt>Version</dt><dd>${esc(ENGINE.version)}</dd><dt>Flags</dt><dd>${esc(ENGINE.flags.join(' '))}</dd>${Object.entries(ENGINE.features).map(([k, v]) => `<dt>${esc({ lookbehind: 'Lookbehind', namedGroups: 'Named groups', unicodeProperties: 'Unicode properties', setNotation: 'Set notation (v)', modifiers: 'Modifier groups', duplicateNames: 'Duplicate group names' }[k])}</dt><dd>${v ? 'Supported' : 'Not supported by this engine version'}</dd>`).join('')}<dt>Not in this engine</dt><dd>Atomic groups, possessive quantifiers, conditionals, recursion, subroutines, balancing groups, inline comments and free-spacing mode.</dd></dl>
  </div>
</div>`;
  }
  function treeHtml(n, path) {
    return `<li><button type="button" class="rxw-node" data-node="${path}" data-s="${n.start}" data-e="${n.end}"><code>${esc(n.raw || '(empty)')}</code><span>${esc(n.text)}</span></button>${n.children.length ? '<ul>' + n.children.map((c, k) => treeHtml(c, path + '.' + k)).join('') + '</ul>' : ''}</li>`;
  }
  function selectNode(b) {
    const ta = q('#rxw-pat');
    for (const x of root.querySelectorAll('.rxw-node[aria-current]')) x.removeAttribute('aria-current');
    b.setAttribute('aria-current', 'true');
    ta.focus(); ta.setSelectionRange(+b.dataset.s, +b.dataset.e);
  }
  function caretSync() {
    if (S().tab !== 'build') return;
    const ta = q('#rxw-pat'); const pos = ta.selectionStart;
    let best = null;
    for (const b of root.querySelectorAll('.rxw-node')) { const st = +b.dataset.s, en = +b.dataset.e; if (pos >= st && pos <= en && en > st) best = b; }
    for (const x of root.querySelectorAll('.rxw-node[aria-current]')) x.removeAttribute('aria-current');
    if (best) best.setAttribute('aria-current', 'true');
  }
  function insertToken(gi, ti) {
    const t = TOKENS[gi][1][ti]; const off = tokenState(t);
    const msg = q('[data-tokmsg]');
    if (off) { if (msg) msg.textContent = t.label + ': ' + off; return; }
    const ta = q('#rxw-pat'); const s = S();
    const a = ta.selectionStart, z = ta.selectionEnd; const sel = s.pattern.slice(a, z);
    let ins, caret;
    if (t.action === 'escape') { ins = R.escapeRegex(sel); caret = a + ins.length; }
    else if (Array.isArray(t.ins)) { ins = t.ins[0] + sel + t.ins[1]; caret = sel ? a + ins.length : a + t.ins[0].length; }
    else { ins = t.ins; caret = a + ins.length; }
    s.pattern = (s.pattern.slice(0, a) + ins + s.pattern.slice(z)).slice(0, R.LIMITS.pattern);
    ta.value = s.pattern; ta.focus(); ta.setSelectionRange(caret, caret);
    patternChanged();
    const m2 = q('[data-tokmsg]'); if (m2) m2.textContent = 'Inserted ' + t.label + '.';
  }
  function exportExplanation(kind) {
    const s = S(); let ex;
    try { ex = R.explain(s.pattern, s.flags); } catch (e) { notify(e.message, 'error'); return; }
    if (kind === 'md') download('regex-explanation.md', '# Regex explanation\n\nPattern: `' + s.pattern + '`  \nFlags: `' + (s.flags || 'none') + '`  \nEngine: ' + ENGINE.name + ', ' + ENGINE.version + '\n\n' + R.explainText(ex.tree), 'text/markdown');
    else if (kind === 'json') download('regex-explanation.json', JSON.stringify({ pattern: s.pattern, flags: s.flags, engine: ENGINE, tree: ex.tree, diagnostics: R.diagnose(s.pattern, s.flags) }, null, 2), 'application/json');
    else { const li = (n) => '<li><code>' + esc(n.raw) + '</code> ' + esc(n.text) + (n.children.length ? '<ul>' + n.children.map(li).join('') + '</ul>' : '') + '</li>'; download('regex-explanation.html', '<!doctype html><meta charset="utf-8"><title>Regex explanation</title><h1>Regex explanation</h1><p>Pattern: <code>' + esc(s.pattern) + '</code>, flags: <code>' + esc(s.flags || 'none') + '</code></p><ul>' + li(ex.tree) + '</ul>', 'text/html'); }
  }

  // ---------- Test ----------
  function panelTest(p, s) {
    const le = R.lineEndings(s.subject);
    p.innerHTML = `
<label class="rxw-lab" for="rxw-subject">Test subject</label>
<textarea id="rxw-subject" class="rxw-text" rows="6" spellcheck="false" data-bind="subject" maxlength="${R.LIMITS.subject}"></textarea>
<div class="row rxw-actions"><label class="btn sm rxw-file">Load a text file as the subject<input type="file" data-file="subject" class="sr"></label><span class="small muted">${s.subject.length} characters. Line endings: ${le.lf} LF, ${le.crlf} CRLF, ${le.cr} CR. Files are read on this device and never changed.</span></div>
<div class="row rxw-actions"><button type="button" class="btn sm" data-act="match-prev" aria-label="Previous match">Previous</button><button type="button" class="btn sm" data-act="match-next" aria-label="Next match">Next</button><span class="rxw-count" role="status" aria-live="polite" data-count></span></div>
<div class="rxw-hl" data-hl aria-label="Subject with matches highlighted"></div>
<h3>Matches and capture groups</h3>
<div data-matches></div>
<h3>Selected match, character by character</h3>
<div data-cps><p class="muted">Select a match to see its code points and UTF-8 bytes.</p></div>
<h3>Test cases</h3>
<p class="small muted">Each case checks whether the pattern finds a match anywhere in the text.</p>
<div class="row rxw-actions"><input class="rxw-input" data-case-text aria-label="Test case text" placeholder="Text to check"><button type="button" class="chipbtn" data-act="case-expect" data-case-expect aria-pressed="true">Must match</button><button type="button" class="btn sm" data-act="case-add">Add case</button></div>
<div data-cases></div>`;
    q('#rxw-subject').value = s.subject;
    runTest();
  }
  async function runTest() {
    const s = S(); if (!root || s.tab !== 'test') return;
    const count = q('[data-count]'); const hl = q('[data-hl]'); const box = q('[data-matches]');
    if (!R.validate(s.pattern, s.flags).ok) { count.textContent = 'Fix the pattern to see matches.'; hl.textContent = s.subject.slice(0, 50000); box.innerHTML = ''; renderCases(null); return; }
    count.textContent = 'Running...';
    const res = await runner('test').run({ op: 'match', pattern: s.pattern, flags: s.flags, subject: s.subject });
    if (!root || S() !== s || s.tab !== 'test') return;
    if (!res.ok) { if (res.cancelled) return; count.textContent = failText(res); box.innerHTML = `<p class="errbox">${esc(failText(res))}</p>`; hl.textContent = s.subject.slice(0, 50000); return; }
    const ms = res.result.matches; s.lastMatches = ms; s.sel = 0;
    count.textContent = (ms.length ? ms.length + (ms.length === 1 ? ' match' : ' matches') : 'No match') + (res.result.truncated ? ' (stopped at ' + R.LIMITS.matches + ')' : '') + (s.flags.includes('g') || s.flags.includes('y') ? '' : '. Only the first match is listed without the g flag') + ', ' + res.result.ms.toFixed(1) + ' ms';
    hl.innerHTML = highlight(s.subject, ms);
    box.innerHTML = ms.length ? `<ol class="rxw-mlist">${ms.slice(0, 500).map((m, k) => `<li><button type="button" class="rxw-mbtn" data-match="${k}"><span class="rxw-mpos">#${k + 1} at ${m.index}${m.end === m.index ? ', zero width' : ', length ' + (m.end - m.index)}</span><code>${esc(m.text) || '(empty)'}</code></button>${m.groups.length ? `<ul class="rxw-groups">${m.groups.map((g, gi) => `<li><span>Group ${gi + 1}${groupName(m, gi + 1)}</span>${g ? `<code>${esc(g.text) || '(empty)'}</code><span class="small muted">${g.start} to ${g.end}</span>` : '<span class="muted">did not take part</span>'}</li>`).join('')}</ul>` : ''}</li>`).join('')}</ol>${ms.length > 500 ? '<p class="small muted">The first 500 matches are listed.</p>' : ''}` : '<p class="muted">No match in this text.</p>';
    if (ms.length) selectMatch(0, true);
    renderCases(null);
    if (s.tests.length) {
      const r2 = await runner('cases').run({ op: 'tests', pattern: s.pattern, flags: s.flags, cases: s.tests });
      if (root && S() === s && s.tab === 'test') renderCases(r2);
    }
  }
  function groupName(m, idx) { if (!m.named) return ''; const names = Object.keys(m.named); let k = 0; for (const g of m.groups) { k++; if (k === idx) { const n = names.find((nm) => m.named[nm] === (g ? g.text : null)); return n ? ' "' + esc(n) + '"' : ''; } } return ''; }
  function highlight(text, ms) {
    const CAP = 50000; let out = '', last = 0;
    for (let k = 0; k < ms.length; k++) {
      const m = ms[k]; if (m.index > CAP) break;
      out += esc(text.slice(last, m.index));
      if (m.end === m.index) { out += `<mark class="rxw-zero" data-mk="${k}" title="Zero-width match ${k + 1}"></mark>`; last = m.index; continue; }
      let inner = '', pos = m.index;
      const gs = m.groups.map((g, gi) => g && g.end > g.start ? Object.assign({ gi }, g) : null).filter(Boolean).sort((a, b) => a.start - b.start);
      for (const g of gs) { if (g.start < pos) continue; inner += esc(text.slice(pos, g.start)) + `<span class="rxw-g rxw-g${g.gi % 4}" title="Group ${g.gi + 1}">${esc(text.slice(g.start, g.end))}</span>`; pos = g.end; }
      inner += esc(text.slice(pos, m.end));
      out += `<mark class="rxw-m" data-mk="${k}">${inner}</mark>`;
      last = m.end;
    }
    out += esc(text.slice(last, CAP));
    if (text.length > CAP) out += '<span class="muted"> (highlighting stops after 50,000 characters)</span>';
    return out;
  }
  function selectMatch(k, quiet) {
    const s = S(); const ms = s.lastMatches || []; if (!ms.length) return;
    s.sel = k;
    for (const x of root.querySelectorAll('[data-mk].on')) x.classList.remove('on');
    const mk = root.querySelector(`[data-mk="${k}"]`); if (mk) { mk.classList.add('on'); if (!quiet) mk.scrollIntoView({ block: 'nearest' }); }
    for (const x of root.querySelectorAll('.rxw-mbtn')) x.setAttribute('aria-pressed', String(+x.dataset.match === k));
    const m = ms[k]; const cps = R.codePoints(m.text, 64);
    const box = q('[data-cps]');
    if (box) box.innerHTML = cps.length ? `<ul class="rxw-cps">${cps.map((c) => `<li><span class="rxw-ch">${esc(c.ch.trim() ? c.ch : ' ')}</span><code>${c.cp}</code><span class="small muted">UTF-8 ${c.utf8}, UTF-16 ${c.utf16}</span></li>`).join('')}</ul>` : '<p class="muted">This is a zero-width match: it has no characters.</p>';
    if (!quiet) { const c = q('[data-count]'); if (c) c.textContent = 'Match ' + (k + 1) + ' of ' + ms.length + ' at position ' + m.index; }
  }
  function renderCases(res) {
    const s = S(); const box = q('[data-cases]'); if (!box) return;
    if (!s.tests.length) { box.innerHTML = '<p class="muted">No test cases yet.</p>'; return; }
    const rs = res && res.ok ? res.result.results : null;
    const pass = rs ? rs.filter((r) => r.pass).length : 0;
    box.innerHTML = (res && !res.ok ? `<p class="errbox">${esc(failText(res))}</p>` : '') + (rs ? `<p role="status">${pass} of ${rs.length} cases pass.</p>` : '') + `<ul class="rxw-cases">${s.tests.map((t, k) => { const r = rs && rs[k]; return `<li class="${r ? (r.pass ? 'pass' : 'fail') : ''}"><span class="rxw-verdict">${r ? (r.pass ? 'Pass' : 'Fail') : 'Not run'}</span><code>${esc(t.text)}</code><span class="small">${t.expect ? 'must match' : 'must not match'}${r ? ', ' + (r.got ? 'matched' : 'did not match') : ''}</span><button type="button" class="btn sm light" data-act="case-del" data-k="${k}" aria-label="Remove case ${k + 1}">Remove</button></li>`; }).join('')}</ul>`;
  }
  async function loadSubjectFile(input) {
    const f = input.files && input.files[0]; input.value = '';
    if (!f) return;
    if (f.size > R.LIMITS.subject * 4) { notify('That file is too large for the test subject (limit ' + R.LIMITS.subject + ' characters).', 'error'); return; }
    const text = await f.text();
    if (text.indexOf('\u0000') >= 0) { notify('That file looks binary, so it was not loaded.', 'error'); return; }
    if (text.length > R.LIMITS.subject) { notify('That file has more than ' + R.LIMITS.subject + ' characters, so it was not loaded.', 'error'); return; }
    S().subject = text; renderPanel(); notify('Loaded ' + f.name + ' as the test subject. The file itself is not changed.', 'success');
  }

  // ---------- Replace ----------
  function panelReplace(p, s) {
    p.innerHTML = `
<label class="rxw-lab" for="rxw-repl">Replacement</label>
<input id="rxw-repl" class="rxw-input mono" data-bind="replacement" spellcheck="false" placeholder="For example: $1, $<name>, $&amp; or $$">
<div data-tpl></div>
<p class="small muted">The preview runs on the test subject only. Nothing else is changed. Applying the result to the test subject asks first and can be undone.</p>
<div class="row rxw-actions"><button type="button" class="btn sm" data-act="copy-result">Copy result</button><button type="button" class="btn sm" data-act="apply-subject">Apply to the test subject</button><button type="button" class="btn sm light" data-act="undo-subject" ${s.undoSubject == null ? 'disabled' : ''}>Undo apply</button></div>
<p role="status" data-rstatus></p>
<h3>Result preview</h3><pre class="rxw-pre" data-rresult></pre>
<h3>Each replacement</h3><div data-pieces></div>`;
    q('#rxw-repl').value = s.replacement;
    runReplace();
  }
  async function runReplace() {
    const s = S(); if (!root || s.tab !== 'replace') return;
    const st = q('[data-rstatus]');
    let tplHtml = '';
    try { const pp = R.parse(s.pattern, s.flags); const toks = R.parseTemplate(s.replacement, pp.groups, pp.names); tplHtml = toks.length ? `<ul class="rxw-tpl" aria-label="Replacement explanation">${toks.map((t) => `<li><code>${esc(t.raw || t.text)}</code><span>${esc(t.type === 'text' ? 'Literal text' : t.text)}</span></li>`).join('')}</ul>` : '<p class="small muted">An empty replacement deletes each match.</p>'; } catch { tplHtml = ''; }
    q('[data-tpl]').innerHTML = tplHtml;
    if (!R.validate(s.pattern, s.flags).ok) { st.textContent = 'Fix the pattern to preview replacements.'; return; }
    st.textContent = 'Running...';
    const res = await runner('replace').run({ op: 'replace', pattern: s.pattern, flags: s.flags, subject: s.subject, replacement: s.replacement });
    if (!root || S() !== s || s.tab !== 'replace') return;
    if (!res.ok) { if (!res.cancelled) st.textContent = failText(res); return; }
    const r = res.result; s.lastReplace = r.result; s.lastReplaceCount = r.count;
    st.textContent = r.count + (r.count === 1 ? ' replacement' : ' replacements') + (s.flags.includes('g') ? '' : ' (only the first match is replaced without the g flag)') + '. ' + (r.verified ? 'Each piece below was checked against the engine result.' : r.truncated ? 'The list stops at ' + R.LIMITS.replacePieces + ' pieces.' : 'The pieces below could not be confirmed against the engine result; the result preview is the engine output.');
    q('[data-rresult]').textContent = r.result.slice(0, 50000) + (r.result.length > 50000 ? '\n(preview stops after 50,000 characters)' : '');
    q('[data-pieces]').innerHTML = r.pieces.length ? `<ol class="rxw-pieces">${r.pieces.slice(0, 300).map((x) => `<li><span class="small muted">at ${x.index}</span><code>${esc(x.from) || '(empty)'}</code><span aria-hidden="true">to</span><span class="sr">becomes</span><code>${esc(x.to) || '(empty)'}</code></li>`).join('')}</ol>` : '<p class="muted">No match, so nothing would change.</p>';
  }
  async function applyToSubject() {
    const s = S();
    if (s.lastReplace == null || !s.lastReplaceCount) { notify('There is nothing to apply: the preview has no replacements.', 'info'); return; }
    const ok = await ctx.confirm({ action: 'Replace text in the test subject', affected: s.lastReplaceCount + ' replacements in the test subject of this workbench. No file or other data is touched, and Undo apply restores the previous text.' });
    if (!ok) { notify('Nothing was changed.', 'info'); return; }
    s.undoSubject = s.subject; s.subject = s.lastReplace; renderPanel(); notify('Applied to the test subject. Use Undo apply to restore it.', 'success');
  }

  // ---------- Split ----------
  function panelSplit(p, s) {
    p.innerHTML = `<p class="small muted">Splits the test subject wherever the pattern matches, using the engine's own split. Capture groups are included in the parts, as the engine does.</p>
<div class="row rxw-actions"><label class="rxw-lab" for="rxw-limit">Maximum parts (optional)</label><input id="rxw-limit" class="rxw-input rxw-num" inputmode="numeric" data-bind="splitLimit" placeholder="No limit"><button type="button" class="btn sm" data-act="copy-split">Copy parts as JSON</button></div>
<p role="status" data-sstatus></p><ol class="rxw-parts" data-parts></ol>`;
    q('#rxw-limit').value = s.splitLimit;
    runSplit();
  }
  async function runSplit() {
    const s = S(); if (!root || s.tab !== 'split') return;
    const st = q('[data-sstatus]');
    if (!R.validate(s.pattern, s.flags).ok) { st.textContent = 'Fix the pattern to split.'; return; }
    if (s.splitLimit !== '' && !/^\d+$/.test(s.splitLimit)) { st.textContent = 'The maximum must be a whole number.'; return; }
    const res = await runner('split').run({ op: 'split', pattern: s.pattern, flags: s.flags, subject: s.subject, limit: s.splitLimit === '' ? null : +s.splitLimit });
    if (!root || S() !== s || s.tab !== 'split') return;
    if (!res.ok) { if (!res.cancelled) st.textContent = failText(res); return; }
    s.lastSplit = res.result.parts;
    st.textContent = res.result.parts.length + ' parts' + (res.result.truncated ? ' (stopped at ' + R.LIMITS.splitParts + ')' : '') + '.';
    q('[data-parts]').innerHTML = res.result.parts.slice(0, 500).map((x) => `<li><code>${x === undefined ? 'undefined (group did not take part)' : esc(x) || '(empty)'}</code></li>`).join('');
  }

  // ---------- Debug ----------
  function panelDebug(p, s) {
    const long = s.subject.length > R.LIMITS.traceSubject;
    p.innerHTML = `<p class="small muted">The debugger walks the pattern step by step with backtracking. Each character test, class and anchor is decided by the real engine; the final result is compared with the engine's own match. It traces the first match from the start position.</p>
<div class="row rxw-actions"><label class="rxw-lab" for="rxw-from">Start position</label><input id="rxw-from" class="rxw-input rxw-num" inputmode="numeric" value="${s.debugFrom}" data-bind="debugFrom"><button type="button" class="btn primary sm" data-act="trace" ${long ? 'disabled' : ''}>Trace</button>${long ? `<button type="button" class="btn sm" data-act="trace-cut">Trace the first ${R.LIMITS.traceSubject} characters</button>` : ''}</div>
${long ? `<p class="warn">The test subject has ${s.subject.length} characters; the debugger traces at most ${R.LIMITS.traceSubject}. Tracing a cut subject changes what end anchors see.</p>` : ''}
<div data-dsum role="status" aria-live="polite"></div>
<div class="rxw-dviews"><div><h4>Pattern</h4><pre class="rxw-pre" data-dpat></pre></div><div><h4>Subject</h4><pre class="rxw-pre" data-dsub></pre></div></div>
<ol class="rxw-steps" data-steps aria-label="Steps"></ol>`;
    q('[data-dpat]').textContent = s.pattern; q('[data-dsub]').textContent = s.subject.slice(0, R.LIMITS.traceSubject);
  }
  async function runTrace(cut) {
    const s = S(); const sum = q('[data-dsum]');
    if (!R.validate(s.pattern, s.flags).ok) { sum.textContent = 'Fix the pattern first.'; return; }
    const from = /^\d+$/.test(String(s.debugFrom)) ? +s.debugFrom : 0;
    const subject = cut ? s.subject.slice(0, R.LIMITS.traceSubject) : s.subject;
    sum.textContent = 'Tracing...';
    const res = await runner('debug').run({ op: 'trace', pattern: s.pattern, flags: s.flags, subject, from }, 4000);
    if (!root || S() !== s || s.tab !== 'debug') return;
    if (!res.ok) { if (!res.cancelled) sum.innerHTML = `<p class="errbox">${esc(failText(res))}</p>`; return; }
    const t = res.result; s.trace = t; s.traceSubject = subject;
    const mt = (m) => (m ? 'a match from ' + m.index + ' to ' + m.end + ' ("' + subject.slice(m.index, m.end) + '")' : 'no match');
    sum.innerHTML = `<p><strong>${t.steps}</strong> steps over ${t.attempts} start positions. The trace found ${esc(mt(t.match))}; the engine found ${esc(mt(t.engine))}.</p>
<p class="${t.agree === true ? 'rxw-ok' : t.agree === false ? 'errbox' : 'warn'}">${t.agree === true ? 'The trace agrees with the engine.' : t.agree === false ? 'The trace differs from the engine. The engine result is the real one; this trace is not reliable for this pattern.' : esc(t.truncated)}</p>
${t.notes.map((n) => `<p class="small muted">${esc(n)}</p>`).join('')}${t.logTruncated ? `<p class="small muted">The first ${t.log.length} steps are listed.</p>` : ''}`;
    const SHOW = 600;
    q('[data-steps]').innerHTML = t.log.slice(0, SHOW).map((x, k) => `<li><button type="button" class="rxw-step rxw-op-${x.op}" data-step="${k}"><span class="rxw-stepn">${x.n}</span><span class="rxw-stepop">${esc(x.op)}</span><code>${esc(x.start >= 0 ? s.pattern.slice(x.start, x.end) : '')}</code><span>${esc(x.text)}${x.op === 'attempt' ? '' : ' at ' + x.pos}</span></button></li>`).join('') + (t.log.length > SHOW ? `<li class="small muted">${t.log.length - SHOW} more steps are in the trace; export the session to keep them.</li>` : '');
  }
  function showStep(k) {
    const s = S(); const x = s.trace && s.trace.log[k]; if (!x) return;
    for (const b of root.querySelectorAll('.rxw-step[aria-pressed]')) b.removeAttribute('aria-pressed');
    const b = root.querySelector(`[data-step="${k}"]`); if (b) b.setAttribute('aria-pressed', 'true');
    const P = s.pattern, sub = s.traceSubject;
    q('[data-dpat]').innerHTML = x.start >= 0 ? esc(P.slice(0, x.start)) + '<mark class="rxw-m on">' + esc(P.slice(x.start, x.end)) + '</mark>' + esc(P.slice(x.end)) : esc(P);
    q('[data-dsub]').innerHTML = esc(sub.slice(0, x.pos)) + '<mark class="rxw-zero on" title="Position ' + x.pos + '"></mark>' + esc(sub.slice(x.pos));
  }

  // ---------- Benchmark ----------
  function panelBench(p, s) {
    p.innerHTML = `<p class="small muted">Timings are measured in the isolated worker on this device, within a ${R.LIMITS.benchBudgetMs} ms budget. They measure this engine's real speed, which can differ from the debugger's step count.</p>
<h3>Compare patterns</h3>
<div class="rxw-col"><span class="small">Pattern 1 is the current pattern.</span>${[0, 1].map((k) => `<input class="rxw-input mono" data-bench-extra="${k}" aria-label="Pattern ${k + 2} to compare (optional)" placeholder="Pattern ${k + 2} (optional, same flags)" spellcheck="false">`).join('')}
<label class="rxw-lab" for="rxw-miss">Text that should not match (optional)</label><textarea id="rxw-miss" class="rxw-text" rows="2" data-bind="benchMiss" spellcheck="false"></textarea></div>
<div class="row rxw-actions"><button type="button" class="btn primary sm" data-act="bench">Run benchmark</button><button type="button" class="btn sm light" data-act="cancel-bench">Cancel</button></div>
<div data-bres role="status" aria-live="polite"></div>
<h3>Growth with input length</h3>
<p class="small muted">Runs the pattern on prefix + unit repeated n times + suffix, with n growing, to show how time grows. Text that almost matches exposes catastrophic backtracking.</p>
<div class="row rxw-actions"><label>Prefix <input class="rxw-input rxw-short" data-growth="prefix" spellcheck="false"></label><label>Unit <input class="rxw-input rxw-short" data-growth="unit" spellcheck="false"></label><label>Suffix <input class="rxw-input rxw-short" data-growth="suffix" spellcheck="false"></label><button type="button" class="btn sm" data-act="growth">Measure growth</button></div>
<div data-gres role="status" aria-live="polite"></div>`;
    root.querySelectorAll('[data-bench-extra]').forEach((x) => { x.value = s.benchExtra[+x.dataset.benchExtra]; });
    q('#rxw-miss').value = s.benchMiss;
    root.querySelectorAll('[data-growth]').forEach((x) => { x.value = s.growth[x.dataset.growth]; });
  }
  async function runBench() {
    const s = S(); const out = q('[data-bres]');
    const pats = [s.pattern].concat(s.benchExtra.filter(Boolean)).map((x) => ({ pattern: x, flags: s.flags }));
    for (const x of pats) { const v = R.validate(x.pattern, x.flags); if (!v.ok) { out.innerHTML = `<p class="errbox">${esc(x.pattern)}: ${esc(v.error)}</p>`; return; } }
    out.textContent = 'Measuring...';
    const subjects = [['Test subject', s.subject]].concat(s.benchMiss ? [['Text that should not match', s.benchMiss]] : []);
    let html = '';
    for (const [label, subj] of subjects) {
      const res = await runner('bench').run({ op: 'bench', patterns: pats, subject: subj, budgetMs: R.LIMITS.benchBudgetMs }, R.LIMITS.benchBudgetMs + 2500);
      if (!root || S() !== s) return;
      if (!res.ok) { html += `<h4>${esc(label)}</h4><p class="errbox">${esc(failText(res) || 'Cancelled.')}</p>`; continue; }
      const best = Math.min(...res.result.results.map((r) => r.perRunMs));
      html += `<h4>${esc(label)}</h4><ul class="rxw-bench">${res.result.results.map((r, k) => `<li><span>Pattern ${k + 1}</span><code>${esc(r.pattern)}</code><span>${fmtMs(r.perRunMs)} per run, ${r.runs.toLocaleString()} runs in ${r.totalMs.toFixed(0)} ms, ${r.matched ? 'matches' : 'no match'}</span><i class="rxw-bar" style="--w:${Math.max(4, Math.min(100, (best / r.perRunMs) * 100)).toFixed(0)}%" aria-hidden="true"></i></li>`).join('')}</ul>`;
    }
    out.innerHTML = html;
  }
  function fmtMs(ms) { return ms < 0.001 ? (ms * 1e6).toFixed(0) + ' ns' : ms < 1 ? (ms * 1000).toFixed(2) + ' microseconds' : ms.toFixed(2) + ' ms'; }
  async function runGrowth() {
    const s = S(); const out = q('[data-gres]');
    if (!R.validate(s.pattern, s.flags).ok) { out.textContent = 'Fix the pattern first.'; return; }
    if (!s.growth.unit) { out.textContent = 'The unit cannot be empty.'; return; }
    out.textContent = 'Measuring growth...';
    const partial = [];
    const res = await runner('bench').run({ op: 'growth', pattern: s.pattern, flags: s.flags, unit: s.growth.unit, prefix: s.growth.prefix, suffix: s.growth.suffix, budgetMs: R.LIMITS.benchBudgetMs }, R.LIMITS.benchBudgetMs + 2500, (x) => partial.push(x));
    if (!root || S() !== s) return;
    let g;
    if (res.ok) g = res.result;
    else if (res.timeout && partial.length) { const next = partial[partial.length - 1].size < 16 ? partial[partial.length - 1].size + 1 : partial[partial.length - 1].size * 2; g = { series: partial, stopped: 'The run with n = ' + next + ' did not finish within the time limit, so the worker was stopped. The sizes below finished.', verdict: R.growthVerdict(partial) + ' The next size never finished, which points to catastrophic backtracking.' }; }
    else { out.innerHTML = `<p class="errbox">${esc(failText(res) || 'Cancelled.')}</p>`; return; }
    const max = Math.max(...g.series.map((x) => x.ms), 0.001);
    out.innerHTML = `<p><strong>${esc(g.verdict)}</strong> ${esc(g.stopped)}</p><ul class="rxw-growth">${g.series.map((x) => `<li><span>n = ${x.size}</span><span>${x.length} chars</span><span>${fmtMs(x.ms)}</span><i class="rxw-bar" style="--w:${Math.max(1, (x.ms / max) * 100).toFixed(1)}%" aria-hidden="true"></i></li>`).join('')}</ul>`;
  }

  // ---------- Compare and convert ----------
  function panelCompare(p, s) {
    const c = R.compare(s.pattern, s.flags);
    const fl = Object.keys(R.FLAVORS);
    const conv = s.pattern ? R.convert(s.pattern, s.flags, s.convertTo) : null;
    const rconv = s.replacement ? R.convertReplacement(s.replacement, s.convertTo) : null;
    p.innerHTML = `<p class="small muted">${esc(c.basis)} Reviewed ${esc(c.reviewed)}. Other flavours are never executed here, so no equivalence is promised.</p>
${!s.pattern ? '<p class="muted">Type a pattern to compare it.</p>' : !c.parsed ? '<p class="errbox">The pattern could not be read for comparison.</p>' : !c.rows.length ? '<p class="muted">This pattern only uses plain characters, sets and repetition, which every listed flavour supports in the same way. Escapes and Unicode handling can still differ.</p>' : `<div class="rxw-scroll" tabindex="0" role="region" aria-label="Feature comparison"><table class="rxw-table"><thead><tr><th scope="col">Feature used</th>${fl.map((f) => `<th scope="col">${esc(R.FLAVORS[f].name)}</th>`).join('')}</tr></thead><tbody>${c.rows.map((r) => `<tr><th scope="row">${esc(r.label)}</th>${fl.map((f) => `<td class="rxw-st-${r.cells[f].status}">${({ yes: 'Yes', no: 'No', diff: 'Different' })[r.cells[f].status]}${r.cells[f].note && f !== 'js' ? `<span class="small">${esc(r.cells[f].note)}</span>` : ''}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`}
<h3>Convert for another flavour</h3>
<div class="seg rxw-seg" role="group" aria-label="Target flavour">${fl.filter((f) => f !== 'js').map((f) => `<button type="button" data-act="convert-to" data-v="${f}" aria-pressed="${s.convertTo === f}">${esc(R.FLAVORS[f].name)}</button>`).join('')}</div>
${conv ? `<p class="small muted">The original pattern is kept. The converted text is a preview for you to copy; it was not run in ${esc(R.FLAVORS[s.convertTo].name)}.</p>
<pre class="rxw-pre" data-converted>${esc(conv.text)}</pre>
${conv.blockers.length ? `<p class="errbox">Cannot be expressed: ${conv.blockers.map(esc).join(' ')}</p>` : ''}${conv.changes.length ? `<ul class="rxw-diags">${conv.changes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
${rconv ? `<h4>Replacement</h4><pre class="rxw-pre">${esc(rconv.text)}</pre>${rconv.blockers.length ? `<p class="errbox">${rconv.blockers.map(esc).join(' ')}</p>` : ''}` : ''}
<div class="row rxw-actions"><button type="button" class="btn sm" data-act="copy-converted">Copy converted pattern</button></div>` : ''}`;
  }

  // ---------- Code ----------
  function panelCode(p, s) {
    const g = s.pattern ? R.codeFor(s.codeLang, s.codeAction, s.pattern, s.flags, s.replacement) : null;
    p.innerHTML = `<div class="seg rxw-seg" role="group" aria-label="Language">${Object.entries(R.LANGS).map(([k, v]) => `<button type="button" data-act="code-lang" data-v="${k}" aria-pressed="${s.codeLang === k}">${esc(v)}</button>`).join('')}</div>
<div class="seg rxw-seg" role="group" aria-label="Action">${[['match', 'First match'], ['all', 'All matches'], ['replace', 'Replace'], ['split', 'Split']].map(([k, v]) => `<button type="button" data-act="code-action" data-v="${k}" aria-pressed="${s.codeAction === k}">${v}</button>`).join('')}</div>
${g ? `<pre class="rxw-pre" data-code>${esc(g.code)}</pre>${g.notes.length ? `<ul class="rxw-diags">${g.notes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}<p class="small muted">${s.codeLang === 'javascript' ? 'This code uses the same engine as the workbench.' : 'Generated for you to use elsewhere; it was not run here. Check the notes and the Compare section.'} String literals are escaped for the chosen language.</p><div class="row rxw-actions"><button type="button" class="btn sm" data-act="copy-code">Copy code</button></div>` : '<p class="muted">Type a pattern to generate code.</p>'}`;
  }

  // ---------- Library ----------
  function lib() { return store.get(LIB_KEY, []); }
  function allLib() { return BUILTIN.concat(lib()); }
  function panelLibrary(p, s) {
    p.innerHTML = `<h3>Save the current pattern</h3>
<div class="rxw-col"><input class="rxw-input" data-lib-name aria-label="Name" placeholder="Name" maxlength="120"><input class="rxw-input" data-lib-desc aria-label="Description" placeholder="Description (optional)" maxlength="1000">
<p class="small muted">Saved on this device only. The pattern, flags, replacement and test cases are saved; the test subject is not. Write %name% in a pattern to make a parameter that is filled in when you use it.</p>
<div class="row rxw-actions"><button type="button" class="btn primary sm" data-act="lib-save">Save to library</button></div></div>
<h3>Library</h3><div data-lib-search></div><div data-lib-list></div>`;
    const sr = window.MVL && window.MVL.makeSearch ? window.MVL.makeSearch({ label: 'Search the regex library', placeholder: 'Search the library', onChange: () => renderLib(sr) }) : null;
    if (sr) q('[data-lib-search]').append(sr.el);
    renderLib(sr);
  }
  function renderLib(sr) {
    const box = q('[data-lib-list]'); if (!box) return;
    const items = allLib().filter((it) => !sr || !sr.active() || sr.test(it.name + '\n' + it.description + '\n' + it.pattern));
    if (sr && sr.setStatus) sr.setStatus(items.length + ' of ' + allLib().length + ' patterns');
    box.innerHTML = items.length ? `<ul class="rxw-lib">${items.map((it) => { const params = R.paramNames(it.pattern); return `<li><div><strong>${esc(it.name)}</strong>${it.builtin ? ' <span class="small muted">Built in</span>' : ''}<p class="small">${esc(it.description)}</p><code>${esc(it.pattern)}</code> <span class="small muted">flags ${esc(it.flags || 'none')}</span></div>${params.length ? `<div class="rxw-params" data-params="${esc(it.id)}">${params.map((n) => `<label>${esc(n)} <input class="rxw-input rxw-short" data-param="${esc(n)}" aria-label="Value for ${esc(n)}"></label><label class="small"><input type="checkbox" data-raw="${esc(n)}"> use as regex</label>`).join('')}</div>` : ''}<div class="row rxw-actions">${params.length ? `<button type="button" class="btn sm primary" data-act="lib-fill" data-id="${esc(it.id)}">Fill in and use</button>` : `<button type="button" class="btn sm primary" data-act="lib-use" data-id="${esc(it.id)}">Use</button>`}${it.builtin ? '' : `<button type="button" class="btn sm danger" data-act="lib-del" data-id="${esc(it.id)}">Delete</button>`}</div></li>`; }).join('')}</ul>` : '<p class="muted">No saved pattern matches the search.</p>';
  }
  function librarySave() {
    const s = S(); const name = q('[data-lib-name]').value.trim();
    if (!name) { notify('Give the pattern a name first.', 'error'); q('[data-lib-name]').focus(); return; }
    if (!s.pattern) { notify('There is no pattern to save.', 'error'); return; }
    const items = lib();
    items.push({ id: 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, description: q('[data-lib-desc]').value.trim(), pattern: s.pattern, flags: s.flags, replacement: s.replacement, tests: s.tests.slice() });
    if (!store.set(LIB_KEY, items)) { notify('The library could not be saved: storage is unavailable.', 'error'); return; }
    renderPanel(); notify('Saved "' + name + '" to the library.', 'success');
  }
  function loadEntry(it, pattern) {
    const s = S(); s.pattern = pattern; s.flags = R.normFlags(it.flags); s.replacement = it.replacement || ''; s.tests = (it.tests || []).map((t) => Object.assign({}, t));
    q('#rxw-pat').value = s.pattern; syncFlags(); setTab('test'); validity(); notify('Loaded "' + it.name + '".', 'success');
  }
  function libraryUse(id) { const it = allLib().find((x) => x.id === id); if (it) loadEntry(it, it.pattern); }
  function libraryFill(id) {
    const it = allLib().find((x) => x.id === id); if (!it) return;
    const box = root.querySelector(`[data-params="${CSS.escape(id)}"]`);
    const values = {}, mode = {};
    for (const inp of box.querySelectorAll('[data-param]')) values[inp.dataset.param] = inp.value;
    for (const cb of box.querySelectorAll('[data-raw]')) if (cb.checked) mode[cb.dataset.raw] = 'raw';
    let pat;
    try { pat = R.fillParams(it.pattern, values, mode); } catch (e) { notify(e.message, 'error'); return; }
    const v = R.validate(pat, it.flags);
    if (!v.ok) { notify('With those values the pattern is invalid: ' + v.error, 'error'); return; }
    loadEntry(it, pat);
  }
  async function libraryDelete(id) {
    const it = lib().find((x) => x.id === id); if (!it) return;
    const ok = await ctx.confirm({ action: 'Delete a saved pattern', affected: '"' + it.name + '" will be removed from the regex library on this device.' });
    if (!ok) { notify('Nothing was deleted.', 'info'); return; }
    store.set(LIB_KEY, lib().filter((x) => x.id !== id)); renderPanel(); notify('Deleted "' + it.name + '".', 'success');
  }

  // ---------- GREP ----------
  function panelGrep(p, s) {
    p.innerHTML = `<p class="small muted">Searches pasted text or files you pick with the current pattern. Files are read on this device and never changed, uploaded or saved. Limits: ${R.LIMITS.grepFiles} files, ${(R.LIMITS.grepFileChars / 1e6).toFixed(0)} million characters each, ${R.LIMITS.grepResults} results.</p>
<label class="rxw-lab" for="rxw-gtext">Pasted text</label><textarea id="rxw-gtext" class="rxw-text" rows="4" data-bind="grepText" spellcheck="false" placeholder="Paste text to search, or pick files below"></textarea>
<div class="row rxw-actions"><label class="btn sm rxw-file">Pick files<input type="file" multiple data-file="grep" class="sr"></label><span class="small" data-gfiles>${s.grepFiles.length ? s.grepFiles.length + ' files ready: ' + esc(s.grepFiles.slice(0, 5).map((f) => f.name).join(', ')) + (s.grepFiles.length > 5 ? ' and more' : '') : 'No files picked.'}</span>${s.grepFiles.length ? '<button type="button" class="btn sm light" data-act="grep-clear-files">Forget files</button>' : ''}</div>
<div class="row rxw-actions"><button type="button" class="btn primary sm" data-act="grep">Search</button><button type="button" class="btn sm light" data-act="grep-cancel">Cancel</button><button type="button" class="btn sm" data-act="grep-export" data-v="txt">Save results as text</button><button type="button" class="btn sm" data-act="grep-export" data-v="json">Save results as JSON</button></div>
<p class="small muted">Replacing inside files is not offered here: this tool only reads. To change text, use Replace on the test subject and copy the result.</p>
<div data-gres role="status" aria-live="polite"></div>
${s.grepHist.length ? `<h3>Recent searches</h3><ul class="rxw-hist">${s.grepHist.map((h, k) => `<li><code>${esc(h.pattern)}</code><span class="small muted">${esc(h.flags)}, ${h.count} results</span><button type="button" class="btn sm" data-act="grep-recall" data-k="${k}">Recall</button></li>`).join('')}</ul>` : ''}`;
    q('#rxw-gtext').value = s.grepText;
  }
  async function pickGrepFiles(input) {
    const s = S(); const files = [...(input.files || [])]; input.value = '';
    const out = []; const skipped = [];
    let total = 0;
    for (const f of files.slice(0, R.LIMITS.grepFiles)) {
      if (f.size > R.LIMITS.grepFileChars * 4) { skipped.push(f.name + ' (too large)'); continue; }
      if (total + f.size > R.LIMITS.grepTotalChars * 2) { skipped.push(f.name + ' (total size limit)'); continue; }
      const text = await f.text();
      if (text.slice(0, 8000).indexOf('\u0000') >= 0) { skipped.push(f.name + ' (binary)'); continue; }
      total += f.size; out.push({ name: f.webkitRelativePath || f.name, text });
    }
    if (files.length > R.LIMITS.grepFiles) skipped.push((files.length - R.LIMITS.grepFiles) + ' more files over the limit');
    s.grepFiles = out; renderPanel();
    if (skipped.length) notify('Skipped: ' + skipped.join(', ') + '.', 'warning');
  }
  async function runGrep() {
    const s = S(); const out = q('[data-gres]');
    if (!R.validate(s.pattern, s.flags).ok) { out.textContent = 'Fix the pattern first.'; return; }
    const files = (s.grepText ? [{ name: 'Pasted text', text: s.grepText }] : []).concat(s.grepFiles);
    if (!files.length) { out.textContent = 'Paste some text or pick files first.'; return; }
    out.textContent = 'Searching...';
    const res = await runner('grep').run({ op: 'grep', pattern: s.pattern, flags: s.flags, files }, 8000);
    if (!root || S() !== s || s.tab !== 'grep') return;
    if (!res.ok) { out.innerHTML = `<p class="errbox">${esc(failText(res) || 'Cancelled. No partial results are shown.')}</p>`; return; }
    const g = res.result; s.lastGrep = g;
    s.grepHist = [{ pattern: s.pattern, flags: s.flags, count: g.results.length }].concat(s.grepHist.filter((h) => h.pattern !== s.pattern || h.flags !== s.flags)).slice(0, 10);
    out.innerHTML = `<p>${g.results.length} results in ${g.perFile.filter((f) => f.count).length} of ${g.perFile.length} sources${g.truncated ? ', stopped at a limit, so the list is partial' : ''}, ${g.ms.toFixed(0)} ms.</p>${g.perFile.filter((f) => f.skipped).map((f) => `<p class="warn">${esc(f.name)}: ${esc(f.skipped)}</p>`).join('')}<ol class="rxw-grep">${g.results.slice(0, 1000).map((r) => `<li><span class="rxw-gloc">${esc(r.file)}:${r.line}:${r.col}</span><code>${esc(r.text.slice(0, r.at))}<mark class="rxw-m">${esc(r.text.slice(r.at, r.at + r.match.length))}</mark>${esc(r.text.slice(r.at + r.match.length))}</code></li>`).join('')}</ol>${g.results.length > 1000 ? '<p class="small muted">The first 1000 results are listed; save the results to see all.</p>' : ''}`;
  }
  function grepExport(kind) {
    const g = S().lastGrep; if (!g) { notify('Run a search first.', 'info'); return; }
    if (kind === 'json') download('grep-results.json', JSON.stringify(g, null, 2), 'application/json');
    else download('grep-results.txt', g.results.map((r) => r.file + ':' + r.line + ':' + r.col + ': ' + r.text).join('\n') + '\n');
  }

  // ---------- History ----------
  function recordHistory() {
    const s = S(); if (!s.pattern || !R.validate(s.pattern, s.flags).ok) return;
    if (history[0] && history[0].pattern === s.pattern && history[0].flags === s.flags) return;
    history = [{ pattern: s.pattern, flags: s.flags, replacement: s.replacement, at: new Date().toISOString(), from: s.label }].concat(history.filter((h) => h.pattern !== s.pattern || h.flags !== s.flags)).slice(0, 50);
    saveHistory();
  }
  function saveHistory() { if (store.get(HIST_ON, false)) store.set(HIST_KEY, history); }
  function panelHistory(p) {
    p.innerHTML = `<label class="switch-row"><span>Keep history on this device</span><input type="checkbox" role="switch" data-hist-keep ${store.get(HIST_ON, false) ? 'checked' : ''}></label>
<p class="small muted">Off by default: history then lasts until you close the app. Patterns are recorded after you pause typing. Search fields keep their own separate history.</p>
${history.length ? `<ul class="rxw-hist">${history.map((h, k) => `<li><code>${esc(h.pattern)}</code><span class="small muted">flags ${esc(h.flags || 'none')}, ${esc(h.from)}, ${esc(new Date(h.at).toLocaleString())}</span><span class="row"><button type="button" class="btn sm" data-act="hist-recall" data-k="${k}">Recall</button><button type="button" class="btn sm light" data-act="hist-del" data-k="${k}" aria-label="Remove history entry ${k + 1}">Remove</button></span></li>`).join('')}</ul><div class="row rxw-actions"><button type="button" class="btn sm danger" data-act="hist-clear">Clear history</button></div>` : '<p class="muted">No history yet.</p>'}`;
  }

  // ---------- Export and import ----------
  function panelShare(p) {
    p.innerHTML = `<h3>Export</h3>
<label class="switch-row"><span>Include the test subject text</span><input type="checkbox" role="switch" data-inc-subject></label>
<div class="row rxw-actions"><button type="button" class="btn sm" data-act="export-session">Save this session</button><button type="button" class="btn sm" data-act="export-library">Save my library</button><button type="button" class="btn sm" data-act="copy-js">Copy as a JavaScript literal</button><button type="button" class="btn sm" data-act="copy-json">Copy as JSON</button></div>
<h3>Import</h3>
<p class="small muted">Imports a file saved by this workbench. Nothing in the file is run; every pattern is checked before it is added to the library.</p>
<label class="btn sm rxw-file">Choose a file to import<input type="file" accept=".json,application/json" data-file="import" class="sr"></label>
<div data-import role="status" aria-live="polite"></div>`;
  }
  function exportSession() {
    const s = S(); const inc = q('[data-inc-subject]').checked;
    const item = { name: s.label + ' session', description: '', pattern: s.pattern, flags: s.flags, replacement: s.replacement, tests: s.tests };
    if (inc) item.subject = s.subject;
    download('regex-session.json', JSON.stringify({ kind: 'mvl-regex', version: 1, engine: ENGINE.name + ' ' + ENGINE.version, saved: new Date().toISOString(), items: [item] }, null, 2), 'application/json');
  }
  function exportLibrary() {
    const items = lib(); if (!items.length) { notify('Your library is empty. Built-in patterns are not exported.', 'info'); return; }
    download('regex-library.json', JSON.stringify({ kind: 'mvl-regex', version: 1, saved: new Date().toISOString(), items: items.map(({ id, ...rest }) => rest) }, null, 2), 'application/json');
  }
  let pendingImport = null;
  async function importFile(input) {
    const f = input.files && input.files[0]; input.value = ''; const box = q('[data-import]');
    if (!f) return;
    if (f.size > 2e6) { box.innerHTML = '<p class="errbox">That file is larger than 2 MB, so it was not read.</p>'; return; }
    try {
      pendingImport = R.validateImport(JSON.parse(await f.text()));
      box.innerHTML = `<p>${pendingImport.length} patterns are ready to add:</p><ul class="rxw-hist">${pendingImport.slice(0, 50).map((it) => `<li><strong>${esc(it.name)}</strong><code>${esc(it.pattern)}</code>${R.validate(it.pattern, it.flags).ok ? '' : '<span class="small">The engine rejects this pattern; it is kept so you can fix it.</span>'}</li>`).join('')}</ul><div class="row rxw-actions"><button type="button" class="btn primary sm" data-act="import-add">Add to library</button></div>`;
    } catch (e) { pendingImport = null; box.innerHTML = `<p class="errbox">Nothing was imported: ${esc(e.message)}</p>`; }
  }
  function importAdd() {
    if (!pendingImport) return;
    const items = lib().concat(pendingImport.map((it, k) => Object.assign({ id: 'i' + Date.now().toString(36) + k }, it)));
    if (!store.set(LIB_KEY, items)) { notify('The library could not be saved: storage is unavailable.', 'error'); return; }
    notify(pendingImport.length + ' patterns added to the library.', 'success'); pendingImport = null; q('[data-import]').textContent = 'Imported.';
  }

  // ---------- opening from a search field ----------
  // openWith({ key, label, pattern, flags, onApply }) opens the workbench on that field's own session.
  function openWith(o) {
    o = o || {};
    const key = o.key || 'standalone';
    session(key, { label: o.label || 'Search', pattern: o.pattern, flags: o.flags, onApply: o.onApply });
    activeKey = key;
    window.MVLTools.open('regex-workbench');
  }

  window.MVLTools.register({ id: 'regex-workbench', title: 'Regex workbench', group: 'Developer tools', summary: 'Build, explain, test, debug and benchmark regular expressions', mount, unmount });
  window.MVLRegexWorkbench = { openWith, sessions: () => [...sessions.keys()], _session: (k) => sessions.get(k) };
})();
