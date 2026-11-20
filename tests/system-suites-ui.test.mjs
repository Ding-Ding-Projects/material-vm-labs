// Browser checks for the System tools' screens with mocked bridges (window.mvlOllama,
// window.mvlMinecraft, window.mvlVdisk). The mocks stand in for the main process; nothing here
// reaches Ollama, Mojang, a Java server or Windows. Needs the playwright package and Chromium.
// Run: node --test tests/system-suites-ui.test.mjs   (SHOTS=<dir> saves screenshots)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const page = pathToFileURL(path.join(root, 'companion/renderer/manager/index.html')).href;
const tool = (f) => pathToFileURL(path.join(root, 'companion/renderer/shared/tools', f)).href;
const SHOTS = process.env.SHOTS || '';
let playwright = null; try { playwright = require('playwright'); } catch { /* skipped below */ }

const BASE = `(function(){const ok=(d)=>Promise.resolve(d);
window.mvl={settings:()=>ok({stateRoot:'',resolvedRoot:'C:\\\\Users\\\\you\\\\AppData\\\\Local\\\\MaterialVmLabs',defaultNet:'nat',theme:'light',reduceMotion:false,repo:'bundled'}),setSettings:(p)=>ok(p),run:()=>ok({ok:true,data:[]}),recovered:()=>ok([]),dismissRecovered:()=>ok(true),openShare:()=>ok(true),cancel:()=>ok(true),receipts:()=>ok({receipts:[],dir:''}),metas:()=>ok({}),mediaInfo:()=>ok({receipts:[],files:[]}),selectServerMedia:()=>ok(null),shot:()=>ok({ok:false}),copy:()=>ok(true),openFolder:()=>ok(true),onLine:()=>{},ghStatus:()=>ok({ok:true,user:'you'}),runnerLive:()=>ok({}),ghRepos:()=>ok({ok:true,repos:[]}),runnerHost:()=>ok({ok:true}),runnerWorkflows:()=>ok([]),runnerRunWorkflow:()=>ok({}),onRunnerStep:()=>{}};
window.mvlDocs={load:()=>ok({version:'0.1.0',docs:[]}),openExternal:()=>ok(true)};
window.mvlBuild={info:()=>ok({repo:'',running:null}),start:()=>ok({ok:true}),cancel:()=>ok(true),openFolder:()=>ok(true),onLine:()=>{},onState:()=>{}};
window.mvlDimsum={pick:()=>ok(null)};
for(const k of ['manager','docs','build'])try{localStorage.setItem('mvl.onboarding.'+k,'{"v":1,"done":true,"step":0,"results":{},"data":{}}')}catch{}
})();`;

