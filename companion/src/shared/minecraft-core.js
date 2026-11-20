'use strict';
// Pure helpers for the Minecraft server manager and world generator: official catalogue parsing,
// digest checks, server.properties round trips, typed setting descriptors, the strict IPC allowlist,
// world-preset data pack building, forceload batch planning and a small ZIP reader/writer.
// No network, no child processes, so tests/system-suites.test.mjs can run every rule directly.
const crypto = require('crypto');
const zlib = require('zlib');
const path = require('path');

const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const EULA_URL = 'https://aka.ms/MinecraftEULA';
const PAPER_PROJECT_URL = 'https://fill.papermc.io/v3/projects/paper';
const META_HOSTS = new Set(['piston-meta.mojang.com', 'launchermeta.mojang.com']);
const SERVER_HOSTS = new Set(['piston-data.mojang.com', 'launcher.mojang.com']);
const PAPER_HOSTS = new Set(['fill.papermc.io', 'fill-data.papermc.io']);
const NAMESPACE = 'materialvmlabs';

function hostIn(url, set) { try { const u = new URL(url); return u.protocol === 'https:' && set.has(u.hostname); } catch { return false; } }

// ---- catalogue ----
function parseVersionManifest(json) {
  const j = typeof json === 'string' ? JSON.parse(json) : json;
  if (!j || !Array.isArray(j.versions)) throw new Error('The version manifest has no versions list.');
  const versions = [];
  for (const v of j.versions) {
    if (!v || typeof v.id !== 'string' || !validVersionId(v.id)) throw new Error('The version manifest has an entry without a usable id.');
    if (!hostIn(v.url, META_HOSTS)) throw new Error(`Version ${v.id} points outside Mojang's metadata hosts.`);
    if (!/^[0-9a-f]{40}$/.test(String(v.sha1 || ''))) throw new Error(`Version ${v.id} has no SHA-1 for its metadata.`);
    versions.push({ id: v.id, type: String(v.type || 'unknown'), url: v.url, sha1: v.sha1, time: String(v.time || ''), releaseTime: String(v.releaseTime || ''), complianceLevel: Number(v.complianceLevel) || 0 });
  }
  return { latest: { release: String((j.latest && j.latest.release) || ''), snapshot: String((j.latest && j.latest.snapshot) || '') }, versions };
}

// A version's own metadata: is there a dedicated server download, and which Java does it ask for.
function parseVersionMeta(json, id) {
  const j = typeof json === 'string' ? JSON.parse(json) : json;
  const s = j && j.downloads && j.downloads.server;
  let server = null, reason = '';
  if (!s) reason = 'This version\'s official metadata lists no dedicated server download.';
  else if (!hostIn(s.url, SERVER_HOSTS) || !/^[0-9a-f]{40}$/.test(String(s.sha1 || '')) || !(Number(s.size) > 0)) reason = 'The server download entry is incomplete or points outside Mojang\'s download hosts.';
  else server = { url: s.url, sha1: s.sha1, size: Number(s.size) };
  const javaMajor = j && j.javaVersion && Number.isInteger(j.javaVersion.majorVersion) ? j.javaVersion.majorVersion : null;
  return { id: id || String((j && j.id) || ''), server, reason, javaMajor, javaReason: javaMajor ? '' : 'This version\'s metadata does not say which Java it needs.' };
}

function parsePaperVersions(json) {
  const j = typeof json === 'string' ? JSON.parse(json) : json;
  const out = [];
  const groups = j && j.versions;
  if (!groups || typeof groups !== 'object') throw new Error('The Paper project answer has no versions.');
  for (const list of Object.values(groups)) if (Array.isArray(list)) for (const v of list) if (validVersionId(String(v))) out.push(String(v));
  return out;
}
function parsePaperBuilds(json) {
  const j = typeof json === 'string' ? JSON.parse(json) : json;
  const arr = Array.isArray(j) ? j : (j && Array.isArray(j.builds) ? j.builds : null);
  if (!arr) throw new Error('The Paper builds answer is not a list.');
  const out = [];
  for (const b of arr) {
    const d = b && b.downloads && (b.downloads['server:default'] || b.downloads.application);
    const sha256 = d && ((d.checksums && d.checksums.sha256) || d.sha256);
    if (!d || !/^[0-9a-f]{64}$/.test(String(sha256 || '')) || !hostIn(d.url, PAPER_HOSTS)) continue;
    out.push({ id: Number(b.id != null ? b.id : b.build), channel: String(b.channel || 'unknown').toUpperCase(), time: String(b.time || ''), name: String(d.name || ''), sha256, size: Number(d.size) || 0, url: d.url });
  }
  return out.sort((a, b) => b.id - a.id);
}

