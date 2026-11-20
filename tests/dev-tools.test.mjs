// Developer tools engine (companion/renderer/shared/tools/dev-tools-typegen.js) and chart math
// (dev-tools-chart.js): parsing with exact error positions, JSONPath, inference over several
// samples, every generator on one fixed sample (snapshot-style string checks), validation, and the
// chart's scaling helpers.
// Run: node tests/dev-tools.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const T = require('../companion/renderer/shared/tools/dev-tools-typegen.js');
const C = require('../companion/renderer/shared/tools/dev-tools-chart.js').math;

const A = `{"id":"3f0e2a1c-1b2c-4d5e-8f90-123456789abc","name":"proof-1","cpus":4,"load":0.5,
"createdAt":"2026-11-20T10:00:00Z","site":"https://example.com/a","tags":["windows"],
"owner":{"login":"you","admin":true},
"builds":[{"verdict":"passed","minutes":14},{"verdict":"failed","minutes":3.5,"note":null}],
"mix":1,"1st":true}`;
const B = `{"id":"7a0e2a1c-1b2c-4d5e-8f90-123456789abc","name":"ci-host","cpus":2,"load":1,
"createdAt":"2026-11-19T09:00:00Z","site":"https://example.org","tags":[],
"owner":{"login":"me","admin":false},"builds":[{"verdict":"passed","minutes":2}],"mix":"x","1st":false,"extra":5}`;
const ir = () => T.infer([T.parse(A).node, T.parse(B).node], { topName: 'Machine' });
const gen = (lang, opts) => T.generate(lang, ir(), opts);
const has = (code, ...parts) => { for (const p of parts) assert.ok(code.includes(p), `expected to find:\n${p}\n---- in ----\n${code}`); };

test('strict parse keeps key order and reports exact positions', () => {
  const r = T.parse('{"b":1,"a":2,"10":3}');
  assert.ok(r.ok);
  assert.deepEqual(r.node.entries.map((e) => e.k), ['b', 'a', '10']);
  const bad = T.parse('{\n  "a": 1,\n  "b": tru\n}');
  assert.equal(bad.ok, false);
  assert.equal(bad.error.line, 3); assert.equal(bad.error.col, 8);
  assert.match(bad.error.message, /Expected a value but found "t" at line 3, column 8/);
  const trailing = T.parse('[1,2,]');
  assert.equal(trailing.ok, false); assert.equal(trailing.error.offset, 5);
  assert.match(T.parse('{"a":1} x').error.message, /after the end of the document/);
  assert.match(T.parse('"abc').error.message, /Unclosed string at line 1, column 1/);
  assert.match(T.parse('// c\n{}').error.message, /Comments are not allowed/);
});

test('lenient parse accepts comments and trailing commas, and notes duplicate keys', () => {
  const r = T.parse('// header\n{ "a": [1, 2,], /* x */ "a": 3, }', { lenient: true });
  assert.ok(r.ok);
  assert.equal(T.stringify(r.node, 0), '{"a":3}');
  assert.equal(r.notes.length, 1); assert.match(r.notes[0].message, /Duplicate key "a"/);
});

test('stringify round-trips numbers exactly and minifies', () => {
  const src = '{"n":1.50,"e":1e3,"s":"a\\nb","x":[true,null,{}]}';
  assert.equal(T.stringify(T.parse(src).node, 0), src);
  assert.equal(T.stringify(T.parse('{"a":[1]}').node, 2), '{\n  "a": [\n    1\n  ]\n}');
});

test('JSONPath subset', () => {
  const d = T.parse('{"a":{"b":[{"c":1},{"c":2},{"c":3}]},"c":0,"k y":{"z":1}}').node;
  assert.deepEqual(T.queryJsonPath(d, '$.a.b[0].c'), [['a', 'b', 0, 'c']]);
  assert.deepEqual(T.queryJsonPath(d, '$.a.b[-1]'), [['a', 'b', 2]]);
  assert.deepEqual(T.queryJsonPath(d, '$.a.b[*].c').length, 3);
  assert.deepEqual(T.queryJsonPath(d, '$.a.b[1:]'), [['a', 'b', 1], ['a', 'b', 2]]);
  assert.deepEqual(T.queryJsonPath(d, '$..c'), [['c'], ['a', 'b', 0, 'c'], ['a', 'b', 1, 'c'], ['a', 'b', 2, 'c']]);
  assert.deepEqual(T.queryJsonPath(d, '$["k y"].z'), [['k y', 'z']]);
  assert.deepEqual(T.queryJsonPath(d, '$'), [[]]);
  assert.throws(() => T.queryJsonPath(d, 'a.b'), /starts with \$/);
  assert.equal(T.pathToJsonPath(['a', 0, 'k y']), '$.a[0]["k y"]');
  assert.equal(T.pathToPointer(['a/b', 0, 'c~d']), '/a~1b/0/c~0d');
});

