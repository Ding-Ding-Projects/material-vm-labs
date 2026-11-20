'use strict';
// Personal settings core: pure logic shared by the personal tools (School mode, display name, ADHD
// modes, scheduled settings, appearance editor, colour picker, logo) and by the plain Node tests.
// Nothing here touches the network. In a browser it also offers small storage and history helpers.
(function (root) {
  // ---------- colour ----------
  // Internal colour: { r, g, b, a } with r, g, b as gamma-encoded sRGB floats (may sit outside 0..1
  // when the source space is wider than sRGB) and a in 0..1.
  const NAMED = {
    aliceblue: 'f0f8ff', antiquewhite: 'faebd7', aqua: '00ffff', aquamarine: '7fffd4', azure: 'f0ffff', beige: 'f5f5dc', bisque: 'ffe4c4', black: '000000', blanchedalmond: 'ffebcd', blue: '0000ff', blueviolet: '8a2be2', brown: 'a52a2a', burlywood: 'deb887', cadetblue: '5f9ea0', chartreuse: '7fff00', chocolate: 'd2691e', coral: 'ff7f50', cornflowerblue: '6495ed', cornsilk: 'fff8dc', crimson: 'dc143c', cyan: '00ffff', darkblue: '00008b', darkcyan: '008b8b', darkgoldenrod: 'b8860b', darkgray: 'a9a9a9', darkgreen: '006400', darkgrey: 'a9a9a9', darkkhaki: 'bdb76b', darkmagenta: '8b008b', darkolivegreen: '556b2f', darkorange: 'ff8c00', darkorchid: '9932cc', darkred: '8b0000', darksalmon: 'e9967a', darkseagreen: '8fbc8f', darkslateblue: '483d8b', darkslategray: '2f4f4f', darkslategrey: '2f4f4f', darkturquoise: '00ced1', darkviolet: '9400d3', deeppink: 'ff1493', deepskyblue: '00bfff', dimgray: '696969', dimgrey: '696969', dodgerblue: '1e90ff', firebrick: 'b22222', floralwhite: 'fffaf0', forestgreen: '228b22', fuchsia: 'ff00ff', gainsboro: 'dcdcdc', ghostwhite: 'f8f8ff', gold: 'ffd700', goldenrod: 'daa520', gray: '808080', green: '008000', greenyellow: 'adff2f', grey: '808080', honeydew: 'f0fff0', hotpink: 'ff69b4', indianred: 'cd5c5c', indigo: '4b0082', ivory: 'fffff0', khaki: 'f0e68c', lavender: 'e6e6fa', lavenderblush: 'fff0f5', lawngreen: '7cfc00', lemonchiffon: 'fffacd', lightblue: 'add8e6', lightcoral: 'f08080', lightcyan: 'e0ffff', lightgoldenrodyellow: 'fafad2', lightgray: 'd3d3d3', lightgreen: '90ee90', lightgrey: 'd3d3d3', lightpink: 'ffb6c1', lightsalmon: 'ffa07a', lightseagreen: '20b2aa', lightskyblue: '87cefa', lightslategray: '778899', lightslategrey: '778899', lightsteelblue: 'b0c4de', lightyellow: 'ffffe0', lime: '00ff00', limegreen: '32cd32', linen: 'faf0e6', magenta: 'ff00ff', maroon: '800000', mediumaquamarine: '66cdaa', mediumblue: '0000cd', mediumorchid: 'ba55d3', mediumpurple: '9370db', mediumseagreen: '3cb371', mediumslateblue: '7b68ee', mediumspringgreen: '00fa9a', mediumturquoise: '48d1cc', mediumvioletred: 'c71585', midnightblue: '191970', mintcream: 'f5fffa', mistyrose: 'ffe4e1', moccasin: 'ffe4b5', navajowhite: 'ffdead', navy: '000080', oldlace: 'fdf5e6', olive: '808000', olivedrab: '6b8e23', orange: 'ffa500', orangered: 'ff4500', orchid: 'da70d6', palegoldenrod: 'eee8aa', palegreen: '98fb98', paleturquoise: 'afeeee', palevioletred: 'db7093', papayawhip: 'ffefd5', peachpuff: 'ffdab9', peru: 'cd853f', pink: 'ffc0cb', plum: 'dda0dd', powderblue: 'b0e0e6', purple: '800080', rebeccapurple: '663399', red: 'ff0000', rosybrown: 'bc8f8f', royalblue: '4169e1', saddlebrown: '8b4513', salmon: 'fa8072', sandybrown: 'f4a460', seagreen: '2e8b57', seashell: 'fff5ee', sienna: 'a0522d', silver: 'c0c0c0', skyblue: '87ceeb', slateblue: '6a5acd', slategray: '708090', slategrey: '708090', snow: 'fffafa', springgreen: '00ff7f', steelblue: '4682b4', tan: 'd2b48c', teal: '008080', thistle: 'd8bfd8', tomato: 'ff6347', turquoise: '40e0d0', violet: 'ee82ee', wheat: 'f5deb3', white: 'ffffff', whitesmoke: 'f5f5f5', yellow: 'ffff00', yellowgreen: '9acd32'
  };
  const clamp01 = (x) => Math.min(1, Math.max(0, x));
  const round = (x, d) => { const p = Math.pow(10, d || 0); const v = Math.round(x * p) / p; return Object.is(v, -0) ? 0 : v; };
  const mod360 = (h) => ((h % 360) + 360) % 360;
  const toLin = (c) => { const s = Math.sign(c), a = Math.abs(c); return s * (a <= 0.04045 ? a / 12.92 : Math.pow((a + 0.055) / 1.055, 2.4)); };
  const toGam = (c) => { const s = Math.sign(c), a = Math.abs(c); return s * (a <= 0.0031308 ? a * 12.92 : 1.055 * Math.pow(a, 1 / 2.4) - 0.055); };
  const mul = (m, v) => [m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2], m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2], m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]];
  const RGB2XYZ = [[0.41239079926595934, 0.357584339383878, 0.1804807884018343], [0.21263900587151027, 0.715168678767756, 0.07219231536073371], [0.01933081871559182, 0.11919477979462598, 0.9505321522496607]];
  const XYZ2RGB = [[3.2409699419045226, -1.537383177570094, -0.4986107602930034], [-0.9692436362808796, 1.8759675015077202, 0.04155505740717559], [0.05563007969699366, -0.20397695888897652, 1.0569715142428786]];
  const D65_D50 = [[1.0479298208405488, 0.022946793341019088, -0.05019222954313557], [0.029627815688159344, 0.990434484573249, -0.01707382502938514], [-0.009243058152591178, 0.015055144896577895, 0.7518742899580008]];
  const D50_D65 = [[0.9554734527042182, -0.023098536874261423, 0.0632593086610217], [-0.028369706963208136, 1.0099954580058226, 0.021041398966943008], [0.012314001688319899, -0.020507696433477912, 1.3303659366080753]];
  const D50 = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585];
  const EPS = 216 / 24389, KAP = 24389 / 27;

  function rgbToHsl(c) {
    const r = c.r, g = c.g, b = c.b, max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
    let h = 0, s = 0;
    if (d > 1e-9) { s = d / (1 - Math.abs(2 * l - 1)); h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; }
    return { h: mod360(h), s: s * 100, l: l * 100 };
  }
  function hslToRgb(h, s, l, a) {
    s /= 100; l /= 100;
    const k = (n) => (n + h / 30) % 12, A = s * Math.min(l, 1 - l), f = (n) => l - A * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return { r: f(0), g: f(8), b: f(4), a: a == null ? 1 : a };
  }
  function rgbToHsv(c) { const hsl = rgbToHsl(c), v = Math.max(c.r, c.g, c.b), mn = Math.min(c.r, c.g, c.b); return { h: hsl.h, s: v <= 1e-9 ? 0 : (1 - mn / v) * 100, v: v * 100 }; }
  function hsvToRgb(h, s, v, a) { s /= 100; v /= 100; const l = v * (1 - s / 2), sl = l <= 1e-9 || l >= 1 - 1e-9 ? 0 : (v - l) / Math.min(l, 1 - l); return hslToRgb(h, sl * 100, l * 100, a); }
  function rgbToHwb(c) { return { h: rgbToHsl(c).h, w: Math.min(c.r, c.g, c.b) * 100, b: (1 - Math.max(c.r, c.g, c.b)) * 100 }; }
  function hwbToRgb(h, w, bl, a) { w /= 100; bl /= 100; if (w + bl >= 1) { const g = w / (w + bl); return { r: g, g, b: g, a: a == null ? 1 : a }; } const c = hslToRgb(h, 100, 50); const f = (x) => x * (1 - w - bl) + w; return { r: f(c.r), g: f(c.g), b: f(c.b), a: a == null ? 1 : a }; }
  function rgbToLab(c) {
    const xyz = mul(D65_D50, mul(RGB2XYZ, [toLin(c.r), toLin(c.g), toLin(c.b)]));
    const f = xyz.map((v, i) => { const t = v / D50[i]; return t > EPS ? Math.cbrt(t) : (KAP * t + 16) / 116; });
    return { l: 116 * f[1] - 16, a: 500 * (f[0] - f[1]), b: 200 * (f[1] - f[2]) };
  }
  function labToRgb(L, A, B, alpha) {
    const fy = (L + 16) / 116, fx = A / 500 + fy, fz = fy - B / 200;
    const x = Math.pow(fx, 3) > EPS ? Math.pow(fx, 3) : (116 * fx - 16) / KAP;
    const y = L > KAP * EPS ? Math.pow(fy, 3) : L / KAP;
    const z = Math.pow(fz, 3) > EPS ? Math.pow(fz, 3) : (116 * fz - 16) / KAP;
    const lin = mul(XYZ2RGB, mul(D50_D65, [x * D50[0], y * D50[1], z * D50[2]]));
    return { r: toGam(lin[0]), g: toGam(lin[1]), b: toGam(lin[2]), a: alpha == null ? 1 : alpha };
  }
  function rgbToOklab(c) {
    const r = toLin(c.r), g = toLin(c.g), b = toLin(c.b);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return { l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s };
  }
  function oklabToRgb(L, A, B, alpha) {
    const l = Math.pow(L + 0.3963377774 * A + 0.2158037573 * B, 3), m = Math.pow(L - 0.1055613458 * A - 0.0638541728 * B, 3), s = Math.pow(L - 0.0894841775 * A - 1.291485548 * B, 3);
    return { r: toGam(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), g: toGam(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), b: toGam(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s), a: alpha == null ? 1 : alpha };
  }
  const toPolar = (a, b) => ({ c: Math.hypot(a, b), h: Math.hypot(a, b) < 1e-7 ? 0 : mod360(Math.atan2(b, a) * 180 / Math.PI) });
  const fromPolar = (c, h) => ({ a: c * Math.cos(h * Math.PI / 180), b: c * Math.sin(h * Math.PI / 180) });
  // Naive device-independent CMYK. It is not an ICC print profile and the UI says so.
  function rgbToCmyk(c) { const r = clamp01(c.r), g = clamp01(c.g), b = clamp01(c.b), k = 1 - Math.max(r, g, b); if (k >= 1 - 1e-9) return { c: 0, m: 0, y: 0, k: 100 }; return { c: (1 - r - k) / (1 - k) * 100, m: (1 - g - k) / (1 - k) * 100, y: (1 - b - k) / (1 - k) * 100, k: k * 100 }; }
  function cmykToRgb(C, M, Y, K, a) { const k = K / 100; return { r: (1 - C / 100) * (1 - k), g: (1 - M / 100) * (1 - k), b: (1 - Y / 100) * (1 - k), a: a == null ? 1 : a }; }

  const inGamut = (c) => [c.r, c.g, c.b].every((v) => v >= -0.0005 && v <= 1.0005);
  const clip = (c) => ({ r: clamp01(c.r), g: clamp01(c.g), b: clamp01(c.b), a: clamp01(c.a == null ? 1 : c.a) });
  const hex2 = (v) => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0');
  const alphaPart = (a, sep) => (a < 1 ? sep + round(a, 3) : '');

  const FORMATS = {
    named: { label: 'Named', fmt: (c) => { if (c.a < 1) return ''; const h = hex2(c.r) + hex2(c.g) + hex2(c.b); for (const n in NAMED) if (NAMED[n] === h) return n; return ''; } },
    hex: { label: 'HEX', fmt: (c) => '#' + hex2(c.r) + hex2(c.g) + hex2(c.b) },
    hex8: { label: 'HEX8', fmt: (c) => '#' + hex2(c.r) + hex2(c.g) + hex2(c.b) + hex2(c.a) },
    rgb: { label: 'RGB', fmt: (c) => (c.a < 1 ? 'rgba(' : 'rgb(') + [c.r, c.g, c.b].map((v) => round(clamp01(v) * 255, 1)).join(', ') + alphaPart(c.a, ', ') + ')' },
    hsl: { label: 'HSL', fmt: (c) => { const h = rgbToHsl(clip(c)); return (c.a < 1 ? 'hsla(' : 'hsl(') + round(h.h, 2) + ', ' + round(h.s, 2) + '%, ' + round(h.l, 2) + '%' + alphaPart(c.a, ', ') + ')'; } },
    hsv: { label: 'HSV', fmt: (c) => { const h = rgbToHsv(clip(c)); return 'hsv(' + round(h.h, 2) + ', ' + round(h.s, 2) + '%, ' + round(h.v, 2) + '%' + alphaPart(c.a, ', ') + ')'; } },
    hwb: { label: 'HWB', fmt: (c) => { const h = rgbToHwb(clip(c)); return 'hwb(' + round(h.h, 2) + ' ' + round(h.w, 2) + '% ' + round(h.b, 2) + '%' + alphaPart(c.a, ' / ') + ')'; } },
    lab: { label: 'CIELAB', fmt: (c) => { const l = rgbToLab(c); return 'lab(' + round(l.l, 3) + '% ' + round(l.a, 3) + ' ' + round(l.b, 3) + alphaPart(c.a, ' / ') + ')'; } },
    lch: { label: 'LCH', fmt: (c) => { const l = rgbToLab(c), p = toPolar(l.a, l.b); return 'lch(' + round(l.l, 3) + '% ' + round(p.c, 3) + ' ' + round(p.h, 3) + alphaPart(c.a, ' / ') + ')'; } },
    oklab: { label: 'OKLab', fmt: (c) => { const l = rgbToOklab(c); return 'oklab(' + round(l.l * 100, 3) + '% ' + round(l.a, 5) + ' ' + round(l.b, 5) + alphaPart(c.a, ' / ') + ')'; } },
    oklch: { label: 'OKLCH', fmt: (c) => { const l = rgbToOklab(c), p = toPolar(l.a, l.b); return 'oklch(' + round(l.l * 100, 3) + '% ' + round(p.c, 5) + ' ' + round(p.h, 3) + alphaPart(c.a, ' / ') + ')'; } },
    cmyk: { label: 'CMYK', fmt: (c) => { const k = rgbToCmyk(c); return 'cmyk(' + [k.c, k.m, k.y, k.k].map((v) => round(v, 2) + '%').join(', ') + alphaPart(c.a, ', ') + ')'; } }
  };
  function format(c, space) { const f = FORMATS[space]; return f ? f.fmt(c) : ''; }

  // Parses any supported notation. Returns { color, space } or null. Wide-gamut input keeps its
  // out-of-range channels so the caller can warn before clipping.
  function parse(input) {
    const s = String(input == null ? '' : input).trim().toLowerCase();
    if (!s || s.length > 120) return null;
    if (NAMED[s]) return { color: parse('#' + NAMED[s]).color, space: 'named' };
    if (s === 'transparent') return { color: { r: 0, g: 0, b: 0, a: 0 }, space: 'named' };
    let m = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
    if (m) {
      let h = m[1]; if (h.length <= 4) h = h.split('').map((x) => x + x).join('');
      const n = (i) => parseInt(h.slice(i, i + 2), 16) / 255;
      return { color: { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) : 1 }, space: h.length === 8 ? 'hex8' : 'hex' };
    }
    m = /^([a-z]+)\(\s*([^)]*)\)$/.exec(s);
    if (!m) return null;
    const fn = m[1], parts = m[2].split(/[\s,/]+/).filter(Boolean);
    const num = (t, pctScale) => { if (t == null) return NaN; const p = /^(-?[\d.]+(?:e-?\d+)?)(%|deg|turn|rad)?$/.exec(t); if (!p) return NaN; const v = parseFloat(p[1]); if (p[2] === '%') return pctScale == null ? v : v / 100 * pctScale; if (p[2] === 'turn') return v * 360; if (p[2] === 'rad') return v * 180 / Math.PI; return v; };
    const alpha = (t) => (t == null ? 1 : (/%$/.test(t) ? num(t, 1) : num(t)));
    const ok = (...v) => v.every(Number.isFinite);
    let c = null, space = fn;
    if (fn === 'rgb' || fn === 'rgba') { const [r, g, b] = parts.slice(0, 3).map((t) => num(t, 255)), a = alpha(parts[3]); if (ok(r, g, b, a)) c = { r: r / 255, g: g / 255, b: b / 255, a }; space = 'rgb'; }
    else if (fn === 'hsl' || fn === 'hsla') { const h = num(parts[0]), sat = num(parts[1], 100), l = num(parts[2], 100), a = alpha(parts[3]); if (ok(h, sat, l, a)) c = hslToRgb(mod360(h), sat, l, a); space = 'hsl'; }
    else if (fn === 'hsv' || fn === 'hsb') { const h = num(parts[0]), sat = num(parts[1], 100), v = num(parts[2], 100), a = alpha(parts[3]); if (ok(h, sat, v, a)) c = hsvToRgb(mod360(h), sat, v, a); space = 'hsv'; }
    else if (fn === 'hwb') { const h = num(parts[0]), w = num(parts[1], 100), b = num(parts[2], 100), a = alpha(parts[3]); if (ok(h, w, b, a)) c = hwbToRgb(mod360(h), w, b, a); }
    else if (fn === 'lab') { const L = num(parts[0], 100), A = num(parts[1], 125), B = num(parts[2], 125), a = alpha(parts[3]); if (ok(L, A, B, a)) c = labToRgb(L, A, B, a); }
    else if (fn === 'lch') { const L = num(parts[0], 100), C = num(parts[1], 150), H = num(parts[2]), a = alpha(parts[3]); if (ok(L, C, H, a)) { const p = fromPolar(C, H); c = labToRgb(L, p.a, p.b, a); } }
    else if (fn === 'oklab') { const L = num(parts[0], 1), A = num(parts[1], 0.4), B = num(parts[2], 0.4), a = alpha(parts[3]); if (ok(L, A, B, a)) c = oklabToRgb(L, A, B, a); }
    else if (fn === 'oklch') { const L = num(parts[0], 1), C = num(parts[1], 0.4), H = num(parts[2]), a = alpha(parts[3]); if (ok(L, C, H, a)) { const p = fromPolar(C, H); c = oklabToRgb(L, p.a, p.b, a); } }
    else if (fn === 'cmyk') { const [C, M, Y, K] = parts.slice(0, 4).map((t) => num(t, 100)), a = alpha(parts[4]); if (ok(C, M, Y, K, a)) c = cmykToRgb(C, M, Y, K, a); }
    else return null;
    if (!c) return null;
    c.a = clamp01(c.a);
    return { color: c, space };
  }
  function luminance(c) { const k = clip(c); return 0.2126 * toLin(k.r) + 0.7152 * toLin(k.g) + 0.0722 * toLin(k.b); }
  function contrast(a, b) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }

  // The animated rainbow is a sentinel value, never a colour string and never a palette entry.
  const RAINBOW = 'mvl:rainbow';
  // One place maps the stored speed level to a duration; the control and the stylesheet both read it.
  const RAINBOW_LEVELS = { 1: 30, 2: 18, 3: 10, 4: 6, 5: 3 };
  const RAINBOW_SETTLED_HUE = 285;
  function rainbowSeconds(level) { const n = Math.round(Number(level)); return RAINBOW_LEVELS[Number.isFinite(n) ? Math.min(5, Math.max(1, n)) : 3]; }
  const isRainbow = (v) => v === RAINBOW;
  function addToPalette(palette, value) {
    // The sentinel can never join the palette array, and nothing that does not parse joins either.
    if (isRainbow(value) || !parse(value)) return palette.slice();
    const v = String(value).trim();
    return palette.includes(v) ? palette.slice() : palette.concat([v]).slice(-32);
  }

  // ---------- schedules ----------
  const SCHEDULE_VERSION = 1;
  const MAX_RULES = 100;
  const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
  const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
  const SETTINGS = {
    theme: { label: 'Theme', values: ['system', 'light', 'dark'] },
    lang: { label: 'Language', values: ['en', 'yue', 'bi'] },
    seed: { label: 'Seed colour', values: null },
    reduceMotion: { label: 'Reduce motion', values: [true, false] },
    displayName: { label: 'Display name', values: null },
    'adhd.lowStimulation': { label: 'Low stimulation', values: [true, false] },
    'adhd.focus': { label: 'Focus', values: [true, false] },
    'adhd.timeAwareness': { label: 'Time awareness', values: [true, false] }
  };
  const minutes = (t) => { const m = TIME.exec(t); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
  const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

  function validateRule(r, seeds) {
    const errs = [];
    if (!r || typeof r !== 'object') return ['The rule is not an object.'];
    if (typeof r.id !== 'string' || !/^r[a-z0-9]{4,24}$/.test(r.id)) errs.push('The rule id is invalid.');
    if (typeof r.label !== 'string' || r.label.length > 60) errs.push('The label must be 60 characters or fewer.');
    if (!TIME.test(r.start || '')) errs.push('Choose a start time.');
    if (!TIME.test(r.end || '')) errs.push('Choose an end time.');
    if (!r.every) { if (!Array.isArray(r.days) || !r.days.length || !r.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) errs.push('Pick at least one weekday, or choose Every day.'); }
    if (r.startDate && !DATE.test(r.startDate)) errs.push('The start date is not a valid date.');
    if (r.endDate && !DATE.test(r.endDate)) errs.push('The end date is not a valid date.');
    if (r.startDate && r.endDate && r.endDate < r.startDate) errs.push('The end date is before the start date.');
    const def = SETTINGS[r.setting];
    if (!def) errs.push('Pick a setting to schedule.');
    else if (def.values && !def.values.includes(r.value)) errs.push('That value is not allowed for ' + def.label + '.');
    else if (r.setting === 'seed' && (typeof r.value !== 'string' || (seeds && !seeds.includes(r.value)))) errs.push('Pick one of the seed colours.');
    else if (r.setting === 'displayName' && (typeof r.value !== 'string' || !r.value.trim() || r.value.length > 40)) errs.push('The display name must be 1 to 40 characters.');
    if (!['local', 'api', 'homeassistant'].includes(r.source || 'local')) errs.push('Unknown value source.');
    return errs;
  }
  function migrateSchedule(raw) {
    if (Array.isArray(raw)) raw = { v: 0, rules: raw };
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.rules)) return { v: SCHEDULE_VERSION, rules: [] };
    return { v: SCHEDULE_VERSION, rules: raw.rules.slice(0, MAX_RULES) };
  }
  // Which calendar day does an active window belong to? A window from 22:00 to 06:00 that started on
  // Friday is Friday's window, so at 01:00 on Saturday it counts as Friday. Equal start and end means
  // the whole day. Times are local wall-clock times in the system timezone.
  function occurrence(rule, now) {
    const s = minutes(rule.start), e = minutes(rule.end), m = now.getHours() * 60 + now.getMinutes();
    if (!Number.isFinite(s) || !Number.isFinite(e)) return null;
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (s === e) return day;
    if (s < e) return m >= s && m < e ? day : null;
    if (m >= s) return day;
    if (m < e) { day.setDate(day.getDate() - 1); return day; }
    return null;
  }
  function matches(rule, now) {
    if (!rule || rule.enabled === false) return false;
    const d = occurrence(rule, now);
    if (!d) return false;
    if (!rule.every && !(rule.days || []).includes(d.getDay())) return false;
    const key = ymd(d);
    if (rule.startDate && key < rule.startDate) return false;
    if (rule.endDate && key > rule.endDate) return false;
    return true;
  }
  // Precedence: rules are an ordered list and the first enabled, matching, valid rule for a setting
  // wins (the top of the list has the highest priority). Rules whose external source is unavailable
  // are skipped and reported, so the base setting or a lower rule stays in effect.
  function resolve(schedule, now, availableSource) {
    const out = {}, skipped = [];
    for (const r of migrateSchedule(schedule).rules) {
      if (out[r.setting] || validateRule(r).length || !matches(r, now)) continue;
      const src = r.source || 'local';
      if (src !== 'local' && !(availableSource && availableSource(src, r))) { skipped.push(r.id); continue; }
      out[r.setting] = { value: r.value, ruleId: r.id };
    }
    return { values: out, skipped };
  }

  // ---------- unlock credential (PIN or password), PBKDF2-SHA-256 through WebCrypto ----------
  const PBKDF2_ITERATIONS = 210000;
  const subtle = () => (root.crypto && root.crypto.subtle) || null;
  const b64 = (u8) => { let s = ''; for (const x of u8) s += String.fromCharCode(x); return (typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64')); };
  const unb64 = (s) => { const bin = typeof atob === 'function' ? atob(s) : Buffer.from(s, 'base64').toString('binary'); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
  function checkSecret(kind, secret) {
    if (kind === 'pin') return /^\d{4,12}$/.test(secret) ? '' : 'A PIN is 4 to 12 digits.';
    if (kind === 'password') return typeof secret === 'string' && secret.length >= 8 && secret.length <= 128 ? '' : 'A password is 8 to 128 characters.';
    return 'Choose a PIN or a password.';
  }
  async function hashSecret(kind, secret, saltB64, iterations) {
    const err = checkSecret(kind, secret); if (err) throw new Error(err);
    const s = subtle(); if (!s) throw new Error('WebCrypto is not available here.');
    const salt = saltB64 ? unb64(saltB64) : root.crypto.getRandomValues(new Uint8Array(16));
    const iter = iterations || PBKDF2_ITERATIONS;
    const key = await s.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveBits']);
    const bits = new Uint8Array(await s.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256));
    return { kind, alg: 'PBKDF2-SHA-256', iterations: iter, salt: b64(salt), hash: b64(bits) };
  }
  async function verifySecret(secret, rec) {
    if (!rec || !rec.salt || !rec.hash || !Number.isInteger(rec.iterations) || rec.iterations < 100000 || rec.iterations > 5000000) return false;
    let got; try { got = await hashSecret(rec.kind, secret, rec.salt, rec.iterations); } catch { return false; }
    const a = unb64(got.hash), b = unb64(rec.hash);
    if (a.length !== b.length) return false;
    let diff = 0; for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  }

  // ---------- image byte checks for custom logos ----------
  const LOGO_LIMITS = { bytes: 8 * 1024 * 1024, side: 8192, pixels: 40 * 1000 * 1000 };
  // Reads the real bytes: signature, declared dimensions and animation flags, before any decode.
  function sniffImage(u8) {
    const n = u8.length, be32 = (i) => ((u8[i] << 24) >>> 0) + (u8[i + 1] << 16) + (u8[i + 2] << 8) + u8[i + 3], le16 = (i) => u8[i] | (u8[i + 1] << 8), le24 = (i) => u8[i] | (u8[i + 1] << 8) | (u8[i + 2] << 16);
    const str = (i, l) => String.fromCharCode.apply(null, Array.from(u8.subarray(i, i + l)));
    const fail = (reason) => ({ ok: false, reason });
    if (!n) return fail('The file is empty.');
    if (n > LOGO_LIMITS.bytes) return fail('The file is larger than 8 MB.');
    let type = '', width = 0, height = 0, animated = false, alpha = true;
    if (n >= 24 && be32(0) === 0x89504e47 && be32(4) === 0x0d0a1a0a) {
      type = 'png';
      if (str(12, 4) !== 'IHDR') return fail('The PNG header is malformed.');
      width = be32(16); height = be32(20);
      const ct = u8[25]; alpha = ct === 4 || ct === 6;
      let i = 8, guard = 0;
      while (i + 8 <= n && guard++ < 100000) {
        const len = be32(i), t = str(i + 4, 4);
        if (t === 'acTL') animated = true;
        if (t === 'tRNS') alpha = true;
        if (t === 'IDAT' || t === 'IEND') break;
        i += 12 + len;
      }
    } else if (n >= 4 && u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) {
      type = 'jpeg'; alpha = false;
      let i = 2, guard = 0;
      while (i + 9 < n && guard++ < 100000) {
        if (u8[i] !== 0xff) { i++; continue; }
        const mk = u8[i + 1];
        if (mk === 0xd8 || mk === 0x01 || (mk >= 0xd0 && mk <= 0xd7)) { i += 2; continue; }
        const len = (u8[i + 2] << 8) | u8[i + 3];
        if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) { height = (u8[i + 5] << 8) | u8[i + 6]; width = (u8[i + 7] << 8) | u8[i + 8]; break; }
        if (len < 2) break;
        i += 2 + len;
      }
    } else if (n >= 30 && str(0, 4) === 'RIFF' && str(8, 4) === 'WEBP') {
      type = 'webp';
      const fourcc = str(12, 4);
      if (fourcc === 'VP8X') { const f = u8[20]; animated = !!(f & 0x02); alpha = !!(f & 0x10); width = le24(24) + 1; height = le24(27) + 1; }
      else if (fourcc === 'VP8 ') { alpha = false; if (u8[23] !== 0x9d || u8[24] !== 0x01 || u8[25] !== 0x2a) return fail('The WebP frame header is malformed.'); width = le16(26) & 0x3fff; height = le16(28) & 0x3fff; }
      else if (fourcc === 'VP8L') { if (u8[20] !== 0x2f) return fail('The WebP lossless header is malformed.'); const b = u8[21] | (u8[22] << 8) | (u8[23] << 16) | (u8[24] << 24); width = (b & 0x3fff) + 1; height = ((b >>> 14) & 0x3fff) + 1; }
      else return fail('This WebP variant is not supported.');
      for (let i = 12, guard = 0; i + 8 <= n && guard++ < 100000;) { const t = str(i, 4), len = le24(i + 4) + (u8[i + 7] << 24); if (t === 'ANIM' || t === 'ANMF') animated = true; i += 8 + len + (len & 1); }
    } else if (n >= 6 && /^GIF8[79]a$/.test(str(0, 6))) return fail('GIF is not accepted. Use PNG, JPEG or WebP.');
    else if (/^\s*</.test(str(0, Math.min(n, 64)))) return fail('SVG and other markup are not accepted, because they can carry scripts. Use PNG, JPEG or WebP.');
    else return fail('The bytes are not a PNG, JPEG or WebP image, whatever the file name says.');
    if (animated) return fail('Animated images are not accepted. Use a still image.');
    if (!width || !height) return fail('The image dimensions could not be read.');
    if (width > LOGO_LIMITS.side || height > LOGO_LIMITS.side) return fail('The image is larger than 8192 pixels on a side.');
    if (width * height > LOGO_LIMITS.pixels) return fail('The image has more than 40 million pixels.');
    return { ok: true, type, width, height, alpha };
  }
  function claimedType(name, mime) {
    const ext = String(name || '').toLowerCase().split('.').pop();
    const byExt = { png: 'png', jpg: 'jpeg', jpeg: 'jpeg', webp: 'webp' }[ext] || '';
    const byMime = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp' }[String(mime || '').toLowerCase()] || '';
    return { byExt, byMime };
  }

  // ---------- browser helpers ----------
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, def) { try { const v = root.localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch { return def; } },
    set(k, v) { try { root.localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
    del(k) { try { root.localStorage.removeItem(k); } catch { /* storage may be unavailable */ } }
  };
  // Append-only local log of personal-setting changes. Never holds a credential, an image or a
  // vocabulary payload: only what changed, in plain words.
  const HISTORY_KEY = 'mvl-personal-history';
  const history = {
    add(feature, action, summary) {
      const list = store.get(HISTORY_KEY, []);
      const arr = Array.isArray(list) ? list : [];
      arr.push({ at: new Date().toISOString(), feature: String(feature).slice(0, 40), action: String(action).slice(0, 40), summary: String(summary || '').slice(0, 200) });
      store.set(HISTORY_KEY, arr.slice(-500));
    },
    list() { const l = store.get(HISTORY_KEY, []); return Array.isArray(l) ? l.slice() : []; }
  };
  function download(name, text) {
    const a = root.document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = name; root.document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function readTextFile(file, max) {
    return new Promise((resolve, reject) => {
      if (!file) return reject(new Error('No file was chosen.'));
      if (file.size > (max || 256 * 1024)) return reject(new Error('The file is too large.'));
      const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(new Error('The file could not be read.')); r.readAsText(file);
    });
  }
  // Switches the shown language without touching the saved choice. MVLI18n.setMode(mode, quiet)
  // currently drops its quiet flag at the public API, so the saved value is put back afterwards.
  function setLangQuiet(mode) {
    if (!root.MVLI18n) return;
    let prev = null; try { prev = root.localStorage.getItem('mvl-lang'); } catch { /* storage unavailable */ }
    root.MVLI18n.setMode(mode, true);
    try { if (prev == null) root.localStorage.removeItem('mvl-lang'); else root.localStorage.setItem('mvl-lang', prev); } catch { /* storage unavailable */ }
  }
  // Two-key super confirmation. When a modal dialog (such as Tools) is open, the confirmation is
  // moved into it so it sits in the same top layer and stays operable.
  function confirm(opts) {
    if (!root.MVLSuperConfirm) return Promise.resolve(false);
    const p = root.MVLSuperConfirm.ask(opts);
    const dlg = [...root.document.querySelectorAll('dialog[open]')].pop();
    const box = [...root.document.querySelectorAll('body > .superconfirm')].pop();
    if (dlg && box && dlg.matches(':modal')) { dlg.append(box); const k = box.querySelector('.sc-key'); if (k) k.focus(); }
    return p;
  }

  const api = {
    NAMED, parse, format, FORMATS, contrast, luminance, inGamut, clip, rgbToHsl, hslToRgb, rgbToHsv, hsvToRgb, rgbToOklab, oklabToRgb, rgbToLab, labToRgb, toPolar, fromPolar,
    RAINBOW, RAINBOW_LEVELS, RAINBOW_SETTLED_HUE, rainbowSeconds, isRainbow, addToPalette,
    SCHEDULE_VERSION, MAX_RULES, SETTINGS, validateRule, migrateSchedule, occurrence, matches, resolve, ymd,
    PBKDF2_ITERATIONS, checkSecret, hashSecret, verifySecret,
    LOGO_LIMITS, sniffImage, claimedType,
    esc, store, history, download, readTextFile, setLangQuiet, confirm
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MVLPersonalCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