// ---- digests ----
function digestHex(buf, algo) { return crypto.createHash(algo).update(buf).digest('hex'); }
function verifyDigest(buf, algo, expected) {
  if (!['sha1', 'sha256'].includes(algo)) throw new Error('Only SHA-1 and SHA-256 are used here.');
  const actual = digestHex(buf, algo);
  return { ok: typeof expected === 'string' && actual === expected.toLowerCase(), actual, expected: String(expected || '') };
}

// ---- java ----
function parseJavaVersion(text) {
  const m = /version "(\d+)(?:\.(\d+))?[^"]*"/.exec(String(text || ''));
  if (!m) return null;
  const a = Number(m[1]);
  return a === 1 && m[2] ? Number(m[2]) : a;
}

// ---- server.properties ----
function unescapeProp(s) {
  return s.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, c) => c[0] === 'u' && c.length === 5 ? String.fromCharCode(parseInt(c.slice(1), 16)) : ({ t: '\t', n: '\n', r: '\r', f: '\f' }[c] || c));
}
function escapeProp(s, isKey) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i], code = s.charCodeAt(i);
    if (ch === '\\') out += '\\\\';
    else if (ch === '\n') out += '\\n'; else if (ch === '\r') out += '\\r'; else if (ch === '\t') out += '\\t'; else if (ch === '\f') out += '\\f';
    else if (ch === '=' || ch === ':' || ch === '#' || ch === '!') out += '\\' + ch;
    else if (ch === ' ' && (isKey || i === 0)) out += '\\ ';
    else if (code < 0x20 || code > 0x7e) out += '\\u' + code.toString(16).toUpperCase().padStart(4, '0');
    else out += ch;
  }
  return out;
}
function parseProperties(text) {
  const raw = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  if (raw.length && raw[raw.length - 1] === '') raw.pop();
  const entries = [];
  for (let i = 0; i < raw.length; i++) {
    let line = raw[i];
    const t = line.replace(/^[ \t\f]+/, '');
    if (!t) { entries.push({ type: 'blank', raw: line }); continue; }
    if (t[0] === '#' || t[0] === '!') { entries.push({ type: 'comment', raw: line }); continue; }
    let joined = t; let rawLines = line;
    while (/(^|[^\\])(\\\\)*\\$/.test(joined) && i + 1 < raw.length) { i++; rawLines += '\n' + raw[i]; joined = joined.slice(0, -1) + raw[i].replace(/^[ \t\f]+/, ''); }
    let k = 0, key = '';
    while (k < joined.length) { const c = joined[k]; if (c === '\\') { key += joined.slice(k, k + 2); k += 2; continue; } if (c === '=' || c === ':' || c === ' ' || c === '\t' || c === '\f') break; key += c; k++; }
    let rest = joined.slice(k).replace(/^[ \t\f]*/, '');
    if (rest[0] === '=' || rest[0] === ':') rest = rest.slice(1).replace(/^[ \t\f]*/, '');
    entries.push({ type: 'kv', key: unescapeProp(key), value: unescapeProp(rest), raw: rawLines });
  }
  return { entries };
}
function propsToObject(doc) { const o = {}; for (const e of doc.entries) if (e.type === 'kv') o[e.key] = e.value; return o; }
function setProperty(doc, key, value) {
  const v = String(value);
  const e = doc.entries.find((x) => x.type === 'kv' && x.key === key);
  if (e) { if (e.value !== v) { e.value = v; e.raw = null; } } else doc.entries.push({ type: 'kv', key, value: v, raw: null });
  return doc;
}
function serializeProperties(doc) {
  return doc.entries.map((e) => (e.raw != null ? e.raw : `${escapeProp(e.key, true)}=${escapeProp(e.value, false)}`)).join('\n') + '\n';
}

