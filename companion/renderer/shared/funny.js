'use strict';
// Funny level and dialog emoji.
//  - Two independent levels, one for English and one for Cantonese, from 1 (fully serious) to 5
//    (most playful). Both start at 5 and each can be reset on its own.
//  - The level changes the voice of a message, never its facts. Level 1 returns the plain text
//    exactly. Higher levels wrap the untouched plain text with a short lead-in, and at level 5 a
//    short tail, picked from a small pool per category. The pick is deterministic (a hash of the
//    category and the text), so the same message always reads the same way.
//  - MVLFunny.style(category, plainText, { lang }) returns the styled text. lang is 'en', 'yue' or
//    'bi'; when it is left out it follows MVLI18n.mode(). For Cantonese the plain text is first
//    translated with MVLI18n.translate, so the result is already Cantonese.
//  - MVLFunny.fill(el, category, plainText) and MVLFunny.html(category, plainText) put a styled
//    message on screen. When the result is already in Cantonese they mark it data-i18n-skip so the
//    language switch does not try to translate it a second time.
//  - MVLFunny.emoji(category) returns one fitting emoji, or '' when the "Emoji in dialogs" switch is
//    off. MVLFunny.emojiHTML(category) and MVLFunny.decorate(titleEl, category) add it as a
//    decorative, aria-hidden span, so accessible names keep only the facts.
(function () {
  const KEY = 'mvl-funny';
  const DEFAULTS = { en: 5, yue: 5, emoji: true };
  const MIN = 1, MAX = 5;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get() { try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } },
    set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* storage may be unavailable; the setting lasts for this page */ } }
  };
  const clamp = (n) => { n = Math.round(Number(n)); return Number.isFinite(n) ? Math.min(MAX, Math.max(MIN, n)) : MAX; };
  const saved = store.get();
  const prefs = { en: clamp(saved.en == null ? DEFAULTS.en : saved.en), yue: clamp(saved.yue == null ? DEFAULTS.yue : saved.yue), emoji: saved.emoji == null ? DEFAULTS.emoji : !!saved.emoji };
  const listeners = new Set();
  const changed = () => { store.set(prefs); for (const f of listeners) { try { f(Object.assign({}, prefs)); } catch { /* listener errors stay local */ } } };

  // ---------- pools ----------
  // Per category and language: lead-ins for levels 2, 3 and 4 (two each), and tails for level 5.
  // Lines never blame the person and never joke about lost data or money.
  const POOLS = {
    info: {
      en: { lead: [['Quick note:', 'Heads up:'], ['Small news:', 'For your records:'], ['Fresh from the lab:', 'Hot off the console:']], tail: ['Carry on, captain.', 'The lab hums along.'] },
      yue: { lead: [['提提你：', '話你知：'], ['小小消息：', '記低先：'], ['實驗室新鮮出爐：', '熱辣辣消息：']], tail: ['繼續加油！', '實驗室照常運作緊。'] }
    },
    success: {
      en: { lead: [['Done:', 'All set:'], ['Nice one:', 'Sorted:'], ['Ta-da!', 'Smooth as silk:']], tail: ['High five.', 'The machines approve.'] },
      yue: { lead: [['搞掂：', '完成：'], ['做得好：', '好嘢：'], ['噹噹！', '順利過骨：']], tail: ['畀個讚你。', '部機都讚你。'] }
    },
    error: {
      en: { lead: [['Problem:', 'That did not work:'], ['Snag ahead:', 'Hmm, a hiccup:'], ['Plot twist:', 'The lab tripped over a cable:']], tail: ['We can sort this out together.', 'Take a breath, then pick an option.'] },
      yue: { lead: [['出咗問題：', '做唔到：'], ['有啲阻滯：', '唔好意思，卡住咗：'], ['劇情急轉：', '實驗室絆親條線：']], tail: ['慢慢嚟，一齊搞掂佢。', '唞啖氣，再揀下一步。'] }
    },
    warning: {
      en: { lead: [['Note:', 'Careful:'], ['Eyes up:', 'Worth a look:'], ['Yellow flag:', 'Tiny alarm bell:']], tail: ['Better safe than sorry.', 'Read twice, click once.'] },
      yue: { lead: [['留意：', '小心：'], ['睇多眼：', '值得留意：'], ['亮黃燈：', '警鐘輕輕響：']], tail: ['小心駛得萬年船。', '睇清楚先撳。'] }
    },
    empty: {
      en: { lead: [['Empty for now:', 'Quiet in here:'], ['Fresh slate:', 'All clear:'], ['Tumbleweeds:', 'Echo, echo:']], tail: ['Plenty of room for something new.', 'A blank page is a fine start.'] },
      yue: { lead: [['暫時未有：', '呢度靜靜哋：'], ['一張白紙：', '乾乾淨淨：'], ['空空如也：', '得返回音：']], tail: ['大把位等你發揮。', '由零開始都幾好。'] }
    },
    confirm: {
      en: { lead: [['Please check:', 'Just to be sure:'], ['Quick double-check:', 'Before we go:'], ['Drumroll first:', 'One tiny pause:']], tail: ['Your call.', 'No rush.'] },
      yue: { lead: [['請確認：', '確認一下：'], ['再核對一次：', '出發之前：'], ['打鼓先：', '停一停諗一諗：']], tail: ['你話事。', '唔使急。'] }
    },
    destructive: {
      en: { lead: [['Careful:', 'Please read:'], ['Big step:', 'Serious button ahead:'], ['Heavy lever time:', 'Both hands on the wheel:']], tail: ['Take your time.', 'Only you can turn these keys.'] },
      yue: { lead: [['小心：', '請細心睇：'], ['呢步好大：', '前面係重要掣：'], ['要拉大閘喇：', '雙手揸穩軚：']], tail: ['慢慢嚟。', '條匙只有你扭得。'] }
    },
    status: {
      en: { lead: [['Status:', 'Update:'], ['Lab report:', 'Checking in:'], ['Beep boop:', 'Radio check:']], tail: ['Over.', 'More soon.'] },
      yue: { lead: [['狀態：', '更新：'], ['實驗室報告：', '報告最新情況：'], ['嘀嘀嘟嘟：', '無線電測試：']], tail: ['完畢。', '稍後再報。'] }
    }
  };
  // Other names callers may use. Takeovers and notification kinds map onto the pools above.
  const ALIAS = { toast: 'info', notify: 'info', notification: 'info', 'takeover-success': 'success', 'takeover-failure': 'error', takeover: 'success', failure: 'error', alert: 'warning', superconfirm: 'destructive', delete: 'destructive', 'status-line': 'status' };
  const EMOJI = { info: '💡', success: '🎉', error: '🧯', warning: '⚠️', empty: '🫙', confirm: '🤔', destructive: '🛑', status: '📡', 'takeover-success': '🥳', 'takeover-failure': '🚧' };
  const cat = (c) => { c = String(c || 'info').toLowerCase(); return POOLS[c] ? c : (ALIAS[c] || 'info'); };

  // Every lead-in, so text that was already styled is not styled twice.
  const LEADS = { en: [], yue: [] };
  for (const c in POOLS) for (const l of ['en', 'yue']) for (const tier of POOLS[c][l].lead) LEADS[l].push(...tier);

  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  const isCjkEnd = (s) => /[　-〿㐀-鿿＀-￯]$/.test(s);

  function resolveLang(lang) {
    if (lang === 'en' || lang === 'yue' || lang === 'bi') return lang;
    if (lang === 'zh-HK' || lang === 'zh' || lang === 'both') return lang === 'both' ? 'bi' : 'yue';
    return window.MVLI18n && typeof window.MVLI18n.mode === 'function' ? window.MVLI18n.mode() : 'en';
  }
  function toYue(plain) {
    if (!window.MVLI18n || typeof window.MVLI18n.translate !== 'function') return plain;
    const r = window.MVLI18n.translate(plain);
    return typeof r === 'string' && r ? r : plain;
  }

  // Styles one message for one language. Returns { text, localized }.
  function one(category, plain, lang) {
    const level = prefs[lang];
    // Level 1 is the plain text exactly; translating it stays the language switch's job.
    if (level <= 1 || !plain.trim()) return { text: plain, localized: false };
    const base = lang === 'yue' ? toYue(plain) : plain;
    if (LEADS[lang].some((l) => base.startsWith(l))) return { text: base, localized: lang === 'yue' };
    const c = cat(category), pool = POOLS[c][lang], h = hash(c + '|' + plain);
    const lead = pool.lead[Math.min(level, 4) - 2][h % 2];
    const tail = level >= 5 ? pool.tail[(h >>> 1) % 2] : '';
    if (lang === 'yue') return { text: lead + base + (tail ? (/[。！？…：.!?:]$/.test(base) ? (isCjkEnd(base) ? '' : ' ') : '。') + tail : ''), localized: true };
    return { text: lead + ' ' + base + (tail ? (/[.!?…:]$/.test(base) ? ' ' : '. ') + tail : ''), localized: false };
  }

  // Returns the parts to show: { en, yue } where either may be null.
  function parts(category, plainText, opts) {
    const plain = String(plainText == null ? '' : plainText);
    const lang = resolveLang(opts && opts.lang);
    if (lang === 'en') return { en: one(category, plain, 'en').text, yue: null, localized: false };
    if (lang === 'yue') { const r = one(category, plain, 'yue'); return { en: null, yue: r.text, localized: r.localized }; }
    // Bilingual: both levels at 1 leaves the plain text for the language switch to handle.
    if (prefs.en <= 1 && prefs.yue <= 1) return { en: plain, yue: null, localized: false };
    const y = prefs.yue <= 1 ? toYue(plain) : one(category, plain, 'yue').text;
    return { en: one(category, plain, 'en').text, yue: y !== plain ? y : null, localized: true };
  }

  function style(category, plainText, opts) {
    const p = parts(category, plainText, opts);
    if (p.en != null && p.yue != null) return p.en + '\n' + p.yue;
    return p.en != null ? p.en : p.yue;
  }

  // Puts a styled message into an element (a toast, a status line, an empty-state paragraph).
  function fill(el, category, plainText, opts) {
    if (!el) return el;
    const p = parts(category, plainText, opts);
    if (p.localized) el.setAttribute('data-i18n-skip', ''); else el.removeAttribute('data-i18n-skip');
    if (p.en != null && p.yue != null) {
      el.textContent = '';
      const a = document.createElement('span'); a.lang = 'en'; a.textContent = p.en;
      const b = document.createElement('span'); b.lang = 'zh-HK'; b.className = 'mvl-funny-yue'; b.textContent = p.yue;
      el.append(a, b);
    } else if (p.yue != null) {
      el.textContent = p.yue;
      el.lang = 'zh-HK';
    } else {
      el.textContent = p.en;
      if (el.lang === 'zh-HK') el.removeAttribute('lang');
    }
    return el;
  }

  // Escaped markup for template strings such as the empty states.
  function html(category, plainText, opts) {
    const p = parts(category, plainText, opts);
    if (!p.localized) return esc(p.en != null ? p.en : p.yue);
    if (p.en != null && p.yue != null) return `<span data-i18n-skip><span lang="en">${esc(p.en)}</span><span class="mvl-funny-yue" lang="zh-HK">${esc(p.yue)}</span></span>`;
    return `<span data-i18n-skip lang="zh-HK">${esc(p.yue)}</span>`;
  }

  // ---------- emoji ----------
  function emoji(category) {
    if (!prefs.emoji) return '';
    const c = String(category || 'info').toLowerCase();
    return EMOJI[c] || EMOJI[cat(c)] || '';
  }
  function emojiHTML(category) { const e = emoji(category); return e ? `<span class="mvl-emoji" aria-hidden="true" data-i18n-skip data-vocab-skip>${e}</span> ` : ''; }
  function decorate(titleEl, category) {
    if (!titleEl) return titleEl;
    const old = titleEl.querySelector(':scope > .mvl-emoji');
    if (old) { if (old.nextSibling && old.nextSibling.nodeType === 3 && old.nextSibling.nodeValue === ' ') old.nextSibling.remove(); old.remove(); }
    const e = emoji(category);
    if (e) {
      const s = document.createElement('span');
      s.className = 'mvl-emoji'; s.setAttribute('aria-hidden', 'true'); s.setAttribute('data-i18n-skip', ''); s.setAttribute('data-vocab-skip', ''); s.textContent = e;
      titleEl.prepend(s, document.createTextNode(' '));
    }
    return titleEl;
  }

  // ---------- settings ----------
  const level = (lang) => prefs[lang === 'yue' || lang === 'zh-HK' ? 'yue' : 'en'];
  function set(lang, n) { const k = lang === 'yue' || lang === 'zh-HK' ? 'yue' : 'en'; prefs[k] = clamp(n); changed(); return prefs[k]; }
  function reset(lang) { return set(lang, DEFAULTS[lang === 'yue' || lang === 'zh-HK' ? 'yue' : 'en']); }
  function setEmoji(on) { prefs.emoji = !!on; changed(); return prefs.emoji; }

  const WORDS = { 1: 'Fully serious', 2: 'Gentle', 3: 'Friendly', 4: 'Playful', 5: 'Maximum playfulness' };

  // Cantonese wording for this control, added to the shared phrase table when it is loaded.
  // Entries that the table already has are left alone.
  const ZH = {
    'Funny level': '搞笑程度',
    'The funny level styles every message, errors and warnings included. English and Cantonese each start at 5. Facts never change. You can change or reset either at any time.': '搞笑程度會改變每一條訊息嘅語氣，錯誤同警告都包埋。英文同廣東話各自由 5 開始。事實內容永遠唔會變。你隨時可以改或者重設任何一個。',
    'English funny level': '英文搞笑程度',
    'Cantonese funny level': '廣東話搞笑程度',
    'Reset English': '重設英文',
    'Reset Cantonese': '重設廣東話',
    'Emoji in dialogs': '對話框加 emoji',
    'Adds one decorative emoji to dialog, takeover and notification titles. Never inside commands, names or numbers.': '喺對話框、全畫面提示同通知標題加一個裝飾用 emoji。指令、名稱同數字入面永遠唔會加。',
    'Fully serious': '完全正經', 'Gentle': '輕輕地', 'Friendly': '友善', 'Playful': '玩味', 'Maximum playfulness': '最搞笑',
    'Example': '例子'
  };
  function addPhrases() {
    const T = window.MVLI18nZhHK; if (!T || !T.phrases) return;
    for (const k in ZH) if (!Object.prototype.hasOwnProperty.call(T.phrases, k)) T.phrases[k] = ZH[k];
    if (Array.isArray(T.rules)) T.rules.push([/^([1-5]): (Fully serious|Gentle|Friendly|Playful|Maximum playfulness)$/, (m) => m[1] + '：' + ZH[m[2]]]);
  }
  addPhrases();
  const SAMPLE = 'Install finished: proof-1';

  function control() {
    const box = document.createElement('section');
    const id = 'funny-' + Math.random().toString(36).slice(2, 7);
    box.className = 'voice-control funny-control';
    box.setAttribute('aria-labelledby', id + 'h');
    const row = (lang, label) => `<div class="voice-slider" data-lang-row="${lang}">
  <div class="voice-slider-head"><label for="${id + lang}">${label}</label><output for="${id + lang}" data-out="${lang}" aria-live="polite"></output></div>
  <div class="voice-slider-line"><input type="range" id="${id + lang}" min="${MIN}" max="${MAX}" step="1" data-level="${lang}" aria-describedby="${id}d"><button type="button" class="btn sm" data-reset="${lang}">Reset ${lang === 'en' ? 'English' : 'Cantonese'}</button></div>
  <p class="small voice-sample" aria-hidden="true"><span>Example</span>: <span data-sample="${lang}" data-i18n-skip></span></p>
</div>`;
    box.innerHTML = `<h3 id="${id}h" class="voice-title">Funny level</h3>
<p class="small" id="${id}d">The funny level styles every message, errors and warnings included. English and Cantonese each start at 5. Facts never change. You can change or reset either at any time.</p>
${row('en', 'English funny level')}
${row('yue', 'Cantonese funny level')}
<label class="switch-row"><span>Emoji in dialogs<br><span class="small">Adds one decorative emoji to dialog, takeover and notification titles. Never inside commands, names or numbers.</span></span><input type="checkbox" role="switch" data-emoji></label>`;
    const sync = () => {
      for (const lang of ['en', 'yue']) {
        const v = prefs[lang];
        const input = box.querySelector(`[data-level="${lang}"]`);
        input.value = String(v);
        input.style.setProperty('--fill', ((v - MIN) / (MAX - MIN)) * 100 + '%');
        input.setAttribute('aria-valuetext', `${v} of 5, ${WORDS[v]}`);
        box.querySelector(`[data-out="${lang}"]`).textContent = `${v}: ${WORDS[v]}`;
        box.querySelector(`[data-reset="${lang}"]`).disabled = v === DEFAULTS[lang];
        const sample = box.querySelector(`[data-sample="${lang}"]`);
        sample.textContent = lang === 'yue' && prefs.yue <= 1 ? toYue(SAMPLE) : style('success', SAMPLE, { lang });
        sample.lang = lang === 'yue' ? 'zh-HK' : 'en';
      }
      box.querySelector('[data-emoji]').checked = prefs.emoji;
    };
    box.addEventListener('input', (e) => { const l = e.target.dataset && e.target.dataset.level; if (l) set(l, e.target.value); });
    box.addEventListener('click', (e) => { const b = e.target.closest('[data-reset]'); if (b) { reset(b.dataset.reset); box.querySelector(`[data-level="${b.dataset.reset}"]`).focus(); } });
    box.addEventListener('change', (e) => { if (e.target.matches('[data-emoji]')) setEmoji(e.target.checked); });
    listeners.add(sync);
    if (window.MVLI18n && window.MVLI18n.onChange) window.MVLI18n.onChange(sync);
    sync();
    return box;
  }

  // Live settings in the command palette (Ctrl+Shift+F).
  function registerPalette() {
    const P = window.MVLPalette; if (!P || !P.register) return;
    for (const [lang, name] of [['en', 'English'], ['yue', 'Cantonese']]) {
      for (let n = MIN; n <= MAX; n++) P.register({ id: `funny-${lang}-${n}`, group: 'Settings', title: `${name} funny level: ${n} (${WORDS[n]})`, keywords: 'funny humour humor playful serious voice tone messages', keepOpen: true, run: () => { set(lang, n); P.refresh(); } });
      P.register({ id: `funny-${lang}-reset`, group: 'Settings', title: `Reset ${name} funny level to 5`, keywords: 'funny reset default voice', keepOpen: true, run: () => { reset(lang); P.refresh(); } });
    }
    P.register({ id: 'funny-emoji', group: 'Settings', title: 'Emoji in dialogs: switch on or off', keywords: 'emoji dialog takeover notification title decoration', keepOpen: true, run: () => { setEmoji(!prefs.emoji); P.refresh(); } });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', registerPalette, { once: true }); else setTimeout(registerPalette);

  window.MVLFunny = { style, fill, html, emoji, emojiHTML, decorate, level, set, reset, emojiOn: () => prefs.emoji, setEmoji, control, onChange: (f) => listeners.add(f), categories: () => Object.keys(POOLS) };
})();
