'use strict';
// Spoken narrator. Off by default; the person switches it on in Settings.
//  - MVLNarrator.say(category, text) reads a message aloud in English, Cantonese, or both (English
//    first, then Cantonese, strictly one after the other). The text goes through MVLFunny.style for
//    the narrated language, so the funny level of that language applies to speech too.
//  - One queue, one line at a time. Lines wait a short debounce, and a category that has just spoken
//    waits a short cooldown. A newer line of the same category replaces a queued older one instead
//    of stacking up. Errors are never dropped by these limits and go ahead of other waiting lines.
//  - One voice picker per language lists the voices this machine actually has. The saved choice is
//    the voice's voiceURI (its stable identity), never its display name. Voices that arrive late
//    (the voiceschanged event) are picked up, and each picker says which voice will really speak.
//  - Without speech synthesis the control says so and every control is disabled.
(function () {
  const KEY = 'mvl-narrator';
  const DEFAULTS = { on: false, lang: 'en', voices: { en: '', yue: '' }, rate: 1, pitch: 1 };
  const RATE = { min: 0.5, max: 2, step: 0.1 };
  const PITCH = { min: 0, max: 2, step: 0.1 };
  const NAMES = { en: 'English', yue: 'Cantonese' };
  const SPOKEN = { en: 'en-US', yue: 'zh-HK' };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get() { try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } },
    set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* storage may be unavailable; the setting lasts for this page */ } }
  };
  const num = (v, r, d) => { v = Number(v); return Number.isFinite(v) ? Math.min(r.max, Math.max(r.min, Math.round(v * 10) / 10)) : d; };
  const saved = store.get();
  const prefs = {
    on: saved.on === true,
    lang: ['en', 'yue', 'both'].includes(saved.lang) ? saved.lang : DEFAULTS.lang,
    voices: { en: String((saved.voices && saved.voices.en) || ''), yue: String((saved.voices && saved.voices.yue) || '') },
    rate: num(saved.rate, RATE, DEFAULTS.rate),
    pitch: num(saved.pitch, PITCH, DEFAULTS.pitch)
  };
  // Cantonese wording for this control, added to the shared phrase table when it is loaded.
  // Entries that the table already has are left alone. Dynamic lines use rules.
  const ZH = {
    'Read messages aloud': '讀出訊息',
    'Narrator': '旁白',
    "Off unless you switch it on. Reads notifications, errors, confirmations and status lines with your system's voices.": '預設關閉，要你自己開。開咗之後會用系統嘅聲音讀出通知、錯誤、確認同狀態。',
    'Narrated language': '旁白語言',
    'English': '英文', 'Cantonese': '廣東話', 'Both': '兩樣都要',
    'Both reads English first, then Cantonese, one after the other.': '「兩樣都要」會先讀英文，再讀廣東話，一句讀完先讀下一句。',
    'English voice': '英文聲音', 'Cantonese voice': '廣東話聲音',
    'Choose automatically': '自動揀', 'Not installed': '未安裝', network: '靠網絡',
    'Speaking rate': '語速', 'Pitch': '音高',
    'Read a sample': '讀個示範', 'Stop reading': '停止朗讀', 'Reset rate and pitch': '重設語速同音高',
    'Speech is not available here: this window has no speech synthesis, so messages cannot be read aloud. The narrator controls are disabled.': '呢度用唔到語音：呢個視窗冇語音合成，所以讀唔到訊息。旁白控制已經停用。',
    'Speech is not available, so nothing is read aloud.': '用唔到語音，所以乜都唔會讀。'
  };
  const LZ = { English: '英文', Cantonese: '廣東話' };
  const NETZ = '呢把聲靠網絡，裝置離線嗰陣可能會冇聲。';
  const NET_RX = '( This voice is network-backed and may go quiet when the device is offline\\.)?';
  (function addPhrases() {
    const T = window.MVLI18nZhHK; if (!T || !T.phrases) return;
    for (const k in ZH) if (!Object.prototype.hasOwnProperty.call(T.phrases, k)) T.phrases[k] = ZH[k];
    if (!Array.isArray(T.rules)) return;
    T.rules.push(
      [/^(\d\.\d) \(default\)$/, (m) => m[1] + '（預設）'],
      [new RegExp('^Speaking with (.+) \\((\\S+)\\)\\.' + NET_RX + '$'), (m) => `用緊 ${m[1]}（${m[2]}）讀。` + (m[3] ? NETZ : '')],
      [new RegExp('^Chosen automatically: speaking with (.+) \\((\\S+)\\)\\.' + NET_RX + '$'), (m) => `自動揀咗：用緊 ${m[1]}（${m[2]}）讀。` + (m[3] ? NETZ : '')],
      [new RegExp('^Your chosen voice \\((.+)\\) is not installed on this device\\. Speaking with (.+) \\((\\S+)\\) instead\\. Your choice is kept and is used again once that voice is back\\.' + NET_RX + '$'), (m) => `你揀嘅聲音（${m[1]}）喺呢部機冇裝。暫時改用 ${m[2]}（${m[3]}）讀。你嘅選擇會保留，嗰把聲裝返之後會再用。` + (m[4] ? NETZ : '')],
      [/^Your chosen voice \((.+)\) is not installed on this device, and no other (English|Cantonese) voice is, so \2 lines are not spoken\. Your choice is kept\.$/, (m) => `你揀嘅聲音（${m[1]}）喺呢部機冇裝，亦冇其他${LZ[m[2]]}聲音，所以唔會讀${LZ[m[2]]}。你嘅選擇會保留。`],
      [/^No (English|Cantonese) voice is installed on this device, so \1 lines are not spoken\. Voices are added in the system's speech or language settings\.$/, (m) => `呢部機冇裝${LZ[m[1]]}聲音，所以唔會讀${LZ[m[1]]}。可以喺系統嘅語音或者語言設定加聲音。`]
    );
  })();
  const synth = typeof window.speechSynthesis === 'object' && window.speechSynthesis ? window.speechSynthesis : null;
  const available = () => !!(synth && typeof window.SpeechSynthesisUtterance === 'function');
  const listeners = new Set();
  const changed = (persist) => { if (persist !== false) store.set(prefs); for (const f of listeners) { try { f(); } catch { /* listener errors stay local */ } } };

  // ---------- voices ----------
  const RX = { en: /^en(?:[-_]|$)/i, yue: /^(?:yue|zh[-_](?:hk|yue)|zh[-_]hant[-_]hk)(?:[-_]|$)/i };
  function allVoices() { try { return available() ? (synth.getVoices() || []).slice() : []; } catch { return []; } }
  function voicesFor(lang, list) {
    return (list || allVoices()).filter((v) => RX[lang].test(v.lang || '') || (lang === 'yue' && /cantonese|粵|廣東/i.test(v.name || '')));
  }
  function auto(list) {
    return list.find((v) => v.localService && v.default) || list.find((v) => v.localService) || list.find((v) => v.default) || list[0] || null;
  }
  // What will really speak for a language: { voice, state: 'chosen'|'auto'|'missing'|'none', saved }.
  function resolve(lang) {
    const all = allVoices(), list = voicesFor(lang, all), want = prefs.voices[lang];
    if (want) {
      const v = all.find((x) => x.voiceURI === want);
      if (v) return { voice: v, state: 'chosen', saved: want };
      return { voice: auto(list), state: 'missing', saved: want };
    }
    const v = auto(list);
    return { voice: v, state: v ? 'auto' : 'none', saved: '' };
  }
  function describe(lang) {
    if (!available()) return 'Speech is not available, so nothing is read aloud.';
    const r = resolve(lang), L = NAMES[lang];
    const who = (v) => `${v.name} (${v.lang})`;
    const net = (v) => (v && v.localService === false ? ' This voice is network-backed and may go quiet when the device is offline.' : '');
    if (r.state === 'chosen') return `Speaking with ${who(r.voice)}.${net(r.voice)}`;
    if (r.state === 'auto') return `Chosen automatically: speaking with ${who(r.voice)}.${net(r.voice)}`;
    if (r.state === 'missing') {
      return r.voice
        ? `Your chosen voice (${r.saved}) is not installed on this device. Speaking with ${who(r.voice)} instead. Your choice is kept and is used again once that voice is back.${net(r.voice)}`
        : `Your chosen voice (${r.saved}) is not installed on this device, and no other ${L} voice is, so ${L} lines are not spoken. Your choice is kept.`;
    }
    return `No ${L} voice is installed on this device, so ${L} lines are not spoken. Voices are added in the system's speech or language settings.`;
  }

  // ---------- queue ----------
  let DEBOUNCE = 250, COOLDOWN = 4000;
  let queue = [], current = null, lastGroup = 0, seq = 0, timer = null, watchdog = null;
  const lastStart = new Map(); // category -> time its last group started
  const history = [];
  const isError = (c) => /^(error|failure|takeover-failure)$/i.test(String(c || ''));

  function narrated(category, text, lang) {
    const F = window.MVLFunny;
    let t = F && F.style ? F.style(category, text, { lang }) : text;
    if (lang === 'yue' && t === text && window.MVLI18n && window.MVLI18n.translate) t = window.MVLI18n.translate(text);
    return String(t);
  }

  function say(category, text, opts) {
    const force = opts && opts.force;
    if (!available() || (!prefs.on && !force) || text == null || !String(text).trim()) return false;
    const cat = String(category || 'info'), err = isError(cat), now = Date.now(), group = ++seq;
    const langs = prefs.lang === 'both' ? ['en', 'yue'] : [prefs.lang];
    const items = langs.map((lang) => ({ cat, lang, text: narrated(cat, String(text), lang), group, err, at: now }));
    if (err) {
      // Errors go ahead of waiting lines that are not errors, at a group boundary.
      let i = queue.findIndex((q) => !q.err && !(current && q.group === current.group));
      if (i < 0) i = queue.length;
      queue.splice(i, 0, ...items);
    } else {
      // A newer line of the same category replaces the queued older one in place.
      const keep = (q) => q.cat !== cat || q.err || (current && q.group === current.group);
      const first = queue.findIndex((q) => !keep(q));
      queue = queue.filter(keep);
      if (first >= 0) queue.splice(Math.min(first, queue.length), 0, ...items); else queue.push(...items);
    }
    pump();
    return true;
  }

  function readyAt(q) { return q.err ? q.at : Math.max(q.at + DEBOUNCE, (lastStart.get(q.cat) || 0) + COOLDOWN); }

  function pump() {
    clearTimeout(timer); timer = null;
    if (current || !queue.length) return;
    // The second half of a "Both" pair always follows its first half straight away.
    let i = queue[0].group === lastGroup ? 0 : -1;
    const now = Date.now();
    if (i < 0) i = queue.findIndex((q, k) => (k === 0 || queue[k - 1].group !== q.group) && readyAt(q) <= now);
    if (i < 0) {
      const next = Math.min(...queue.map(readyAt));
      timer = setTimeout(pump, Math.max(10, next - now));
      return;
    }
    const item = queue.splice(i, 1)[0];
    if (item.group !== lastGroup) lastStart.set(item.cat, now);
    speak(item);
  }

  function finish(item) {
    if (current !== item) return;
    clearTimeout(watchdog); watchdog = null;
    current = null; lastGroup = item.group;
    pump();
  }

  function speak(item) {
    current = item;
    const r = resolve(item.lang);
    if (!r.voice) { history.push({ lang: item.lang, cat: item.cat, text: item.text, voice: null, skipped: true }); setTimeout(() => finish(item)); return; }
    let u;
    try { u = new window.SpeechSynthesisUtterance(item.text); } catch { setTimeout(() => finish(item)); return; }
    u.voice = r.voice; u.lang = r.voice.lang || SPOKEN[item.lang]; u.rate = prefs.rate; u.pitch = prefs.pitch;
    u.onend = () => finish(item);
    u.onerror = () => finish(item);
    // Some engines never report the end; keep the queue moving anyway.
    watchdog = setTimeout(() => finish(item), 6000 + item.text.length * 140 / prefs.rate);
    history.push({ lang: item.lang, cat: item.cat, text: item.text, voice: r.voice.voiceURI });
    if (history.length > 100) history.shift();
    try { synth.speak(u); } catch { finish(item); }
  }

  function stop() {
    queue = []; clearTimeout(timer); clearTimeout(watchdog); timer = watchdog = null;
    const was = current; current = null; if (was) lastGroup = was.group;
    try { if (synth) synth.cancel(); } catch { /* nothing to cancel */ }
  }

  // ---------- settings ----------
  function setOn(on) { prefs.on = !!on; if (!prefs.on) stop(); changed(); return prefs.on; }
  function setLang(l) { if (['en', 'yue', 'both'].includes(l)) { prefs.lang = l; changed(); } return prefs.lang; }
  function setVoice(lang, uri) { prefs.voices[lang] = String(uri || ''); changed(); }
  function setRate(v) { prefs.rate = num(v, RATE, 1); changed(); }
  function setPitch(v) { prefs.pitch = num(v, PITCH, 1); changed(); }

  // Late voice lists: re-read and redraw every mounted control.
  if (synth) {
    const onVoices = () => changed(false);
    if (typeof synth.addEventListener === 'function') synth.addEventListener('voiceschanged', onVoices);
    else { const prev = synth.onvoiceschanged; synth.onvoiceschanged = (e) => { if (typeof prev === 'function') prev(e); onVoices(); }; }
  }

  function control() {
    const box = document.createElement('section');
    const id = 'narr-' + Math.random().toString(36).slice(2, 7);
    box.className = 'voice-control narrator-control';
    box.setAttribute('aria-labelledby', id + 'h');
    const ok = available();
    const picker = (lang) => `<div class="voice-picker" data-picker="${lang}">
  <label class="voice-field" for="${id}v${lang}">${NAMES[lang]} voice<select id="${id}v${lang}" data-voice="${lang}" aria-describedby="${id}e${lang}"></select></label>
  <p class="small voice-effect" id="${id}e${lang}" data-effect="${lang}" aria-live="polite"></p>
</div>`;
    const slider = (k, label, r) => `<div class="voice-slider">
  <div class="voice-slider-head"><label for="${id}${k}">${label}</label><output for="${id}${k}" data-out="${k}"></output></div>
  <input type="range" id="${id}${k}" min="${r.min}" max="${r.max}" step="${r.step}" data-num="${k}">
</div>`;
    box.innerHTML = `<h3 id="${id}h" class="voice-title">Read messages aloud</h3>
${ok ? '' : '<p class="voice-unavailable" role="status">Speech is not available here: this window has no speech synthesis, so messages cannot be read aloud. The narrator controls are disabled.</p>'}
<label class="switch-row"><span>Narrator<br><span class="small">Off unless you switch it on. Reads notifications, errors, confirmations and status lines with your system's voices.</span></span><input type="checkbox" role="switch" data-on></label>
<div class="voice-group"><span class="voice-label" id="${id}l">Narrated language</span>
<div class="seg voice-seg" role="group" aria-labelledby="${id}l"><button type="button" data-nlang="en">English</button><button type="button" data-nlang="yue">Cantonese</button><button type="button" data-nlang="both">Both</button></div>
<p class="small">Both reads English first, then Cantonese, one after the other.</p></div>
${picker('en')}
${picker('yue')}
${slider('rate', 'Speaking rate', RATE)}
${slider('pitch', 'Pitch', PITCH)}
<div class="row voice-actions"><button type="button" class="btn sm" data-act="sample">Read a sample</button><button type="button" class="btn sm" data-act="stop">Stop reading</button><button type="button" class="btn sm" data-act="defaults">Reset rate and pitch</button></div>`;

    function options(lang) {
      const sel = box.querySelector(`[data-voice="${lang}"]`);
      const all = allVoices(), list = voicesFor(lang, all), want = prefs.voices[lang];
      // Options sit inside a select, which the language switch does not rewrite, so they are worded here.
      const m = window.MVLI18n && window.MVLI18n.mode ? window.MVLI18n.mode() : 'en';
      const tr = (x) => (m === 'en' ? x : m === 'yue' ? ZH[x] : x + ' · ' + ZH[x]);
      let h = `<option value="">${esc(tr('Choose automatically'))}</option>`;
      for (const v of list) h += `<option value="${esc(v.voiceURI)}">${esc(v.name)} (${esc(v.lang)})${v.localService === false ? ' · ' + esc(tr('network')) : ''}</option>`;
      if (want && !all.some((v) => v.voiceURI === want)) h += `<option value="${esc(want)}">${esc(tr('Not installed'))}: ${esc(want)}</option>`;
      if (sel.dataset.sig !== h) { sel.innerHTML = h; sel.dataset.sig = h; }
      sel.value = want;
      box.querySelector(`[data-effect="${lang}"]`).textContent = describe(lang);
    }
    function sync() {
      box.querySelector('[data-on]').checked = prefs.on;
      for (const b of box.querySelectorAll('[data-nlang]')) b.setAttribute('aria-pressed', String(b.dataset.nlang === prefs.lang));
      options('en'); options('yue');
      for (const k of ['rate', 'pitch']) {
        const v = prefs[k];
        const r = k === 'rate' ? RATE : PITCH, input = box.querySelector(`[data-num="${k}"]`);
        input.value = String(v);
        input.style.setProperty('--fill', ((v - r.min) / (r.max - r.min)) * 100 + '%');
        box.querySelector(`[data-out="${k}"]`).textContent = v.toFixed(1) + (v === 1 ? ' (default)' : '');
      }
      if (!ok) for (const el of box.querySelectorAll('input, select, button')) el.disabled = true;
    }
    box.addEventListener('change', (e) => {
      if (e.target.matches('[data-on]')) setOn(e.target.checked);
      else if (e.target.dataset.voice) setVoice(e.target.dataset.voice, e.target.value);
    });
    box.addEventListener('input', (e) => {
      if (e.target.dataset.num === 'rate') setRate(e.target.value);
      if (e.target.dataset.num === 'pitch') setPitch(e.target.value);
    });
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-nlang], [data-act]'); if (!b) return;
      if (b.dataset.nlang) setLang(b.dataset.nlang);
      else if (b.dataset.act === 'sample') say('info', 'This is how messages will sound.', { force: true });
      else if (b.dataset.act === 'stop') stop();
      else if (b.dataset.act === 'defaults') { prefs.rate = 1; prefs.pitch = 1; changed(); }
    });
    box.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(e.key) || !e.target.dataset.nlang) return;
      const bs = [...box.querySelectorAll('[data-nlang]')]; const i = bs.indexOf(e.target);
      e.preventDefault(); bs[(i + (e.key === 'ArrowRight' ? 1 : -1) + bs.length) % bs.length].focus();
    });
    listeners.add(sync);
    if (window.MVLI18n && window.MVLI18n.onChange) window.MVLI18n.onChange(sync);
    sync();
    return box;
  }

  function registerPalette() {
    const P = window.MVLPalette; if (!P || !P.register || !available()) return;
    P.register({ id: 'narrator-on', group: 'Settings', title: 'Read messages aloud: switch on or off', keywords: 'narrator speech voice speak read aloud accessibility', keepOpen: true, run: () => { setOn(!prefs.on); P.refresh(); } });
    for (const [l, t] of [['en', 'English'], ['yue', 'Cantonese'], ['both', 'Both (English, then Cantonese)']]) P.register({ id: 'narrator-lang-' + l, group: 'Settings', title: 'Narrated language: ' + t, keywords: 'narrator speech language voice', keepOpen: true, run: () => { setLang(l); P.refresh(); } });
    P.register({ id: 'narrator-stop', group: 'Actions', title: 'Stop reading aloud', keywords: 'narrator speech stop silence quiet', run: stop });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', registerPalette, { once: true }); else setTimeout(registerPalette);

  window.MVLNarrator = {
    say, stop, control, available,
    enabled: () => prefs.on, setOn, setLang, setVoice, setRate, setPitch,
    settings: () => JSON.parse(JSON.stringify(prefs)),
    resolve: (lang) => { const r = resolve(lang); return { voiceURI: r.voice ? r.voice.voiceURI : null, name: r.voice ? r.voice.name : null, state: r.state, saved: r.saved, network: !!(r.voice && r.voice.localService === false) }; },
    describe,
    pending: () => queue.map((q) => ({ cat: q.cat, lang: q.lang, text: q.text })),
    history: () => history.slice(),
    timing: (debounce, cooldown) => { if (debounce != null) DEBOUNCE = Math.max(0, +debounce); if (cooldown != null) COOLDOWN = Math.max(0, +cooldown); },
    onChange: (f) => listeners.add(f)
  };
})();