// Typed controls for the vanilla Java server.properties keys this release knows. These are the
// app's own descriptors, not yet checked against each exact version's generated defaults, and the
// UI says so. A key the descriptors do not know keeps its value and shows a validated text field.
const B = (key, def, help) => ({ key, type: 'bool', def, help });
const I = (key, def, min, max, help) => ({ key, type: 'int', def, min, max, help });
const E = (key, def, choices, help) => ({ key, type: 'enum', def, choices, help });
const T = (key, def, help, max) => ({ key, type: 'text', def, help, max: max || 256 });
const PROPERTY_DESCRIPTORS = [
  T('motd', 'A Minecraft Server', 'The message shown under the server name in the multiplayer list.', 59),
  I('server-port', 25565, 1, 65535, 'The TCP port players connect to. Restart to apply.'),
  T('server-ip', '', 'Leave empty to listen on every address, or name one local address.', 64),
  I('max-players', 20, 0, 2147483647, 'How many players can be online at once.'),
  B('online-mode', true, 'Check every player against Mojang accounts. Turning it off lets anyone use any name.'),
  B('white-list', false, 'Only players on the allowlist can join.'),
  B('enforce-whitelist', false, 'Kick online players who are not on the allowlist when it is reloaded.'),
  B('pvp', true, 'Players can damage each other.'),
  E('difficulty', 'easy', ['peaceful', 'easy', 'normal', 'hard'], 'How dangerous the world is.'),
  E('gamemode', 'survival', ['survival', 'creative', 'adventure', 'spectator'], 'The game mode new players start in.'),
  B('force-gamemode', false, 'Put players back in the default game mode every time they join.'),
  B('hardcore', false, 'Players are banned when they die and difficulty stays on hard.'),
  T('level-name', 'world', 'The folder name of the world this server loads.', 64),
  T('level-seed', '', 'The seed used when a new world is created. Empty picks a random one.', 100),
  { key: 'level-type', type: 'preset', def: 'minecraft:normal', help: 'The world preset used when a new world is created. Pick from the presets read from this version\'s server.' },
  B('generate-structures', true, 'Create villages, temples and other structures in new chunks.'),
  B('allow-nether', true, 'Players can travel to the Nether.'),
  B('allow-flight', false, 'Do not kick players whose movement looks like flying.'),
  I('spawn-protection', 16, 0, 29999984, 'Radius around spawn that only operators can change. 0 turns it off.'),
  I('view-distance', 10, 3, 32, 'How many chunks around each player the server sends.'),
  I('simulation-distance', 10, 3, 32, 'How many chunks around each player keep ticking.'),
  I('max-world-size', 29999984, 1, 29999984, 'Largest allowed world border radius in blocks.'),
  B('enable-command-block', false, 'Command blocks run their commands.'),
  B('spawn-monsters', true, 'Hostile mobs can spawn.'),
  B('enable-status', true, 'Show the server as online in the multiplayer list.'),
  B('hide-online-players', false, 'Do not list online player names in the status reply.'),
  I('op-permission-level', 4, 0, 4, 'The permission level given to new operators.'),
  I('function-permission-level', 2, 1, 4, 'The permission level functions run with.'),
  I('player-idle-timeout', 0, 0, 2147483647, 'Minutes before idle players are kicked. 0 never kicks.'),
  I('network-compression-threshold', 256, -1, 2147483647, 'Packets larger than this many bytes are compressed. -1 turns compression off.'),
  I('rate-limit', 0, 0, 2147483647, 'Packets per second before a player is kicked. 0 turns the limit off.'),
  I('max-tick-time', 60000, -1, 2147483647, 'Milliseconds one tick may take before the watchdog stops the server. -1 turns it off.'),
  I('entity-broadcast-range-percentage', 100, 10, 1000, 'How far away entities are sent to players, as a percentage of the default.'),
  B('sync-chunk-writes', true, 'Write chunks synchronously. Safer, slower.'),
  B('enforce-secure-profile', true, 'Require players to have a Mojang-signed public key for chat.'),
  B('log-ips', true, 'Write player IP addresses to the log.'),
  B('prevent-proxy-connections', false, 'Kick players whose address differs from the one Mojang saw.'),
  B('broadcast-console-to-ops', true, 'Show console command output to online operators.'),
  B('require-resource-pack', false, 'Disconnect players who decline the server resource pack.'),
  T('resource-pack', '', 'A web address of a resource pack offered to players.', 1000),
  T('resource-pack-sha1', '', 'The SHA-1 of that resource pack, so players can verify it.', 40),
  B('enable-rcon', false, 'Allow remote console connections. Keep it off unless you need it.'),
  I('rcon.port', 25575, 1, 65535, 'The TCP port for remote console.'),
  { key: 'rcon.password', type: 'secret', def: '', help: 'The remote console password. It is never shown, logged or exported.' },
  B('enable-query', false, 'Answer the GameSpy4 query protocol.'),
  I('query.port', 25565, 1, 65535, 'The UDP port for queries.'),
  B('accepts-transfers', false, 'Accept players transferred from another server.'),
  I('pause-when-empty-seconds', 60, 0, 2147483647, 'Pause ticking after the server has been empty this long. 0 never pauses.'),
];
const DESCRIPTOR_BY_KEY = new Map(PROPERTY_DESCRIPTORS.map((d) => [d.key, d]));