test('inference merges samples: optional fields, unions, enums, formats, nested classes', () => {
  const r = ir();
  assert.deepEqual(r.classes.map((c) => c.name), ['Machine', 'Owner', 'Build']);
  const m = Object.fromEntries(r.classes[0].props.map((p) => [p.key, p]));
  assert.equal(m.extra.optional, true);
  assert.equal(m.name.optional, false);
  assert.equal(m.cpus.type.k, 'int');
  assert.equal(m.load.type.k, 'float'); // 0.5 and 1 merge to a number
  assert.equal(m.id.type.format, 'uuid');
  assert.equal(m.createdAt.type.format, 'date-time');
  assert.equal(m.site.type.format, 'uri');
  assert.equal(m.mix.type.k, 'union');
  assert.deepEqual(m.mix.type.members.map((x) => x.k), ['int', 'string']);
  assert.equal(m.builds.type.k, 'array'); assert.equal(m.builds.type.items.ref, 'Build');
  const b = Object.fromEntries(r.classes[2].props.map((p) => [p.key, p]));
  assert.equal(b.verdict.type.k, 'enum');
  assert.deepEqual(r.enums, [{ name: 'Verdict', values: ['passed', 'failed'] }]);
  assert.equal(b.note.optional, true); assert.equal(b.note.type.k, 'null');
  assert.equal(T.describeType(m.builds.type), 'list of Build');
});

test('inference: maps, identical shapes reused, and switches', () => {
  const r = T.infer([T.parse('{"byId":{"10":{"n":1},"20":{"n":2}},"a":{"x":1},"b":{"x":2}}').node]);
  const p = Object.fromEntries(r.classes[0].props.map((q) => [q.key, q]));
  assert.equal(p.byId.type.k, 'map');
  assert.equal(p.a.type.ref, p.b.type.ref); // same shape, one class
  const off = T.infer([T.parse(A).node, T.parse(B).node], { enums: false, formats: false, allOptional: true });
  assert.equal(off.enums.length, 0);
  assert.ok(off.classes[0].props.every((q) => q.optional));
  assert.equal(off.classes[0].props.find((q) => q.key === 'id').type.format, undefined);
});

test('naming helpers', () => {
  const N = T.naming;
  assert.equal(N.pascal('created_at-time'), 'CreatedAtTime');
  assert.equal(N.camel('HTTPServer'), 'httpServer');
  assert.equal(N.snake('createdAt'), 'created_at');
  assert.equal(N.singular('categories'), 'category');
  assert.equal(N.singular('status'), 'status');
  assert.equal(N.propName('python', 'class', 'idiomatic'), 'class_');
  assert.equal(N.propName('rust', 'type', 'idiomatic'), 'r#type');
  assert.equal(N.propName('go', 'name', 'keep'), 'Name');
  assert.equal(N.propName('csharp', '1st', 'idiomatic'), 'The1st');
});

test('TypeScript', () => {
  const c = gen('typescript');
  has(c, 'export type Verdict = "passed" | "failed";', 'export interface Machine {', '    id: string; // uuid', '    extra?: number;', '    builds: Build[];', '    mix: number | string;', '    "1st": boolean;', '    note?: null;');
  const ro = gen('typescript', { readonly: true, optionalAs: 'nullable' });
  has(ro, '    readonly tags: readonly string[];', '    readonly extra: number | null;');
});

test('C#', () => {
  const c = gen('csharp');
  has(c, 'using System.Text.Json.Serialization;', '[JsonConverter(typeof(JsonStringEnumConverter))]', '[JsonStringEnumMemberName("passed")] Passed,', 'public class Machine', '    [JsonPropertyName("createdAt")]\n    public DateTimeOffset CreatedAt { get; set; }', '    public Guid Id { get; set; }', '    public long? Extra { get; set; }', '    public List<Build> Builds { get; set; }', '    public JsonElement Mix { get; set; }');
  has(gen('csharp', { readonly: true }), 'public sealed record Owner', '    public string Login { get; init; }');
  has(gen('csharp', { typedHints: false }), '    public string Id { get; set; }');
});

