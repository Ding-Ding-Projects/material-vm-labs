// Unit tests for the pure parts of the System tools: Ollama request rules and fit verdicts,
// Minecraft catalogue parsing, digests, server.properties, the IPC allowlist, world packs, forceload
// planning and ZIP, and the Windows virtual disk validators and script builders.
// Run: node --test tests/system-suites.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ol = require('../companion/src/shared/ollama-core.js');
const mc = require('../companion/src/shared/minecraft-core.js');
const vd = require('../companion/src/shared/vdisk-core.js');
const GiB = 1024 ** 3;

// ---------------- Ollama ----------------
test('ollama: model names are validated strictly', () => {
  for (const ok of ['llama3.2', 'llama3.2:3b', 'library/qwen3:8b-q4_K_M', 'hf.co/owner/repo:Q4_K_M']) assert.ok(ol.validModel(ok), ok);
  for (const bad of ['', ' llama', 'a b', '../etc', '/abs', 'x:y:z', 'name:', 'a//b', 'x;rm', 'a'.repeat(201), null, 42]) assert.equal(ol.validModel(bad), false, String(bad));
});
test('ollama: chat requests are bounded and options typed', () => {
  const r = ol.validateChat({ model: 'llama3.2', system: 'Be brief.', messages: [{ role: 'user', content: 'hi' }], options: { temperature: 0.7, num_ctx: 4096 } });
  assert.equal(r.messages[0].role, 'system'); assert.equal(r.stream, true); assert.deepEqual(r.options, { temperature: 0.7, num_ctx: 4096 });
  assert.throws(() => ol.validateChat({ model: 'x', messages: [{ role: 'tool', content: 'a' }] }), /user or the assistant/);
  assert.throws(() => ol.validateChat({ model: 'x', messages: [{ role: 'user', content: 'a' }], options: { temperature: 9 } }), /0 to 2/);
  assert.throws(() => ol.validateChat({ model: 'x', messages: [{ role: 'user', content: 'a' }], options: { shell: 1 } }), /Unknown model option/);
  assert.throws(() => ol.validateChat({ model: 'x', messages: [{ role: 'user', content: 'a', images: ['not base64!'] }] }), /base64/);
  assert.throws(() => ol.validateChat({ model: 'x', messages: Array(201).fill({ role: 'user', content: 'a' }) }), /at most 200/);
});
test('ollama: NDJSON splitter handles split chunks', () => {
  const got = []; const s = ol.makeLineSplitter((o) => got.push(o));
  s.push('{"a":1}\n{"b"'); s.push(':2}\n'); s.push('{"c":3}'); s.end();
  assert.deepEqual(got, [{ a: 1 }, { b: 2 }, { c: 3 }]);
});
test('ollama: fit gives all four verdicts from evidence, never from the name', () => {
  const model = (size) => ({ name: 'x', size, details: { parameter_size: '8.0B', quantization_level: 'Q4_K_M' } });
  assert.equal(ol.fitVerdict(model(4 * GiB), { totalRam: 32 * GiB, vram: 12 * GiB }).verdict, 'Runs well');
  assert.equal(ol.fitVerdict(model(4 * GiB), { totalRam: 32 * GiB, vram: null }).verdict, 'Runs with limits');
  assert.equal(ol.fitVerdict(model(40 * GiB), { totalRam: 16 * GiB, vram: null }).verdict, 'Unlikely');
  assert.equal(ol.fitVerdict(model(0), { totalRam: 16 * GiB }).verdict, 'Unknown');
  assert.equal(ol.fitVerdict(model(4 * GiB), { totalRam: 0 }).verdict, 'Unknown');
  const a = ol.fitVerdict({ name: 'tiny-model', size: 40 * GiB }, { totalRam: 16 * GiB });
  const b = ol.fitVerdict({ name: 'huge-405b', size: 40 * GiB }, { totalRam: 16 * GiB });
  assert.equal(a.verdict, b.verdict);
  assert.ok(a.evidence.length >= 2 && a.assumptions.length >= 1 && a.at);
  assert.equal(ol.fitVerdict(model(10 * GiB), { totalRam: 64 * GiB, vram: 8 * GiB }).verdict, 'Runs with limits');
  assert.equal(ol.parseParamSize('8.0B'), 8e9); assert.equal(ol.parseParamSize('135M'), 1.35e8); assert.equal(ol.parseParamSize('big'), null);
});