const MOCKS = (scenario) => `(function(){const S=${JSON.stringify(scenario)};const ok=(d)=>new Promise((r)=>setTimeout(()=>r(d),20));const GiB=1024**3;
const fit=(v)=>({verdict:v,evidence:['Model files: 4.7 GB as reported by Ollama.','System memory: 32.0 GB.'],assumptions:['Context and runtime overhead assumed at 1.0 GB.'],at:'2026-11-20T10:00:00Z'});
const ol=[];window.__olCalls=[];
window.mvlOllama={onEvent:(cb)=>{ol.push(cb);return()=>{}},emit:(d)=>ol.forEach((f)=>f(d)),
status:()=>ok(S.ollama==='missing'?{ok:true,running:false,installed:false,reason:'Nothing is listening on 127.0.0.1:11434.'}:S.ollama==='stopped'?{ok:true,running:false,installed:true,reason:'Nothing is listening on 127.0.0.1:11434.'}:{ok:true,running:true,version:'0.0.0-mock',installed:true}),
system:()=>ok({ok:true,totalRam:32*GiB,freeDisk:200*GiB,settings:{contextOverheadBytes:GiB}}),setOverhead:()=>ok({ok:true}),
list:()=>ok({ok:true,models:[{name:'mock-small:1b',size:1.3*GiB,modified:'2026-11-01',details:{parameter_size:'1.2B',quantization_level:'Q4_K_M',family:'mock'},running:true,fit:fit('Runs with limits')},{name:'mock-large:70b',size:40*GiB,modified:'2026-10-01',details:{parameter_size:'70.6B',quantization_level:'Q4_K_M',family:'mock'},running:false,fit:fit('Unlikely')},{name:'mock-vision:7b',size:4.7*GiB,modified:'2026-09-01',details:{},running:false,fit:fit('Unknown')}]}),
ps:()=>ok({ok:true,models:[{name:'mock-small:1b',size:2*GiB,sizeVram:0,expires:'2026-11-20T10:05:00Z'}]}),
show:(m)=>ok({ok:true,model:m,capabilities:m.includes('vision')?['completion','vision']:['completion'],details:{family:'mock',parameter_size:'1.2B',quantization_level:'Q4_K_M',format:'gguf'},parameters:'temperature 0.7',template:'{{ .Prompt }}',license:'Mock license text'}),
delete:(m)=>{window.__olCalls.push('delete:'+m);return ok({ok:true})},copy:()=>ok({ok:true}),unload:()=>ok({ok:true}),cancel:(id)=>{setTimeout(()=>window.mvlOllama.emit({id,kind:'pull',type:'cancelled'}),30);return ok({ok:true,found:true})},start:()=>ok({ok:false,error:'Ollama was started but did not answer on 127.0.0.1:11434 within 15 seconds.'}),openDownload:()=>ok({ok:true,url:'https://ollama.com/download'}),
pull:(m)=>{const id='p'+Math.random();let n=0;const t=setInterval(()=>{n++;window.mvlOllama.emit({id,kind:'pull',type:'progress',status:'pulling',total:1000,completed:n*100});if(n===4){clearInterval(t);if(m!=='slow:1b')window.mvlOllama.emit({id,kind:'pull',type:'done'})}},40);return ok({ok:true,id})},
chat:()=>{const id='c'+Math.random();setTimeout(()=>{for(const w of ['Hello',' from',' the mock.'])window.mvlOllama.emit({id,kind:'chat',type:'token',content:w});window.mvlOllama.emit({id,kind:'chat',type:'stats',evalCount:3,evalDuration:1e8});window.mvlOllama.emit({id,kind:'chat',type:'done'})},60);return ok({ok:true,id})}};
const mc=[];let eula=false;const ev=(d)=>mc.forEach((f)=>f(d));
const props={motd:'A Minecraft Server','server-port':'25565',pvp:'true',difficulty:'easy','level-type':'minecraft:normal','custom-plugin.key':'kept'};
window.mvlMinecraft={onEvent:(cb)=>{mc.push(cb);return()=>{}},
targets:()=>ok({ok:true,targets:[{id:'local',label:'Local process',available:true,detail:'Java found: 21'},{id:'local-docker',label:'Local Docker',available:false,detail:'Docker is not installed or not on PATH.'},{id:'ssh',label:'SSH process',available:false,detail:'Not built yet.'},{id:'ssh-docker',label:'SSH Docker',available:false,detail:'Not built yet.'}]}),
list:()=>ok({ok:true,servers:S.mcEmpty?[]:[{id:'survival-abc123',name:'Survival',flavour:'vanilla',version:'1.21.4',javaMajor:21,memMb:2048,jar:{algo:'sha1',digest:'a'.repeat(40),size:57e6},running:false,eula}]}),
versions:()=>ok({ok:true,count:4,fetchedAt:Date.parse('2026-11-20T09:00:00Z'),stale:false,latest:{release:'1.21.4'},versions:[{id:'1.21.4',type:'release',releaseTime:'2024-12-03'},{id:'25w02a',type:'snapshot',releaseTime:'2025-01-08'},{id:'b1.7.3',type:'old_beta',releaseTime:'2011-07-08'},{id:'rd-132211',type:'old_alpha',releaseTime:'2009-05-13'}]}),
versionInfo:(id)=>ok(id==='rd-132211'?{ok:true,server:null,reason:"This version's official metadata lists no dedicated server download.",javaMajor:null,javaReason:"This version's metadata does not say which Java it needs."}:{ok:true,server:{size:57e6,sha1:'b'.repeat(40)},javaMajor:21}),
paperVersions:()=>ok({ok:true,versions:['1.21.4','1.21.3'],source:'https://fill.papermc.io/v3/projects/paper'}),paperBuilds:()=>ok({ok:true,builds:[{id:232,channel:'STABLE',time:'2025-01-01T00:00:00Z',size:5e7}]}),
java:()=>ok({ok:true,runtimes:[{path:'C:\\\\Program Files\\\\Eclipse Adoptium\\\\jdk-21\\\\bin\\\\java.exe',major:21}]}),
eula:()=>ok({ok:true,accepted:eula}),acceptEula:(a)=>{eula=a.personAccepted===true;return ok({ok:true,accepted:eula})},openEula:()=>ok({ok:true}),setRuntime:(a)=>ok({ok:true,server:{memMb:a.memMb}}),
start:(id)=>{if(!eula)return ok({ok:false,error:'The server will not start until you accept the Minecraft EULA on the EULA card.'});setTimeout(()=>{ev({kind:'state',id,state:'starting'});ev({kind:'console',id,line:'[Server thread/INFO]: Starting minecraft server version 1.21.4'});ev({kind:'console',id,line:'[Server thread/INFO]: Done (3.2s)! For help, type "help"'})},30);return ok({ok:true,pid:42,java:{major:21}})},
command:(a)=>{setTimeout(()=>ev({kind:'console',id:a.id,line:'[Server thread/INFO]: There are 0 of a max of 20 players online'}),20);return ok({ok:true})},stop:(id)=>{setTimeout(()=>ev({kind:'state',id,state:'stopped',code:0}),20);return ok({ok:true,stopped:true})},kill:()=>ok({ok:true}),
readProperties:()=>ok({ok:true,exists:true,values:props,presets:['minecraft:normal','minecraft:flat','minecraft:amplified'],running:false,descriptors:[{key:'motd',type:'text',def:'A Minecraft Server',help:'The message shown in the server list.',max:59},{key:'server-port',type:'int',def:25565,min:1,max:65535,help:'The TCP port.'},{key:'pvp',type:'bool',def:true,help:'Players can damage each other.'},{key:'difficulty',type:'enum',def:'easy',choices:['peaceful','easy','normal','hard'],help:'How dangerous.'},{key:'level-type',type:'preset',def:'minecraft:normal',help:'The world preset.'},{key:'rcon.password',type:'secret',def:'',help:'Never shown.'}]}),
writeProperties:(a)=>{Object.assign(props,a.changes);return ok({ok:true,changed:Object.keys(a.changes).length})},backup:()=>ok({ok:false,error:'There is no world folder "world" yet. Start the server once to create it.'}),openFolder:()=>ok({ok:true}),remove:()=>ok({ok:true}),
extract:()=>ok({ok:true,extracted:{version:'1.21.4',reportsOk:true,dataDriven:true,packFormat:{major:61},presets:['minecraft:amplified','minecraft:flat','minecraft:large_biomes','minecraft:normal'],biomes:['minecraft:desert','minecraft:plains'],blocks:['minecraft:bedrock','minecraft:dirt','minecraft:grass_block','minecraft:stone'],structureSets:['minecraft:villages','minecraft:strongholds'],gamerules:[{name:'keepInventory',type:'bool'},{name:'randomTickSpeed',type:'int',min:0},{name:'oddRule',type:'unknown',parser:'minecraft:thing'}]}}),
browse:()=>ok({ok:true,path:'D:\\\\Worlds'}),cancel:()=>ok({ok:true}),
generate:(a)=>{window.__gen=a;const jobId='gen-1';let i=0;const t=setInterval(()=>{i++;ev({kind:'generate',jobId,type:'progress',batch:i,batches:4});ev({kind:'generate',jobId,type:'console',line:'Marked 256 chunks to be force loaded'});if(i===4){clearInterval(t);ev({kind:'generate',jobId,type:'done',path:'D:\\\\Worlds\\\\Generated world.zip',files:12,missingRegions:[],note:'Vanilla servers do not report per-chunk completion.'})}},40);return ok({ok:true,jobId,batches:4})},
create:(a)=>{setTimeout(()=>{ev({kind:'download',jobId:'dl-1',type:'started',total:57e6});ev({kind:'download',jobId:'dl-1',type:'progress',received:3e7,total:57e6})},10);return new Promise((r)=>setTimeout(()=>r({ok:true,server:{id:'new-abc',name:a.name,flavour:a.flavour,version:a.version,jar:{algo:'sha1',digest:'b'.repeat(40),size:57e6}}}),150))}};
window.__vd=[];
window.mvlVdisk={probe:()=>ok(S.win?{ok:true,os:'Microsoft Windows 11 Home',build:'26100',routes:{hyperv:false,storage:true,virtdisk:true,isAdmin:false},unbuilt:{merge:'Merging is not built yet.',quickpack:'Quick pack is not built yet.'}}:{ok:false,unavailable:true,error:'Virtual disks need Windows. This computer runs linux.'}),
browse:(a)=>ok({ok:true,path:a.kind==='iso'?'D:\\\\Images\\\\win.iso':'D:\\\\Disks\\\\data.vhdx'}),
preview:(a)=>ok({ok:true,route:'virtdisk',routeName:'VirtDisk API',admin:!!(a.args&&a.args.init),equivalent:{powershell:"[MvlVirtDisk]::Create('"+((a.args&&a.args.path)||'')+"', 68719476736, $false, $null, 0, 0, 0)",diskpart:'create vdisk file="D:\\\\Disks\\\\data.vhdx" maximum=65536 type=expandable',diskpartNote:'DiskPart reads scripts in the console code page.'}}),
run:(a)=>{window.__vd.push(a);if(a.op==='attach'&&!a.elevate)return ok({ok:false,cancelled:true,incomplete:true,route:'storage',routeName:'Storage module',error:'The administrator prompt was cancelled or refused, so this step did not run. Nothing was changed.',equivalent:{powershell:"Mount-DiskImage -ImagePath 'D:\\\\Disks\\\\data.vhdx' -Access ReadWrite -PassThru",diskpart:''}});if(a.op==='list')return ok({ok:true,route:'storage',routeName:'Storage module',disks:[{number:3,path:'D:\\\\Disks\\\\data.vhdx',size:64*GiB,readOnly:false,status:'Online',style:'GPT',volumes:[{letter:'V',fs:'NTFS',label:'Data',free:60*GiB}]}]});if(a.op==='compact')return ok({ok:false,needsAdmin:true,route:'virtdisk',routeName:'VirtDisk API',error:'OpenVirtualDisk answered 0x00000005: Access is denied.',equivalent:{powershell:'[MvlVirtDisk]::Compact()',diskpart:''}});return ok({ok:true,route:'virtdisk',routeName:'VirtDisk API',created:a.args&&a.args.path,equivalent:{powershell:'New-VHD',diskpart:''}})}};
})();`;