test('Python dataclasses', () => {
  const c = gen('python');
  has(c, 'from dataclasses import dataclass', 'class Verdict(Enum):\n    PASSED = "passed"', '@dataclass\nclass Machine:', '    created_at: str  # date-time', '    extra: int | None = None', '    mix: int | str', '    the_1st: bool',
    '            builds=[Build.from_dict(v) for v in d["builds"]],', '            owner=Owner.from_dict(d["owner"]),', '            created_at=d["createdAt"],', '            extra=d.get("extra"),', '            verdict=Verdict(d["verdict"]),');
  assert.ok(c.indexOf('class Build:') < c.indexOf('class Machine:'), 'nested classes come first');
  has(gen('python', { readonly: true }), '@dataclass(frozen=True)');
});

test('Go', () => {
  const c = gen('go');
  has(c, 'package generated', 'import "time"', 'type Verdict string', '\tVerdictPassed Verdict = "passed"', 'type Machine struct {', 'CreatedAt time.Time `json:"createdAt"`', 'Extra     *int64    `json:"extra,omitempty"`', 'Builds    []Build   `json:"builds"`', 'Mix       any       `json:"mix"`');
});

test('Rust', () => {
  const c = gen('rust');
  has(c, 'use serde::{Deserialize, Serialize};', '#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]\npub struct Machine {', '    #[serde(rename = "createdAt")]\n    pub created_at: String, // date-time', '    #[serde(default, skip_serializing_if = "Option::is_none")]\n    pub extra: Option<i64>,', '#[serde(untagged)]\npub enum MixUnion {\n    Integer(i64),\n    String(String),\n}', '    pub builds: Vec<Build>,', '    #[serde(rename = "passed")]\n    Passed,');
  has(c, 'skip_serializing_if = "serde_json::Value::is_null")]\n    pub note: serde_json::Value,');
});

test('Java', () => {
  const c = gen('java');
  has(c, 'import com.fasterxml.jackson.annotation.JsonProperty;', 'import java.time.OffsetDateTime;', 'public enum Verdict {\n    PASSED("passed"),\n    FAILED("failed");', 'public class Machine {', '    @JsonProperty("createdAt")\n    public OffsetDateTime createdAt;', '    public UUID id;', '    public Long extra;', '    public long cpus;', '    public List<Build> builds;', '    public Object mix;');
  has(gen('java', { readonly: true }), 'public record Owner(\n    @JsonProperty("login") String login,\n    @JsonProperty("admin") boolean admin\n) {}');
});

test('Kotlin', () => {
  const c = gen('kotlin');
  has(c, 'import kotlinx.serialization.Serializable', '@Serializable\ndata class Machine(', '    var extra: Long? = null', '    var builds: List<Build>,', '    var mix: JsonElement,', '    @SerialName("1st") var the1st: Boolean,', '@Serializable\nenum class Verdict {\n    @SerialName("passed") PASSED,');
  has(gen('kotlin', { readonly: true }), '    val name: String,');
});

test('Swift', () => {
  const c = gen('swift');
  has(c, 'import Foundation', 'enum Verdict: String, Codable {\n    case passed = "passed"', 'struct Machine: Codable {', '    var id: UUID', '    var createdAt: Date', '    var site: URL', '    var extra: Int?', '    var mix: MixUnion', 'enum MixUnion: Codable {\n    case integer(Int)\n    case string(String)', '        case the1st = "1st"', 'indirect enum JSONValue: Codable', 'dateDecodingStrategy = .iso8601');
  has(gen('swift', { readonly: true }), '    let name: String');
});