// ---------------- Minecraft ----------------
const sha = (c) => c.repeat(40);
const manifest = { latest: { release: '1.21.4', snapshot: '25w02a' }, versions: [
  { id: '1.21.4', type: 'release', url: 'https://piston-meta.mojang.com/v1/packages/x/1.21.4.json', sha1: sha('a'), time: 't', releaseTime: 'r' },
  { id: 'rd-132211', type: 'old_alpha', url: 'https://piston-meta.mojang.com/v1/packages/y/rd.json', sha1: sha('b'), time: 't', releaseTime: 'r' },
  { id: '1.14 Pre-Release 1', type: 'snapshot', url: 'https://launchermeta.mojang.com/v1/p.json', sha1: sha('c'), time: 't', releaseTime: 'r' } ] };
test('minecraft: manifest keeps every entry and rejects foreign hosts or missing SHA-1', () => {
  const m = mc.parseVersionManifest(JSON.stringify(manifest));
  assert.equal(m.versions.length, 3); assert.equal(m.latest.release, '1.21.4'); assert.equal(m.versions[1].type, 'old_alpha');
  const bad = structuredClone(manifest); bad.versions[0].url = 'https://evil.example/x.json';
  assert.throws(() => mc.parseVersionManifest(bad), /outside Mojang/);
  const bad2 = structuredClone(manifest); delete bad2.versions[0].sha1;
  assert.throws(() => mc.parseVersionManifest(bad2), /SHA-1/);
  assert.throws(() => mc.parseVersionManifest({}), /no versions/);
});
test('minecraft: version metadata reports server download or an exact reason', () => {
  const ok = mc.parseVersionMeta({ id: '1.21.4', downloads: { server: { url: 'https://piston-data.mojang.com/v1/objects/abc/server.jar', sha1: sha('d'), size: 57000000 } }, javaVersion: { majorVersion: 21 } });
  assert.equal(ok.server.size, 57000000); assert.equal(ok.javaMajor, 21);
  const none = mc.parseVersionMeta({ id: 'rd-132211', downloads: { client: {} } });
  assert.equal(none.server, null); assert.match(none.reason, /no dedicated server/); assert.match(none.javaReason, /does not say/);
  const foreign = mc.parseVersionMeta({ downloads: { server: { url: 'https://cdn.example/server.jar', sha1: sha('d'), size: 1 } } });
  assert.equal(foreign.server, null);
});
test('minecraft: Paper builds need SHA-256 from the official host', () => {
  const builds = mc.parsePaperBuilds([
    { id: 10, channel: 'STABLE', downloads: { 'server:default': { name: 'paper-1.21.4-10.jar', checksums: { sha256: 'e'.repeat(64) }, size: 5, url: 'https://fill-data.papermc.io/v1/objects/e/paper.jar' } } },
    { id: 11, channel: 'BETA', downloads: { 'server:default': { name: 'p.jar', checksums: { sha256: 'e'.repeat(64) }, size: 5, url: 'https://mirror.example/p.jar' } } },
    { id: 12, downloads: { 'server:default': { name: 'p.jar', checksums: {}, url: 'https://fill-data.papermc.io/x' } } }]);
  assert.deepEqual(builds.map((b) => b.id), [10]);
  assert.deepEqual(mc.parsePaperVersions({ versions: { '1.21': ['1.21.4', '1.21.3'], '1.20': ['1.20.6'] } }), ['1.21.4', '1.21.3', '1.20.6']);
});
test('minecraft: SHA-1 and SHA-256 verification', () => {
  const buf = Buffer.from('abc');
  assert.equal(mc.verifyDigest(buf, 'sha1', 'a9993e364706816aba3e25717850c26c9cd0d89d').ok, true);
  assert.equal(mc.verifyDigest(buf, 'sha1', 'A9993E364706816ABA3E25717850C26C9CD0D89D').ok, true);
  assert.equal(mc.verifyDigest(buf, 'sha256', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad').ok, true);
  assert.equal(mc.verifyDigest(Buffer.from('abd'), 'sha1', 'a9993e364706816aba3e25717850c26c9cd0d89d').ok, false);
  assert.throws(() => mc.verifyDigest(buf, 'md5', 'x'));
});
test('minecraft: Java version banners', () => {
  assert.equal(mc.parseJavaVersion('java version "1.8.0_392"'), 8);
  assert.equal(mc.parseJavaVersion('Picked up JAVA_TOOL_OPTIONS: x\nopenjdk version "21.0.2" 2024-01-16'), 21);
  assert.equal(mc.parseJavaVersion('openjdk version "17" 2021-09-14'), 17);
  assert.equal(mc.parseJavaVersion('nothing'), null);
});
test('minecraft: server.properties round trip keeps comments, order and unknown keys', () => {
  const text = '#Minecraft server properties\n#Mon Jan 01\nmotd=A Minecraft Server\nlevel-type=minecraft\\:normal\ncustom-plugin-key = keep me\n\nmax-players=20\n';
  const doc = mc.parseProperties(text);
  assert.equal(mc.serializeProperties(doc), text);
  const o = mc.propsToObject(doc);
  assert.equal(o['level-type'], 'minecraft:normal'); assert.equal(o['custom-plugin-key'], 'keep me');
  mc.setProperty(doc, 'max-players', '50'); mc.setProperty(doc, 'motd', 'Caf\u00e9 night: welcome');
  const out = mc.serializeProperties(doc);
  assert.match(out, /^max-players=50$/m); assert.match(out, /^motd=Caf\\u00E9 night\\: welcome$/m);
  assert.match(out, /^custom-plugin-key = keep me$/m); assert.match(out, /^#Mon Jan 01$/m);
  assert.equal(mc.propsToObject(mc.parseProperties(out)).motd, 'Caf\u00e9 night: welcome');
  mc.setProperty(doc, 'new-key', 'x'); assert.match(mc.serializeProperties(doc), /new-key=x\n$/);
  const cont = mc.parseProperties('a=one \\\n   two\nb:3\nc 4\n');
  assert.deepEqual(mc.propsToObject(cont), { a: 'one two', b: '3', c: '4' });
});
test('minecraft: typed property validation', () => {
  assert.equal(mc.validatePropertyValue('server-port', '25565'), '');
  assert.match(mc.validatePropertyValue('server-port', '70000'), /1 to 65535/);
  assert.match(mc.validatePropertyValue('pvp', 'yes'), /on or off/);
  assert.match(mc.validatePropertyValue('difficulty', 'insane'), /listed/);
  assert.match(mc.validatePropertyValue('motd', 'a\u0001b'), /control/);
  assert.equal(mc.validatePropertyValue('some-plugin.key', 'anything'), '');
  assert.ok(mc.PROPERTY_DESCRIPTORS.every((d) => d.type !== 'text' || d.max));
  assert.ok(mc.PROPERTY_DESCRIPTORS.filter((d) => d.type === 'bool').length >= 20, 'booleans are switches, not text');
});
test('minecraft: IPC allowlist refuses unknown actions and unsafe input', () => {
  assert.throws(() => mc.validateRequest('exec', 'calc'), /not an allowed/);
  assert.throws(() => mc.validateRequest('__proto__', null), /not an allowed/);
  assert.throws(() => mc.validateRequest('acceptEula', { id: 'srv-1' }), /person/);
  assert.ok(mc.validateRequest('acceptEula', { id: 'srv-1', personAccepted: true }));
  assert.throws(() => mc.validateRequest('command', { id: 'srv-1', command: 'say hi\nstop' }), /one line/);
  assert.ok(mc.validateRequest('command', { id: 'srv-1', command: 'say hi' }));
  assert.throws(() => mc.validateRequest('start', '../../etc'), /Unknown server/);
  assert.throws(() => mc.validateRequest('create', { name: 'a/b', flavour: 'vanilla', version: '1.21.4' }), /name/);
  assert.throws(() => mc.validateRequest('create', { name: 'Survival', flavour: 'forge', version: '1.21.4' }), /vanilla or Paper/);
  assert.throws(() => mc.validateRequest('writeProperties', { id: 'srv-1', changes: { 'server-port': '0' } }), /server-port/);
  assert.throws(() => mc.validateRequest('setRuntime', { id: 'srv-1', javaPath: 'java; rm', memMb: 2048 }), /detected Java/);
});
test('minecraft: forceload batches cover the 100 x 100 default in 49 batches of at most 256 chunks', () => {
  const b = mc.planForceload(mc.DEFAULT_AREA);
  assert.equal(mc.DEFAULT_AREA.w, 100); assert.equal(mc.DEFAULT_AREA.d, 100);
  assert.equal(b.length, 49);
  assert.ok(b.every((x) => x.chunks <= 256));
  assert.equal(b.reduce((s, x) => s + x.chunks, 0), 10000);
  assert.equal(b[0].command, 'forceload add -800 -800 -545 -545');
  assert.throws(() => mc.planForceload({ cx: 0, cz: 0, w: 0, d: 5 }), /1 to/);
  assert.deepEqual(mc.regionsForArea({ cx: -50, cz: -50, w: 100, d: 100 }).length, 16);
  assert.deepEqual(mc.regionsForArea({ cx: 0, cz: 0, w: 32, d: 32 }), ['r.0.0.mca']);
});
test('minecraft: game rules are typed from the server report', () => {
  const rules = mc.gameRulesFromCommands({ children: { gamerule: { children: {
    keepInventory: { children: { value: { parser: 'brigadier:bool' } } },
    randomTickSpeed: { children: { value: { parser: 'brigadier:integer', properties: { min: 0 } } } },
    weird: { children: { value: { parser: 'minecraft:thing' } } } } } } });
  assert.deepEqual(rules.map((r) => [r.name, r.type]), [['keepInventory', 'bool'], ['randomTickSpeed', 'int'], ['weird', 'unknown']]);
  assert.equal(rules[1].min, 0);
  assert.deepEqual(mc.registryEntries({ 'minecraft:block': { entries: { 'minecraft:stone': {}, 'minecraft:air': {} } } }, 'minecraft:block'), ['minecraft:air', 'minecraft:stone']);
  assert.deepEqual(mc.packFormatFromVersionJson({ pack_version: { resource: 46, data: 61 } }), { major: 61, minor: 0 });
  assert.deepEqual(mc.packFormatFromVersionJson({ pack_version: { data_major: 88, data_minor: 0 } }), { major: 88, minor: 0 });
});
const vanillaPreset = { dimensions: { 'minecraft:overworld': { type: 'minecraft:overworld', generator: { type: 'minecraft:noise', biome_source: { type: 'minecraft:multi_noise', preset: 'minecraft:overworld' }, settings: 'minecraft:overworld' } }, 'minecraft:the_nether': { type: 'minecraft:the_nether', generator: { type: 'minecraft:noise' } } } };
test('minecraft: world pack building', () => {
  assert.deepEqual(mc.buildWorldPack({ preset: 'minecraft:amplified', vanillaPreset }), { levelType: 'minecraft:amplified', files: {} });
  const flat = mc.buildWorldPack({ preset: 'minecraft:normal', vanillaPreset, packFormat: { major: 61, minor: 0 }, flat: { layers: [{ block: 'minecraft:bedrock', height: 1 }, { block: 'minecraft:grass_block', height: 1 }], biome: 'minecraft:plains', features: false, lakes: false, structures: ['minecraft:villages'] } });
  assert.equal(flat.levelType, 'materialvmlabs:generated');
  const p = JSON.parse(flat.files['data/materialvmlabs/worldgen/world_preset/generated.json']);
  assert.equal(p.dimensions['minecraft:overworld'].generator.type, 'minecraft:flat');
  assert.equal(p.dimensions['minecraft:overworld'].generator.settings.structure_overrides, 'minecraft:villages');
  assert.ok(p.dimensions['minecraft:the_nether'], 'other dimensions stay');
  assert.equal(JSON.parse(flat.files['pack.mcmeta']).pack.pack_format, 61);
  const noise = mc.buildWorldPack({ preset: 'minecraft:normal', vanillaPreset, packFormat: { major: 61, minor: 0 }, singleBiome: 'minecraft:desert', vanillaNoise: { sea_level: 63, aquifers_enabled: true }, noise: { seaLevel: 80, aquifers: false } });
  const ns = JSON.parse(noise.files['data/materialvmlabs/worldgen/noise_settings/generated.json']);
  assert.equal(ns.sea_level, 80); assert.equal(ns.aquifers_enabled, false);
  const np = JSON.parse(noise.files['data/materialvmlabs/worldgen/world_preset/generated.json']);
  assert.equal(np.dimensions['minecraft:overworld'].generator.settings, 'materialvmlabs:generated');
  assert.equal(np.dimensions['minecraft:overworld'].generator.biome_source.biome, 'minecraft:desert');
  assert.equal(vanillaPreset.dimensions['minecraft:overworld'].generator.settings, 'minecraft:overworld', 'input untouched');
  assert.throws(() => mc.buildWorldPack({ preset: 'minecraft:normal', vanillaPreset, singleBiome: 'minecraft:desert' }), /pack format/);
});
test('minecraft: world requests are validated', () => {
  const ok = { id: 's-1', area: { ...mc.DEFAULT_AREA }, seed: '', preset: 'minecraft:normal', difficulty: 'easy', gamemode: 'survival', hardcore: false, structures: true, borderFollows: true, personAcceptedEula: true, output: 'zip', dest: '/tmp/out', worldName: 'My world', gamerules: { keepInventory: true, randomTickSpeed: 3 } };
  assert.equal(mc.validateWorldRequest(ok), '');
  assert.match(mc.validateWorldRequest({ ...ok, personAcceptedEula: false }), /EULA/);
  assert.match(mc.validateWorldRequest({ ...ok, output: 'tar' }), /Folder or ZIP/);
  assert.match(mc.validateWorldRequest({ ...ok, area: { cx: 0, cz: 0, w: 5000, d: 1 } }), /1 to 1024/);
  assert.match(mc.validateWorldRequest({ ...ok, gamerules: { x: 'yes' } }), /switch or whole number/);
  assert.match(mc.validateWorldRequest({ ...ok, flat: { layers: [{ block: 'stone', height: 1 }], biome: 'minecraft:plains', features: true, lakes: true, structures: [] } }), /block/);
  assert.throws(() => mc.validateRequest('generate', { ...ok, id: 'BAD ID' }));
});
test('minecraft: ZIP writer and reader round trip with CRC checks', () => {
  const files = [{ name: 'world/level.dat', data: Buffer.from('hello world '.repeat(100)) }, { name: 'world/empty.txt', data: Buffer.alloc(0) }, { name: 'world/region/r.0.0.mca', data: Buffer.from([1, 2, 3, 4]) }];
  const z = mc.createZip(files);
  const list = mc.listZip(z);
  assert.deepEqual(list.map((e) => e.name), files.map((f) => f.name));
  for (let i = 0; i < files.length; i++) assert.deepEqual(mc.readZipEntry(z, list[i]), files[i].data);
  assert.equal(mc.crc32(Buffer.from('123456789')), 0xCBF43926);
  const broken = Buffer.from(z); const e0 = list[2]; broken[e0.offset + 30 + 'world/region/r.0.0.mca'.length] ^= 0xFF;
  assert.throws(() => mc.readZipEntry(broken, mc.listZip(broken)[2]), /CRC/);
  assert.throws(() => mc.listZip(Buffer.from('not a zip at all, definitely not')), /Not a ZIP/);
});

// ---------------- Virtual disks ----------------
test('vdisk: PowerShell quoting doubles straight and typographic single quotes', () => {
  assert.equal(vd.psQuote("D:\\it's"), "'D:\\it''s'");
  assert.equal(vd.psQuote('D:\\a\u2019b'), "'D:\\a\u2019\u2019b'");
  assert.throws(() => vd.psQuote('a\nb'), /Control/);
});
test('vdisk: path validation', () => {
  assert.equal(vd.validPath('D:\\Disks\\data.vhdx', vd.DISK_EXT), '');
  assert.match(vd.validPath('\\\\server\\share\\a.vhdx'), /Network/);
  assert.match(vd.validPath('data.vhdx'), /drive letter/);
  assert.match(vd.validPath('D:\\a|b.vhdx'), /does not allow/);
  assert.match(vd.validPath('C:\\Windows\\x.vhdx'), /Windows folder/);
  assert.match(vd.validPath('D:\\a\\..\\b.vhdx'), /\.\./);
  assert.match(vd.validPath('D:\\a.txt', vd.DISK_EXT), /must end/);
});
test('vdisk: sizes and documented format limits', () => {
  assert.equal(vd.parseSize('64 GB'), 64 * GiB); assert.equal(vd.parseSize('512mb'), 512 * 1024 ** 2); assert.equal(vd.parseSize('2'), 2 * GiB); assert.equal(vd.parseSize('lots'), null);
  assert.match(vd.sizeError(3 * 1024 ** 2 - 1, '.vhdx'), /3 MB/);
  assert.equal(vd.sizeError(3 * 1024 ** 2, '.vhdx'), '');
  assert.equal(vd.sizeError(2040 * GiB, '.vhd'), '');
  assert.match(vd.sizeError(2041 * GiB, '.vhd'), /2,040 GB/);
  assert.equal(vd.sizeError(64 * 1024 ** 4, '.vhdx'), '');
  assert.match(vd.sizeError(64 * 1024 ** 4 + 1, '.vhdx'), /64 TB/);
  assert.match(vd.validateCreate({ path: 'D:\\a.vhdx', type: 'dynamic', sizeBytes: GiB, blockSizeMB: 3 }), /power of two/);
  assert.match(vd.validateCreate({ path: 'D:\\a.vhd', type: 'dynamic', sizeBytes: GiB, logicalSector: 4096 }), /VHDX only/);
  assert.match(vd.validateCreate({ path: 'D:\\a.vhdx', type: 'differencing', parentPath: 'D:\\a.vhdx' }), /own parent/);
});
test('vdisk: create picks the route the host has and never overwrites', () => {
  const hv = vd.build('create', { path: 'D:\\x.vhdx', type: 'dynamic', sizeBytes: 64 * GiB, blockSizeMB: 32 }, { hyperv: true });
  assert.equal(hv.route, 'hyperv'); assert.match(hv.equivalent.powershell, /New-VHD -Path 'D:\\x\.vhdx' -SizeBytes 68719476736 -Dynamic -BlockSizeBytes 33554432/);
  assert.match(hv.body, /already exists/); assert.equal(hv.admin, false);
  const vdk = vd.build('create', { path: 'D:\\x.vhd', type: 'fixed', sizeBytes: GiB }, { hyperv: false });
  assert.equal(vdk.route, 'virtdisk'); assert.match(vdk.body, /\[MvlVirtDisk\]::Create\('D:\\x\.vhd', 1073741824, \$true, \$null, 0, 0, 0\)/);
  assert.match(vdk.equivalent.diskpart, /create vdisk file="D:\\x\.vhd" maximum=1024 type=fixed/);
  assert.throws(() => vd.build('create', { path: 'D:\\x.vhds', type: 'dynamic', sizeBytes: GiB }, {}), /Hyper-V/);
  const init = vd.build('create', { path: 'D:\\x.vhdx', type: 'dynamic', sizeBytes: GiB, init: { style: 'GPT', fs: 'NTFS', label: 'Data', letter: true } }, {});
  assert.equal(init.admin, true); assert.match(init.body, /Initialize-Disk -Number \$disk\.Number -PartitionStyle GPT/);
});
test('vdisk: user text cannot break out of its literal', () => {
  const evil = "D:\\a'; Remove-Item $HOME -Recurse; '.vhdx";
  const b = vd.build('attach', { path: evil }, {});
  assert.ok(b.body.includes("'D:\\a''; Remove-Item $HOME -Recurse; ''.vhdx'"));
  const lit = /Get-DiskImage -ImagePath ('(?:[^']|'')*')/.exec(b.body)[1];
  assert.equal(lit.slice(1, -1).replace(/''/g, "'"), evil);
});
test('vdisk: attach, detach, compact, convert and shrink rules', () => {
  const iso = vd.build('attach', { path: 'D:\\win.iso' }, {});
  assert.equal(iso.admin, false); assert.match(iso.body, /-Access ReadOnly/);
  assert.equal(vd.build('attach', { path: 'D:\\a.vhdx' }, {}).admin, true);
  assert.match(vd.build('attach', { path: 'D:\\a.vhdx' }, {}).body, /\$r\.already = \$true/);
  assert.match(vd.build('detach', { path: 'D:\\a.vhdx' }, {}).body, /Dismount-DiskImage/);
  assert.match(vd.build('compact', { path: 'D:\\a.vhdx', mode: 'Quick' }, { hyperv: true }).body, /Optimize-VHD -Path 'D:\\a\.vhdx' -Mode Quick/);
  assert.throws(() => vd.build('compact', { path: 'D:\\a.vhdx', mode: 'Turbo' }, { hyperv: true }), /mode/);
  assert.equal(vd.build('compact', { path: 'D:\\a.vhdx' }, {}).route, 'virtdisk');
  assert.throws(() => vd.build('convert', { path: 'D:\\a.vhdx', dest: 'D:\\b.vhd' }, {}), /Hyper-V/);
  const cv = vd.build('convert', { path: 'D:\\a.vhdx', dest: 'D:\\b.vhd' }, { hyperv: true });
  assert.match(cv.body, /2,040 GB/); assert.match(cv.body, /nothing was overwritten/); assert.doesNotMatch(cv.body, /DeleteSource/);
  assert.throws(() => vd.build('shrink', { path: 'D:\\a.vhd', toMinimum: true }, { hyperv: true }), /must end in \.vhdx/);
  assert.throws(() => vd.build('expand', { path: 'D:\\a.vhd', sizeBytes: 3000 * GiB }, {}), /2,040/);
  assert.throws(() => vd.build('format', {}, {}), /not an allowed/);
});
test('vdisk: quick pack builds a verified VHDX and refuses unsafe requests', () => {
  const src = ["C:\\Users\\me\\Docs", "C:\\Users\\me\\it's.txt"];
  const b = vd.build('quickpack', { path: 'D:\\Packs\\docs.vhdx', sources: src }, {});
  assert.equal(b.admin, true); assert.equal(b.route, 'virtdisk');
  assert.match(b.body, /\$sources = @\('C:\\Users\\me\\Docs', 'C:\\Users\\me\\it''s\.txt'\)/);
  assert.match(b.body, /nothing was overwritten/);
  assert.match(b.body, /Get-FileHash -LiteralPath \$f\.src/); assert.match(b.body, /Get-FileHash -LiteralPath \$dest/);
  assert.match(b.body, /does not match its source/); assert.match(b.body, /SHA256SUMS\.txt/);
  assert.match(b.body, /finally \{\n  Dismount-DiskImage/);
  assert.match(vd.build('quickpack', { path: 'D:\\p.vhdx', sources: src }, { hyperv: true }).body, /New-VHD -Path 'D:\\p\.vhdx' -SizeBytes \$size -Dynamic/);
  assert.match(vd.build('quickpack', { path: 'D:\\p.vhdx', sources: src, fs: 'exFAT', label: 'Share' }, {}).body, /-FileSystem exFAT -NewFileSystemLabel 'Share'/);
  assert.throws(() => vd.build('quickpack', { path: 'D:\\p.vhd', sources: src }, {}), /must end in \.vhdx/);
  assert.throws(() => vd.build('quickpack', { path: 'D:\\p.vhdx', sources: [] }, {}), /at least one/);
  assert.throws(() => vd.build('quickpack', { path: 'D:\\p.vhdx', sources: ['C:\\a\\x', 'C:\\b\\X'] }, {}), /both named/);
  assert.throws(() => vd.build('quickpack', { path: 'D:\\p.vhdx', sources: ['C:\\a\\SHA256SUMS.txt'] }, {}), /manifest/);
  assert.throws(() => vd.build('quickpack', { path: 'D:\\p.vhdx', sources: ['\\\\server\\share\\x'] }, {}), /Network/);
  assert.throws(() => vd.build('quickpack', { path: 'D:\\p.vhdx', sources: src, fs: 'FAT32' }, {}), /NTFS or exFAT/);
  assert.equal(vd.UNBUILT.quickpack, undefined, 'quick pack is built, so it is not listed as unbuilt');
});
test('vdisk: elevation launcher uses the UAC prompt and reports cancellation', () => {
  const inner = vd.envelope('$r.x = 1', 'C:\\Temp\\r.json');
  assert.match(inner, /WriteAllText\('C:\\Temp\\r\.json'/);
  const outer = vd.elevatedLauncher(inner);
  assert.match(outer, /Start-Process -FilePath 'powershell\.exe' -Verb RunAs/);
  assert.match(outer, /1223/); assert.match(outer, /"cancelled":true/);
  const b64 = /'-EncodedCommand','([A-Za-z0-9+/=]+)'/.exec(outer)[1];
  assert.equal(Buffer.from(b64, 'base64').toString('utf16le'), inner);
  assert.deepEqual(vd.powershellArgs('x').slice(0, 5), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand']);
});
test('vdisk: VirtDisk structure layout keeps the documented 8-byte union alignment', () => {
  assert.match(vd.VIRTDISK_CS, /public int Version; public int Pad; public Guid UniqueId; public ulong MaximumSize/);
  assert.match(vd.VIRTDISK_CS, /EC984AEC-A0F9-47e9-901F-71415A66345B/);
});