async function openPage(browser, scenario, { width = 1280, height = 900, dark = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: dark ? 'dark' : 'light' });
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.addInitScript({ content: BASE + MOCKS(scenario) + (dark ? "try{localStorage.setItem('mvl-theme','\"dark\"')}catch{}" : '') });
  await p.goto(page);
  await p.addStyleTag({ url: tool('system-suites.css') });
  for (const f of ['system-suites-ui.js', 'system-suites-ollama.js', 'system-suites-minecraft.js', 'system-suites-vdisk.js', 'system-suites-zh-hk.js']) await p.addScriptTag({ url: tool(f) });
  if (dark) await p.evaluate(() => window.MVL && window.MVL.setTheme && window.MVL.setTheme('dark'));
  return { p, ctx, errors };
}
const shot = async (p, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, `system-suites-${name}.png`) }); } };
const noHScroll = (p) => p.evaluate(() => { const el = document.querySelector('.tools-panel'); return el.scrollWidth <= el.clientWidth + 1; });
const smallTargets = (p) => p.evaluate(() => [...document.querySelectorAll('.sys-root button, .sys-root select, .sys-root input:not([type=checkbox]):not([type=file]):not([type=hidden]), .sys-root summary, .sys-root label.sys-meta, .sys-checks label')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 44 && !e.closest('.rtop'); }).map((e) => e.outerHTML.slice(0, 80)));
const realErrors = (errs) => errs.filter((e) => !/favicon|ERR_FILE_NOT_FOUND|Failed to load resource/.test(e));