test('JSON Schema and validation against it', () => {
  const c = gen('jsonschema');
  const s = JSON.parse(c);
  assert.equal(s.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(s.$ref, '#/$defs/Machine');
  assert.deepEqual(s.$defs.Verdict, { type: 'string', enum: ['passed', 'failed'] });
  assert.equal(s.$defs.Machine.properties.createdAt.format, 'date-time');
  assert.ok(!s.$defs.Machine.required.includes('extra'));
  assert.deepEqual(s.$defs.Machine.properties.mix, { anyOf: [{ type: 'integer' }, { type: 'string' }] });
  assert.deepEqual(T.validate(T.parse(A).node, s), []);
  const bad = T.parse('{"id":"nope","name":3,"cpus":1,"load":1,"createdAt":"2026-11-20T10:00:00Z","site":"https://x.y","tags":[],"owner":{"login":"a"},"builds":[{"verdict":"maybe","minutes":1}],"mix":true,"1st":true}').node;
  const probs = T.validate(bad, s).map((p) => T.pathToJsonPath(p.path) + ' ' + p.message);
  assert.deepEqual(probs, [
    '$.id Expected uuid text',
    '$.name Expected string but found integer',
    '$.owner Missing required property "admin"',
    '$.builds[0].verdict "maybe" is not one of "passed", "failed"',
    '$.mix Does not match any allowed shape'
  ]);
});

test('run(): many samples, skipped invalid ones, inspector', () => {
  const r = T.run({ samples: [A, '{bad', B, '  '], lang: 'typescript', infer: { topName: 'Machine' } });
  assert.ok(r.ok);
  assert.equal(r.sampleCount, 2);
  assert.equal(r.errors.length, 1); assert.equal(r.errors[0].sample, 1); assert.equal(r.errors[0].line, 1);
  assert.equal(r.inspector[0].name, 'Machine');
  assert.ok(r.inspector[0].props.find((p) => p.key === 'extra').optional);
  assert.deepEqual(T.run({ samples: [''] }), { ok: false, errors: [], empty: true });
  for (const l of T.LANGUAGES) assert.ok(T.run({ samples: [A], lang: l.id }).code.length > 50, l.id);
});

test('document transforms and stats', () => {
  const d = T.parse('{"b":null,"a":{"d":1,"c":[null,2]}}').node;
  assert.equal(T.stringify(T.sortKeys(d), 0), '{"a":{"c":[null,2],"d":1},"b":null}');
  assert.equal(T.stringify(T.removeNulls(d), 0), '{"a":{"d":1,"c":[2]}}');
  const s = T.stats(d);
  assert.equal(s.nodes, 7); assert.equal(s.null, 2); assert.equal(s.depth, 3); assert.equal(s.keys, 4);
});

test('chart math: nice ticks, scales and time ticks', () => {
  assert.deepEqual(C.niceTicks(0, 3, 5, { integer: true }).ticks, [0, 1, 2, 3]);
  assert.deepEqual(C.niceTicks(0.3, 9.6, 5), { min: 0, max: 10, step: 2, ticks: [0, 2, 4, 6, 8, 10] });
  const flat = C.niceTicks(4, 4, 5, { integer: true });
  assert.ok(flat.min < 4 && flat.max > 4, 'a flat series still gets a range');
  assert.deepEqual(C.niceTicks(0, 0, 5, { integer: true }).ticks, [-1, 0, 1]);
  const sx = C.scale(0, 10, 100, 200);
  assert.equal(sx(0), 100); assert.equal(sx(5), 150); assert.equal(sx(10), 200);
  const sy = C.scale(0, 4, 230, 30); // inverted y
  assert.equal(sy(0), 230); assert.equal(sy(4), 30);
  assert.equal(C.scale(3, 3, 0, 100)(3), 50);
  const tt = C.timeTicks(Date.UTC(2026, 10, 20, 10, 0, 10), Date.UTC(2026, 10, 20, 10, 5, 0), 6);
  assert.equal(tt.step, 60e3);
  assert.deepEqual(tt.ticks.map((t) => new Date(t).getUTCMinutes()), [1, 2, 3, 4, 5]);
});

test('chart math: easing, nearest point, momentum, extent, gaps and paths', () => {
  assert.ok(Math.abs(C.easeFactor(1000 / 60) - 0.08) < 1e-9);
  assert.ok(Math.abs(C.easeFactor(2000 / 60) - (1 - 0.92 * 0.92)) < 1e-9);
  assert.equal(C.easeFactor(0), 0);
  assert.equal(C.lerp(10, 20, 0.08), 10.8);
  const pts = [{ t: 0, v: 1 }, { t: 30, v: 3 }, { t: 60, v: 2 }];
  assert.equal(C.nearestIndex(pts, 44), 1); assert.equal(C.nearestIndex(pts, 46), 2); assert.equal(C.nearestIndex([], 1), -1);
  assert.equal(C.momentum(pts), 'down'); assert.equal(C.momentum(pts.slice(0, 2)), 'up'); assert.equal(C.momentum(pts.slice(0, 1)), 'flat');
  assert.deepEqual(C.extent([pts, [{ t: 90, v: 9 }]], 0, 60), { min: 1, max: 3 });
  assert.equal(C.extent([[]]), null);
  assert.deepEqual(C.segments([{ t: 0 }, { t: 30 }, { t: 200 }, { t: 230 }], 75), [[0, 1], [2, 3]]);
  assert.equal(C.smoothPath([[0, 0], [10, 10]]), 'M0,0L10,10');
  const d = C.smoothPath([[0, 10], [10, 0], [20, 0], [30, 10]]);
  assert.match(d, /^M0,10C/);
  // Monotone: a flat run stays flat (no overshoot between equal neighbours).
  assert.ok(d.includes('C13.33,0 16.67,0 20,0'), d);
});