function validatePropertyValue(key, value) {
  const d = DESCRIPTOR_BY_KEY.get(key);
  const v = String(value);
  if (/[\u0000-\u0008\u000b-\u001f]/.test(v) || v.length > 2000) return 'Use plain text without control characters, at most 2000 characters.';
  if (!d) return /^[A-Za-z0-9._-]{1,80}$/.test(key) ? '' : 'That setting name is not valid.';
  if (d.type === 'bool' && v !== 'true' && v !== 'false') return 'Choose on or off.';
  if (d.type === 'int') { if (!/^-?\d+$/.test(v)) return 'Use a whole number.'; const n = Number(v); if (n < d.min || n > d.max) return `Use a number from ${d.min} to ${d.max}.`; }
  if (d.type === 'enum' && !d.choices.includes(v)) return 'Pick one of the listed values.';
  if (d.type === 'text' && v.length > d.max) return `Use at most ${d.max} characters.`;
  if (d.type === 'preset' && v && !/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(v)) return 'Use a namespaced preset id such as minecraft:normal.';
  return '';
}

// ---- validation and the IPC allowlist ----
function validVersionId(s) { return typeof s === 'string' && /^[A-Za-z0-9][A-Za-z0-9 ._+()-]{0,63}$/.test(s); }
function validServerId(s) { return typeof s === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(s); }
function validName(s) { return typeof s === 'string' && s.trim().length > 0 && s.length <= 60 && !/[\u0000-\u001f<>:"/\\|?*]/.test(s) && !/^[. ]|[. ]$/.test(s); }
function validCommand(s) { return typeof s === 'string' && s.trim().length > 0 && s.length <= 1000 && !/[\u0000-\u001f\u007f]/.test(s); }
function validAbsPath(s) { return typeof s === 'string' && s.length > 2 && s.length < 1024 && path.isAbsolute(s) && !/[\u0000-\u001f]/.test(s); }
const isObj = (a) => a && typeof a === 'object' && !Array.isArray(a);
const need = (ok, msg) => { if (!ok) throw new Error(msg); };

const ALLOWED = {
  versions: (a) => need(a == null || isObj(a), 'Bad request.'),
  versionInfo: (a) => need(validVersionId(a), 'That is not a version id from the catalogue.'),
  paperVersions: (a) => need(a == null, 'Bad request.'),
  paperBuilds: (a) => need(validVersionId(a), 'That is not a Paper version.'),
  java: (a) => need(a == null, 'Bad request.'),
  targets: (a) => need(a == null, 'Bad request.'),
  list: (a) => need(a == null, 'Bad request.'),
  create: (a) => { need(isObj(a), 'Bad request.'); need(validName(a.name), 'Give the server a name of 1 to 60 characters without < > : " / \\ | ? *.'); need(['vanilla', 'paper'].includes(a.flavour), 'Pick vanilla or Paper.'); need(validVersionId(a.version), 'Pick a version from the list.'); need(a.flavour !== 'paper' || Number.isInteger(a.build), 'Pick a Paper build.'); },
  remove: (a) => need(validServerId(a), 'Unknown server.'),
  readProperties: (a) => need(validServerId(a), 'Unknown server.'),
  writeProperties: (a) => { need(isObj(a) && validServerId(a.id) && isObj(a.changes), 'Bad request.'); for (const [k, v] of Object.entries(a.changes)) { const e = validatePropertyValue(k, v); need(!e, `${k}: ${e}`); } },
  eula: (a) => need(validServerId(a), 'Unknown server.'),
  acceptEula: (a) => need(isObj(a) && validServerId(a.id) && a.personAccepted === true, 'The EULA is accepted only by the person ticking the box.'),
  setRuntime: (a) => { need(isObj(a) && validServerId(a.id), 'Bad request.'); need(a.javaPath == null || validAbsPath(a.javaPath), 'Pick a detected Java.'); need(Number.isInteger(a.memMb) && a.memMb >= 512 && a.memMb <= 262144, 'Memory must be 512 MB to 256 GB.'); },
  start: (a) => need(validServerId(a), 'Unknown server.'),
  stop: (a) => need(validServerId(a), 'Unknown server.'),
  kill: (a) => need(validServerId(a), 'Unknown server.'),
  command: (a) => need(isObj(a) && validServerId(a.id) && validCommand(a.command), 'Commands are one line of at most 1000 characters.'),
  backup: (a) => need(validServerId(a), 'Unknown server.'),
  openFolder: (a) => need(validServerId(a), 'Unknown server.'),
  openEula: (a) => need(a == null, 'Bad request.'),
  extract: (a) => need(validServerId(a), 'Unknown server.'),
  browse: (a) => need(a === 'folder', 'Only folders can be picked here.'),
  generate: (a) => { need(isObj(a) && validServerId(a.id), 'Bad request.'); const e = validateWorldRequest(a); need(!e, e); },
  cancel: (a) => need(typeof a === 'string' && /^[a-z0-9-]{1,40}$/.test(a), 'Unknown job.'),
};
function validateRequest(action, arg) {
  if (!Object.prototype.hasOwnProperty.call(ALLOWED, action)) throw new Error(`"${action}" is not an allowed Minecraft action.`);
  ALLOWED[action](arg);
  return true;
}

// ---- world generator ----
const DEFAULT_AREA = Object.freeze({ cx: -50, cz: -50, w: 100, d: 100 });
const MAX_SIDE = 1024;
function validateArea(a) {
  if (!isObj(a)) return 'Set the area to generate.';
  for (const k of ['cx', 'cz', 'w', 'd']) if (!Number.isInteger(a[k])) return 'The area must be whole chunks.';
  if (a.w < 1 || a.d < 1 || a.w > MAX_SIDE || a.d > MAX_SIDE) return `Each side must be 1 to ${MAX_SIDE} chunks.`;
  if (Math.abs(a.cx) > 1874999 || Math.abs(a.cz) > 1874999 || Math.abs(a.cx + a.w) > 1874999 || Math.abs(a.cz + a.d) > 1874999) return 'The area must stay inside the world limit.';
  return '';
}
function planForceload(area) {
  const e = validateArea(area); if (e) throw new Error(e);
  const out = [];
  for (let z = area.cz; z < area.cz + area.d; z += 16) for (let x = area.cx; x < area.cx + area.w; x += 16) {
    const x2 = Math.min(x + 15, area.cx + area.w - 1), z2 = Math.min(z + 15, area.cz + area.d - 1);
    out.push({ chunks: (x2 - x + 1) * (z2 - z + 1), from: [x * 16, z * 16], to: [x2 * 16 + 15, z2 * 16 + 15], command: `forceload add ${x * 16} ${z * 16} ${x2 * 16 + 15} ${z2 * 16 + 15}` });
  }
  return out;
}
function regionsForArea(area) {
  const out = [];
  for (let rz = Math.floor(area.cz / 32); rz <= Math.floor((area.cz + area.d - 1) / 32); rz++) for (let rx = Math.floor(area.cx / 32); rx <= Math.floor((area.cx + area.w - 1) / 32); rx++) out.push(`r.${rx}.${rz}.mca`);
  return out;
}

const RID = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;
function validateWorldRequest(r) {
  const e = validateArea(r.area); if (e) return e;
  if (typeof r.seed !== 'string' || r.seed.length > 100 || /[\u0000-\u001f]/.test(r.seed)) return 'The seed is one line of at most 100 characters.';
  if (!RID.test(String(r.preset || ''))) return 'Pick a world preset.';
  if (!['peaceful', 'easy', 'normal', 'hard'].includes(r.difficulty)) return 'Pick a difficulty.';
  if (!['survival', 'creative', 'adventure', 'spectator'].includes(r.gamemode)) return 'Pick a game mode.';
  for (const k of ['hardcore', 'structures', 'borderFollows', 'personAcceptedEula']) if (typeof r[k] !== 'boolean') return 'Every switch needs a value.';
  if (!r.personAcceptedEula) return 'Generating a world runs the server, which needs your EULA acceptance first.';
  if (!['folder', 'zip'].includes(r.output)) return 'Choose Folder or ZIP output.';
  if (!validAbsPath(r.dest)) return 'Browse for a destination folder.';
  if (!validName(r.worldName)) return 'Give the world a name of 1 to 60 characters.';
  if (r.flat != null) {
    if (!isObj(r.flat) || !Array.isArray(r.flat.layers) || !r.flat.layers.length || r.flat.layers.length > 64) return 'A superflat world needs 1 to 64 layers.';
    let total = 0;
    for (const l of r.flat.layers) { if (!isObj(l) || !RID.test(String(l.block)) || !Number.isInteger(l.height) || l.height < 1 || l.height > 4064) return 'Each layer needs a block and a height of 1 to 4064.'; total += l.height; }
    if (total > 4064) return 'All layers together must stay at or below 4064 blocks.';
    if (!RID.test(String(r.flat.biome))) return 'Pick the superflat biome.';
    if (typeof r.flat.features !== 'boolean' || typeof r.flat.lakes !== 'boolean') return 'Set the features and lakes switches.';
    if (!Array.isArray(r.flat.structures) || r.flat.structures.some((s) => !RID.test(String(s)))) return 'Structure sets must be picked from the list.';
  }
  if (r.singleBiome != null && !RID.test(String(r.singleBiome))) return 'Pick the single biome.';
  if (r.noise != null) {
    if (!isObj(r.noise)) return 'Bad noise settings.';
    if (r.noise.seaLevel != null && (!Number.isInteger(r.noise.seaLevel) || r.noise.seaLevel < -64 || r.noise.seaLevel > 319)) return 'Sea level must be -64 to 319.';
    for (const k of ['aquifers', 'oreVeins', 'disableMobGeneration']) if (r.noise[k] != null && typeof r.noise[k] !== 'boolean') return 'Noise switches need a value.';
  }
  if (!isObj(r.gamerules)) return 'Game rules are missing.';
  for (const [k, v] of Object.entries(r.gamerules)) { if (!/^[A-Za-z0-9_:.]{1,80}$/.test(k)) return 'A game rule name is not valid.'; if (typeof v !== 'boolean' && !Number.isInteger(v)) return `Game rule ${k} needs a switch or whole number.`; }
  if (r.spawn != null && (!isObj(r.spawn) || !Number.isInteger(r.spawn.x) || !Number.isInteger(r.spawn.z) || Math.abs(r.spawn.x) > 29999984 || Math.abs(r.spawn.z) > 29999984)) return 'The spawn point must be whole block coordinates inside the world.';
  return '';
}

// Game rules typed from the server's own reports/commands.json: brigadier:bool -> switch,
// brigadier:integer -> stepper. Unknown parser types stay listed with their type so the UI can show them disabled.
function gameRulesFromCommands(json) {
  const j = typeof json === 'string' ? JSON.parse(json) : json;
  const g = j && j.children && j.children.gamerule && j.children.gamerule.children;
  if (!g) return [];
  return Object.entries(g).map(([name, node]) => {
    const v = node && node.children && node.children.value;
    const parser = v && v.parser ? String(v.parser) : 'unknown';
    const props = (v && v.properties) || {};
    return { name, parser, type: parser === 'brigadier:bool' ? 'bool' : parser === 'brigadier:integer' ? 'int' : 'unknown', min: Number.isFinite(props.min) ? props.min : null, max: Number.isFinite(props.max) ? props.max : null };
  }).sort((a, b) => a.name.localeCompare(b.name));
}
function registryEntries(json, registry) {
  const j = typeof json === 'string' ? JSON.parse(json) : json;
  const r = j && j[registry];
  return r && r.entries ? Object.keys(r.entries).sort() : [];
}
function packFormatFromVersionJson(json) {
  const j = typeof json === 'string' ? JSON.parse(json) : json;
  const pv = j && j.pack_version;
  if (pv == null) return null;
  if (typeof pv === 'number') return { major: pv, minor: 0 };
  if (Number.isInteger(pv.data)) return { major: pv.data, minor: 0 };
  if (Number.isInteger(pv.data_major)) return { major: pv.data_major, minor: Number(pv.data_minor) || 0 };
  return null;
}

// Build the private data pack for a customized world. vanillaPreset is the selected preset's JSON
// from this version's jar; vanillaNoise is that version's overworld noise settings JSON (needed
// only for noise tweaks). Returns { levelType, files } where files maps pack-relative paths to text.
function buildWorldPack(opts) {
  const { vanillaPreset, vanillaNoise, packFormat, preset } = opts;
  const custom = !!(opts.flat || opts.singleBiome || (opts.noise && Object.values(opts.noise).some((v) => v != null)));
  if (!custom) return { levelType: preset, files: {} };
  if (!vanillaPreset || !vanillaPreset.dimensions || !vanillaPreset.dimensions['minecraft:overworld']) throw new Error('The selected preset has no overworld to customize.');
  if (!packFormat) throw new Error('This version did not report a data pack format.');
  const p = JSON.parse(JSON.stringify(vanillaPreset));
  const ow = p.dimensions['minecraft:overworld'];
  const files = {};
  if (opts.flat) {
    const s = opts.flat.structures;
    ow.generator = { type: 'minecraft:flat', settings: { biome: opts.flat.biome, features: opts.flat.features, lakes: opts.flat.lakes, layers: opts.flat.layers.map((l) => ({ block: l.block, height: l.height })), structure_overrides: s.length === 1 ? s[0] : s } };
  } else {
    if (!ow.generator || ow.generator.type !== 'minecraft:noise') throw new Error('Biome and noise tweaks need a preset whose overworld uses the noise generator.');
    if (opts.singleBiome) ow.generator.biome_source = { type: 'minecraft:fixed', biome: opts.singleBiome };
    const n = opts.noise || {};
    if (n.seaLevel != null || n.aquifers != null || n.oreVeins != null || n.disableMobGeneration != null) {
      if (!vanillaNoise || typeof vanillaNoise !== 'object') throw new Error('Noise tweaks need this version\'s overworld noise settings.');
      const ns = JSON.parse(JSON.stringify(vanillaNoise));
      if (n.seaLevel != null) ns.sea_level = n.seaLevel;
      if (n.aquifers != null) ns.aquifers_enabled = n.aquifers;
      if (n.oreVeins != null) ns.ore_veins_enabled = n.oreVeins;
      if (n.disableMobGeneration != null) ns.disable_mob_generation = n.disableMobGeneration;
      files[`data/${NAMESPACE}/worldgen/noise_settings/generated.json`] = JSON.stringify(ns, null, 2);
      ow.generator.settings = `${NAMESPACE}:generated`;
    }
  }
  files[`data/${NAMESPACE}/worldgen/world_preset/generated.json`] = JSON.stringify(p, null, 2);
  const pack = { description: 'World settings chosen in Material VM Labs', pack_format: packFormat.major };
  if (packFormat.minor) { pack.min_format = [packFormat.major, packFormat.minor]; pack.max_format = [packFormat.major, packFormat.minor]; }
  files['pack.mcmeta'] = JSON.stringify({ pack }, null, 2);
  return { levelType: `${NAMESPACE}:generated`, files };
}

// ---- ZIP ----
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

function listZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a ZIP or JAR file.');
  const count = buf.readUInt16LE(eocd + 10), cdOff = buf.readUInt32LE(eocd + 16);
  if (count === 0xFFFF || cdOff === 0xFFFFFFFF) throw new Error('ZIP64 archives are not supported here.');
  const out = []; let p = cdOff;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('The ZIP directory is damaged.');
    const nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32);
    out.push({ name: buf.toString('utf8', p + 46, p + 46 + nl), method: buf.readUInt16LE(p + 10), crc: buf.readUInt32LE(p + 16), csize: buf.readUInt32LE(p + 20), size: buf.readUInt32LE(p + 24), offset: buf.readUInt32LE(p + 42) });
    p += 46 + nl + el + cl;
  }
  return out;
}
function readZipEntry(buf, entry) {
  const o = entry.offset;
  if (buf.readUInt32LE(o) !== 0x04034b50) throw new Error('A ZIP entry header is damaged.');
  const start = o + 30 + buf.readUInt16LE(o + 26) + buf.readUInt16LE(o + 28);
  const raw = buf.subarray(start, start + entry.csize);
  const data = entry.method === 0 ? Buffer.from(raw) : entry.method === 8 ? zlib.inflateRawSync(raw) : null;
  if (!data) throw new Error(`ZIP method ${entry.method} is not supported.`);
  if (data.length !== entry.size || crc32(data) !== entry.crc) throw new Error(`ZIP entry ${entry.name} failed its CRC check.`);
  return data;
}
function dosTime(d) {
  const t = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const dt = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { t, dt };
}
// files: [{ name, data: Buffer, mtime?: Date }]. Names use forward slashes; folders end with "/".
function createZip(files) {
  const locals = [], centrals = []; let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name.replace(/\\/g, '/'), 'utf8');
    const data = f.data || Buffer.alloc(0);
    const comp = data.length ? zlib.deflateRawSync(data) : Buffer.alloc(0);
    const useStore = comp.length >= data.length;
    const body = useStore ? data : comp;
    if (data.length > 0xFFFFFFFE || offset > 0xFFFFFFFE) throw new Error('Files over 4 GB need ZIP64, which is not supported here.');
    const crc = crc32(data); const { t, dt } = dosTime(f.mtime || new Date());
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(useStore ? 0 : 8, 8);
    lh.writeUInt16LE(t, 10); lh.writeUInt16LE(dt, 12); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(useStore ? 0 : 8, 10);
    ch.writeUInt16LE(t, 12); ch.writeUInt16LE(dt, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(f.name.endsWith('/') ? 0x10 : 0, 38); ch.writeUInt32LE(offset, 42);
    locals.push(lh, name, body); centrals.push(ch, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

module.exports = {
  MANIFEST_URL, EULA_URL, PAPER_PROJECT_URL, NAMESPACE, META_HOSTS, SERVER_HOSTS, PAPER_HOSTS, hostIn,
  parseVersionManifest, parseVersionMeta, parsePaperVersions, parsePaperBuilds,
  digestHex, verifyDigest, parseJavaVersion,
  parseProperties, serializeProperties, setProperty, propsToObject, escapeProp, unescapeProp,
  PROPERTY_DESCRIPTORS, validatePropertyValue,
  validVersionId, validServerId, validName, validCommand, validAbsPath, ALLOWED, validateRequest,
  DEFAULT_AREA, validateArea, planForceload, regionsForArea, validateWorldRequest,
  gameRulesFromCommands, registryEntries, packFormatFromVersionJson, buildWorldPack,
  crc32, listZip, readZipEntry, createZip,
};