test('system tools in a browser with mocked bridges', { skip: !playwright, timeout: 240000 }, async () => {
  const browser = await playwright.chromium.launch();
  try {
    // ---- Ollama, running ----
    let { p, ctx, errors } = await openPage(browser, { ollama: 'running', win: false });
    const list = await p.evaluate(() => window.MVLTools.list().filter((t) => t.group === 'System').map((t) => t.id).sort());
    assert.deepEqual(list, ['minecraft-server-manager', 'ollama-suite', 'virtual-disk-manager']);
    await p.evaluate(() => window.MVLTools.open('ollama-suite'));
    await p.getByText('Ollama 0.0.0-mock on 127.0.0.1:11434').waitFor();
    await p.getByText('3 of 3 installed models').waitFor();
    await p.locator('dialog.tools-host').locator('[data-fit="Unlikely"]').click();
    await p.getByText('1 of 3 installed models').waitFor();
    await p.locator('dialog.tools-host').locator('[data-fit="all"]').click();
    await p.locator('dialog.tools-host').locator('[data-show="mock-vision:7b"]').click();
    await p.getByText('completion, vision').waitFor();
    assert.deepEqual(await smallTargets(p), []);
    await shot(p, 'ollama-installed');
    await p.locator('dialog.tools-host').locator('[data-del="mock-large:70b"]').click();
    const dlg = p.locator('dialog[open]').last(); await dlg.waitFor();
    await p.keyboard.press('Escape');
    assert.equal(await p.evaluate(() => window.__olCalls.length), 0, 'delete waits for confirmation');
    await p.locator('dialog.tools-host').getByRole('tab', { name: 'Pull' }).click();
    await p.locator('dialog.tools-host').locator('[data-k="model"]').fill('bad name');
    await p.locator('dialog.tools-host').locator('[data-act="add"]').click();
    await p.getByText('without spaces').waitFor();
    await p.locator('dialog.tools-host').locator('[data-k="model"]').fill('mock-new:3b'); await p.locator('dialog.tools-host').locator('[data-act="add"]').click();
    await p.locator('dialog.tools-host').locator('[data-k="model"]').fill('slow:1b'); await p.locator('dialog.tools-host').locator('[data-act="add"]').click();
    await p.locator('dialog.tools-host').locator('[data-act="go"]').click();
    await p.locator('dialog.tools-host').locator('.sys-item', { hasText: 'mock-new:3b' }).getByText('Pulled').waitFor();
    await p.locator('dialog.tools-host').locator('[data-pullcancel]').first().click();
    await p.getByText('1 pulled, 1 not pulled').waitFor();
    await shot(p, 'ollama-pull');
    await p.locator('dialog.tools-host').getByRole('tab', { name: 'Chat' }).click();
    await p.locator('dialog.tools-host').locator('[data-act="new"]').click();
    await p.locator('dialog.tools-host').locator('[data-k="input"]').fill('Hi there');
    await p.locator('dialog.tools-host').locator('[data-act="send"]').click();
    await p.getByText('Hello from the mock.').waitFor();
    await p.getByText('3 tokens at 30.0 per second').waitFor();
    assert.match(await p.locator('dialog.tools-host').locator('[data-attach]').innerText(), /Open Details|vision/);
    await shot(p, 'ollama-chat');
    await p.locator('dialog.tools-host').getByRole('tab', { name: 'Running' }).click();
    await p.locator('dialog.tools-host').locator('[data-unload="mock-small:1b"]').waitFor();
    await p.locator('dialog.tools-host').getByRole('tab', { name: 'Store and profiles' }).click();
    await p.getByText('Model Store (not built yet)').waitFor();
    assert.equal(await noHScroll(p), true);
    assert.deepEqual(realErrors(errors), []);
    await ctx.close();

    // ---- Ollama, missing, phone width, dark ----
    ({ p, ctx, errors } = await openPage(browser, { ollama: 'missing' }, { width: 390, height: 844, dark: true }));
    await p.evaluate(() => window.MVLTools.open('ollama-suite'));
    await p.getByText('Ollama was not found on this computer').waitFor();
    await p.locator('dialog.tools-host').locator('[data-act="download"]').click();
    await p.getByText('Install Ollama with Get Ollama above').waitFor();
    assert.equal(await noHScroll(p), true, 'no horizontal scroll at 390px');
    await shot(p, 'ollama-missing-390-dark');
    assert.deepEqual(realErrors(errors), []);
    await ctx.close();

    // ---- Minecraft ----
    ({ p, ctx, errors } = await openPage(browser, { ollama: 'running' }));
    await p.evaluate(() => window.MVLTools.open('minecraft-server-manager'));
    await p.getByText('Local Docker').waitFor();
    await p.getByRole('heading', { name: 'Survival' }).waitFor();
    await p.getByText('Minecraft End User License Agreement').waitFor();
    assert.equal(await p.locator('dialog.tools-host').locator('[data-act="accepteula"]').isDisabled(), true, 'accept stays off until the person ticks the box');
    await p.locator('dialog.tools-host').locator('[data-act="start"]').click();
    await p.getByText('The server will not start until you accept', { exact: false }).first().waitFor();
    await p.locator('dialog.tools-host').locator('[data-k="eulaok"]').check();
    await p.locator('dialog.tools-host').locator('[data-act="accepteula"]').click();
    await p.getByText('You accepted the Minecraft EULA for this server.').waitFor();
    await shot(p, 'minecraft-overview');
    await p.locator('dialog.tools-host').locator('[data-act="start"]').click();
    await p.locator('dialog.tools-host').getByRole('tab', { name: 'Console' }).click();
    await p.getByText('Done (3.2s)!', { exact: false }).waitFor();
    await p.locator('dialog.tools-host').locator('[data-q="list"]').click();
    await p.getByText('There are 0 of a max of 20 players online', { exact: false }).waitFor();
    await shot(p, 'minecraft-console');
    await p.locator('dialog.tools-host').getByRole('tab', { name: 'Settings' }).click();
    await p.locator('dialog.tools-host').locator('[data-prop="pvp"] input[role="switch"]').waitFor();
    assert.equal(await p.locator('dialog.tools-host').locator('[data-prop="level-type"] select').count(), 1, 'preset is a picker');
    assert.equal(await p.locator('dialog.tools-host').locator('[data-prop="rcon.password"] input').getAttribute('type'), 'password');
    await p.locator('dialog.tools-host').locator('[data-prop="custom-plugin.key"] input').waitFor();
    await p.locator('dialog.tools-host').locator('[data-prop="pvp"] input[role="switch"]').click();
    await p.locator('dialog.tools-host').locator('[data-prop="server-port"] [data-step="1"]').click();
    await p.getByText('2 unsaved changes.').waitFor();
    await p.locator('dialog.tools-host').locator('[data-act="save"]').click();
    await shot(p, 'minecraft-settings');
    await p.locator('dialog.tools-host').getByRole('tab', { name: 'World generator' }).click();
    await p.locator('dialog.tools-host').locator('[data-act="extract"]').click();
    await p.getByText('4 world presets, 2 biomes, 4 blocks', { exact: false }).waitFor();
    assert.equal(await p.locator('dialog.tools-host').locator('[data-k="aw"]').inputValue(), '100');
    assert.equal(await p.locator('dialog.tools-host').locator('[data-k="ad"]').inputValue(), '100');
    await p.getByText('10000 chunks in 49 batches', { exact: false }).waitFor();
    await p.locator('dialog.tools-host').locator('[data-canvas]').focus(); await p.keyboard.press('Shift+ArrowRight');
    assert.equal(await p.locator('dialog.tools-host').locator('[data-k="aw"]').inputValue(), '101');
    await p.locator('dialog.tools-host').locator('[data-custom="flat"]').click();
    await p.locator('dialog.tools-host').locator('[data-act="addlayer"]').click();
    await p.locator('dialog.tools-host').locator('[data-sset="minecraft:villages"]').check();
    await p.locator('dialog.tools-host').locator('[data-use="keepInventory"]').check();
    await p.locator('dialog.tools-host').locator('[data-out="zip"]').click();
    await p.locator('dialog.tools-host').locator('[data-act="generate"]').click();
    await p.getByText('Tick the EULA switch first', { exact: false }).waitFor();
    await p.locator('dialog.tools-host').locator('[data-act="browse"]').click();
    await p.locator('dialog.tools-host').locator('[data-k="eulaGen"]').check();
    await p.locator('dialog.tools-host').locator('[data-act="generate"]').click();
    await p.getByText('World written and verified file by file', { exact: false }).waitFor();
    const req = await p.evaluate(() => window.__gen);
    assert.equal(req.output, 'zip'); assert.equal(req.personAcceptedEula, true); assert.equal(req.flat.layers.length, 4); assert.deepEqual(req.flat.structures, ['minecraft:villages']); assert.equal(req.area.w, 101); assert.equal(typeof req.gamerules.keepInventory, 'boolean');
    assert.deepEqual(await smallTargets(p), []);
    await shot(p, 'minecraft-world');
    await p.locator('dialog.tools-host').locator('[data-act="new"]').click();
    await p.getByText('4 versions from Mojang', { exact: false }).waitFor();
    await p.locator('dialog.tools-host').locator('[data-type="old_alpha"]').click();
    await p.locator('dialog.tools-host').locator('[data-ver="rd-132211"]').click();
    await p.getByText('lists no dedicated server download', { exact: false }).waitFor();
    await p.locator('dialog.tools-host').locator('[data-ver="1.21.4"]').click();
    await p.locator('dialog.tools-host').locator('[data-act="create"]').click();
    await p.locator('dialog.tools-host').locator('[data-fl]').first().waitFor({ state: 'detached' });
    await p.locator('dialog.tools-host').locator('[data-act="new"]').click();
    await p.locator('dialog.tools-host').locator('[data-fl="bedrock"]').click();
    await p.getByText('Bedrock servers are not built yet').waitFor();
    await shot(p, 'minecraft-new');
    assert.deepEqual(realErrors(errors), []);
    await ctx.close();

    // ---- Virtual disks, not Windows ----
    ({ p, ctx, errors } = await openPage(browser, { win: false }));
    await p.evaluate(() => window.MVLTools.open('virtual-disk-manager'));
    await p.getByText('Virtual disks need Windows. This computer runs linux.').waitFor();
    await p.locator('dialog.tools-host').getByRole('tab', { name: 'Create' }).click();
    assert.equal(await p.locator('dialog.tools-host').locator('[data-run="create"]').isDisabled(), true);
    await p.locator('dialog.tools-host').locator('[data-browse="path"]').click();
    await p.locator('dialog.tools-host').locator('[data-preview="create"]').click();
    await p.getByText('[MvlVirtDisk]::Create', { exact: false }).waitFor();
    assert.deepEqual(await smallTargets(p), []);
    await shot(p, 'vdisk-linux');
    assert.deepEqual(realErrors(errors), []);
    await ctx.close();

    // ---- Virtual disks, Windows Home without Hyper-V ----
    ({ p, ctx, errors } = await openPage(browser, { win: true }, { width: 390, height: 844 }));
    await p.evaluate(() => window.MVLTools.open('virtual-disk-manager'));
    await p.getByText('Hyper-V module: not found').waitFor();
    await p.locator('dialog.tools-host').locator('[data-act="list"]').click();
    await p.getByText('Disk 3: D:\\Disks\\data.vhdx').waitFor();
    await p.locator('dialog.tools-host').getByRole('tab', { name: 'Create' }).click();
    await p.locator('dialog.tools-host').locator('[data-preset="data"]').click();
    await p.locator('dialog.tools-host').locator('[data-k="path"]').fill('D:\\Disks\\new.vhdx');
    await p.locator('dialog.tools-host').locator('[data-run="create"]').click();
    await p.getByText('Route: VirtDisk API', { exact: true }).waitFor();
    await p.locator('dialog.tools-host').getByRole('tab', { name: 'Attach' }).click();
    await p.locator('dialog.tools-host').locator('[data-k="path"]').fill('D:\\Disks\\data.vhdx');
    await p.locator('dialog.tools-host').locator('[data-run="attach"]').click();
    await p.getByText('Cancelled, incomplete', { exact: true }).waitFor();
    await p.locator('dialog.tools-host').getByRole('tab', { name: 'Resize' }).click();
    assert.equal(await p.locator('dialog.tools-host').locator('[data-run="shrink"]').isDisabled(), true, 'shrink needs Hyper-V');
    await p.locator('dialog.tools-host').getByRole('tab', { name: 'Compact' }).click();
    await p.locator('dialog.tools-host').locator('[data-k="path"]').fill('D:\\Disks\\data.vhdx');
    await p.locator('dialog.tools-host').locator('[data-run="compact"]').click();
    await p.locator('dialog.tools-host').locator('[data-elevate]').click();
    const calls = await p.evaluate(() => window.__vd);
    assert.equal(calls[calls.length - 1].elevate, true);
    await p.locator('dialog.tools-host').getByRole('tab', { name: 'More' }).click();
    await p.getByText('Quick pack is not built yet.').waitFor();
    assert.equal(await noHScroll(p), true);
    await shot(p, 'vdisk-windows-390');
    assert.deepEqual(realErrors(errors), []);
    await ctx.close();
  } finally { await browser.close(); }
});
