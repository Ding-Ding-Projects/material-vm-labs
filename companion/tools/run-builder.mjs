// run-builder.mjs: runs electron-builder for one companion target.
//   manager   -> single portable exe of the manager (Machines, Runners, Receipts, Media, Build, Docs, Settings)
//   docs      -> single portable exe of the documentation site reader
//   build     -> single portable exe of the build GUI
//   installer -> unsigned Squirrel.Windows installer of the manager (which contains the docs reader and build bay too)
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, Platform, Arch } from 'electron-builder';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const version = readFileSync(join(root, '..', 'VERSION'), 'utf8').trim();
const mode = process.argv[2];

const common = {
  directories: { output: `out/${mode}`, buildResources: 'buildResources' },
  files: ['package.json', 'src/**', 'renderer/**', 'generated/**'],
  asar: true,
  npmRebuild: false,
  publish: null
};

const configs = {
  manager: {
    ...common,
    appId: 'com.dingdingprojects.materialvmlabs.manager',
    productName: 'Material VM Labs',
    extraMetadata: { version, main: 'src/manager/main.js' },
    win: { icon: 'icon.ico', signAndEditExecutable: true, target: [{ target: 'portable', arch: ['x64'] }] },
    portable: { artifactName: 'MaterialVmLabs-${version}.exe' }
  },
  docs: {
    ...common,
    appId: 'com.dingdingprojects.materialvmlabs.docs',
    productName: 'Material VM Labs Docs',
    extraMetadata: { version, main: 'src/docs/main.js' },
    win: { signAndEditExecutable: false, target: [{ target: 'portable', arch: ['x64'] }] },
    portable: { artifactName: 'MaterialVmLabs-Docs-${version}.exe' }
  },
  build: {
    ...common,
    appId: 'com.dingdingprojects.materialvmlabs.build',
    productName: 'Material VM Labs Build',
    extraMetadata: { version, main: 'src/build/main.js' },
    win: { signAndEditExecutable: false, target: [{ target: 'portable', arch: ['x64'] }] },
    portable: { artifactName: 'MaterialVmLabs-Build-${version}.exe' }
  },
  installer: {
    ...common,
    appId: 'com.dingdingprojects.materialvmlabs',
    productName: 'MaterialVmLabs',
    extraMetadata: { version, main: 'src/manager/main.js' },
    win: { icon: 'icon.ico', signAndEditExecutable: true, target: [{ target: 'squirrel', arch: ['x64'] }] },
    squirrelWindows: { name: 'MaterialVmLabs', artifactName: 'MaterialVmLabsSetup.exe', iconUrl: 'https://raw.githubusercontent.com/Ding-Ding-Projects/material-vm-labs/main/companion/icon.ico' }
  }
};

if (!configs[mode]) { console.error(`unknown mode "${mode}"; use manager, docs, build or installer`); process.exit(2); }
const target = mode === 'installer' ? 'squirrel' : 'portable';
console.log(`electron-builder: ${mode} (${target}, unsigned) version ${version}`);
await build({ targets: Platform.WINDOWS.createTarget([target], Arch.x64), config: configs[mode], publish: 'never' });
