'use strict';
// Pure helpers for the Windows virtual disk manager: strict request validation, format limits, and
// PowerShell script builders. Every value placed in a script is validated first and then written as
// a PowerShell single-quoted literal, so user text is data, never code. DiskPart is shown only as an
// equivalent script to copy, never run, because DiskPart reads scripts in the console code page.

const MiB = 1024 ** 2, GiB = 1024 ** 3, TiB = 1024 ** 4;
const LIMITS = Object.freeze({ min: 3 * MiB, vhdMax: 2040 * GiB, vhdxMax: 64 * TiB });
const DISK_EXT = ['.vhd', '.vhdx', '.vhds', '.avhd', '.avhdx'];
const ALL_EXT = DISK_EXT.concat('.iso');
const OPT_MODES = ['Full', 'Quick', 'Retrim', 'Pretrimmed', 'Prezeroed'];
const FILE_SYSTEMS = ['NTFS', 'ReFS', 'exFAT', 'FAT32'];

function psQuote(s) {
  if (/[\u0000-\u001f]/.test(String(s))) throw new Error('Control characters are not allowed in a value.');
  return "'" + String(s).replace(/['\u2018\u2019\u201A\u201B]/g, (m) => m + m) + "'";
}
function ext(p) { const m = /\.[A-Za-z0-9]+$/.exec(p); return m ? m[0].toLowerCase() : ''; }
function validPath(p, exts) {
  if (typeof p !== 'string' || p.length < 4 || p.length > 1000) return 'Choose a full file path.';
  if (/^\\\\/.test(p)) return 'Network locations are not supported for virtual disks here; use a local drive.';
  if (!/^[A-Za-z]:\\/.test(p)) return 'Use a full path that starts with a drive letter, such as D:\\Disks\\data.vhdx.';
  if (/[<>"|?*\u0000-\u001f]/.test(p.slice(2)) || p.slice(2).includes(':')) return 'The path contains characters Windows does not allow.';
  if (/(^|\\)\.\.(\\|$)/.test(p)) return 'Use a path without ".." parts.';
  if (/^[A-Za-z]:\\windows(\\|$)/i.test(p)) return 'Virtual disk files cannot live inside the Windows folder.';
  if (exts && !exts.includes(ext(p))) return `The file must end in ${exts.join(', ')}.`;
  return '';
}
function parseSize(text) {
  const m = /^\s*([0-9]+(?:\.[0-9]+)?)\s*(B|KB|MB|GB|TB)?\s*$/i.exec(String(text));
  if (!m) return null;
  const mult = { B: 1, KB: 1024, MB: MiB, GB: GiB, TB: TiB }[(m[2] || 'GB').toUpperCase()];
  return Math.round(Number(m[1]) * mult);
}
function maxFor(format) { return format === '.vhd' ? LIMITS.vhdMax : LIMITS.vhdxMax; }
function sizeError(bytes, format) {
  if (!Number.isSafeInteger(bytes) || bytes <= 0) return 'Enter a size, such as 64 GB.';
  if (bytes < LIMITS.min) return 'A virtual disk must be at least 3 MB.';
  if (bytes > maxFor(format)) return format === '.vhd' ? 'A VHD can be at most 2,040 GB. Use VHDX for larger disks.' : 'A VHDX can be at most 64 TB.';
  return '';
}

function validateCreate(o) {
  const e = validPath(o.path, ['.vhd', '.vhdx', '.vhds']); if (e) return e;
  const f = ext(o.path);
  if (!['fixed', 'dynamic', 'differencing'].includes(o.type)) return 'Choose fixed, dynamically expanding or differencing.';
  if (o.type === 'differencing') { const pe = validPath(o.parentPath, ['.vhd', '.vhdx', '.avhd', '.avhdx']); if (pe) return 'Parent: ' + pe; if (o.parentPath.toLowerCase() === o.path.toLowerCase()) return 'A disk cannot be its own parent.'; }
  else { const se = sizeError(o.sizeBytes, f); if (se) return se; }
  if (o.blockSizeMB != null) { if (f !== '.vhdx') return 'Block size applies to VHDX only.'; const b = o.blockSizeMB; if (!Number.isInteger(b) || b < 1 || b > 256 || (b & (b - 1))) return 'Block size must be a power of two from 1 MB to 256 MB.'; }
  for (const k of ['logicalSector', 'physicalSector']) if (o[k] != null) { if (f !== '.vhdx') return 'Sector sizes apply to VHDX only.'; if (o[k] !== 512 && o[k] !== 4096) return 'Sector sizes are 512 or 4096 bytes.'; }
  if (o.init != null) {
    if (o.type === 'differencing') return 'A differencing disk takes its contents from its parent; it is not initialized.';
    if (!['GPT', 'MBR'].includes(o.init.style)) return 'Choose GPT or MBR.';
    if (!FILE_SYSTEMS.includes(o.init.fs)) return 'Choose a file system.';
    if (typeof o.init.label !== 'string' || o.init.label.length > 32 || /[\u0000-\u001f]/.test(o.init.label)) return 'The volume label is at most 32 characters.';
    if (typeof o.init.letter !== 'boolean') return 'Choose whether to assign a drive letter.';
  }
  return '';
}

const ROUTE_NAMES = { hyperv: 'Hyper-V module', virtdisk: 'VirtDisk API', storage: 'Storage module' };

const VIRTDISK_CS = `using System; using System.Runtime.InteropServices; using System.ComponentModel;
public static class MvlVirtDisk {
  [StructLayout(LayoutKind.Sequential)] public struct VST { public uint DeviceId; public Guid VendorId; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public struct CreateV2 { public int Version; public int Pad; public Guid UniqueId; public ulong MaximumSize; public uint BlockSizeInBytes; public uint SectorSizeInBytes; public uint PhysicalSectorSizeInBytes; [MarshalAs(UnmanagedType.LPWStr)] public string ParentPath; [MarshalAs(UnmanagedType.LPWStr)] public string SourcePath; public int OpenFlags; public VST ParentVirtualStorageType; public VST SourceVirtualStorageType; public Guid ResiliencyGuid; }
  [StructLayout(LayoutKind.Sequential)] public struct OpenV2 { public int Version; public int GetInfoOnly; public int ReadOnly; public Guid ResiliencyGuid; }
  [StructLayout(LayoutKind.Sequential)] public struct ResizeV1 { public int Version; public ulong NewSize; }
  [StructLayout(LayoutKind.Sequential)] public struct CompactV1 { public int Version; public uint Reserved; }
  [DllImport("virtdisk.dll", CharSet = CharSet.Unicode)] static extern uint CreateVirtualDisk(ref VST t, string path, int access, IntPtr sd, int flags, uint provider, ref CreateV2 p, IntPtr ov, out IntPtr h);
  [DllImport("virtdisk.dll", CharSet = CharSet.Unicode)] static extern uint OpenVirtualDisk(ref VST t, string path, int access, int flags, ref OpenV2 p, out IntPtr h);
  [DllImport("virtdisk.dll")] static extern uint ResizeVirtualDisk(IntPtr h, int flags, ref ResizeV1 p, IntPtr ov);
  [DllImport("virtdisk.dll")] static extern uint CompactVirtualDisk(IntPtr h, int flags, ref CompactV1 p, IntPtr ov);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  static readonly Guid MS = new Guid("EC984AEC-A0F9-47e9-901F-71415A66345B");
  static VST Kind(string path) { string e = System.IO.Path.GetExtension(path).ToLowerInvariant(); return new VST { DeviceId = e == ".vhd" ? 2u : 3u, VendorId = MS }; }
  static void Check(uint r, string what) { if (r != 0) throw new Win32Exception(unchecked((int)r), what + " answered 0x" + r.ToString("X8") + ": " + new Win32Exception(unchecked((int)r)).Message); }
  public static void Create(string path, ulong size, bool full, string parent, uint block, uint logical, uint physical) {
    VST t = Kind(path); CreateV2 p = new CreateV2 { Version = 2, UniqueId = Guid.NewGuid(), MaximumSize = parent == null ? size : 0, BlockSizeInBytes = block, SectorSizeInBytes = logical, PhysicalSectorSizeInBytes = physical, ParentPath = parent };
    if (parent != null) p.ParentVirtualStorageType = Kind(parent);
    IntPtr h; Check(CreateVirtualDisk(ref t, path, 0, IntPtr.Zero, full ? 1 : 0, 0, ref p, IntPtr.Zero, out h), "CreateVirtualDisk"); CloseHandle(h); }
  static IntPtr Open(string path) { VST t = Kind(path); OpenV2 p = new OpenV2 { Version = 2 }; IntPtr h; Check(OpenVirtualDisk(ref t, path, 0, 0, ref p, out h), "OpenVirtualDisk"); return h; }
  public static void Resize(string path, ulong size) { IntPtr h = Open(path); try { ResizeV1 p = new ResizeV1 { Version = 1, NewSize = size }; Check(ResizeVirtualDisk(h, 0, ref p, IntPtr.Zero), "ResizeVirtualDisk"); } finally { CloseHandle(h); } }
  public static void Compact(string path) { IntPtr h = Open(path); try { CompactV1 p = new CompactV1 { Version = 1 }; Check(CompactVirtualDisk(h, 0, ref p, IntPtr.Zero), "CompactVirtualDisk"); } finally { CloseHandle(h); } }
}`;
const ADD_TYPE = "if (-not ('MvlVirtDisk' -as [type])) { Add-Type -TypeDefinition @'\n" + VIRTDISK_CS + "\n'@ }";

// Wrap an operation body so it always prints (or writes) one JSON object.
function envelope(body, resultFile) {
  const out = resultFile ? `[IO.File]::WriteAllText(${psQuote(resultFile)}, $json, [Text.Encoding]::UTF8)` : '[Console]::Out.Write($json)';
  return ["$ErrorActionPreference = 'Stop'", "$ProgressPreference = 'SilentlyContinue'", '$r = [ordered]@{ ok = $true }', 'try {', body, '} catch {', '  $r.ok = $false; $r.error = $_.Exception.Message; $r.hresult = $_.Exception.HResult', '}', '$json = $r | ConvertTo-Json -Depth 6 -Compress', out].join('\n');
}
function encode(script) { return Buffer.from(script, 'utf16le').toString('base64'); }
function powershellArgs(script) { return ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encode(script)]; }
// The outer, non-elevated script asks Windows for administrator rights through the normal UAC
// prompt. A cancelled prompt (error 1223) is reported as cancelled, never as success.
function elevatedLauncher(innerScript) {
  const args = "@('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand','" + encode(innerScript) + "')";
  return [
    "$ErrorActionPreference = 'Stop'",
    'try {',
    `  $p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList ${args}`,
    "  [Console]::Out.Write((@{ elevated = $true; exitCode = $p.ExitCode } | ConvertTo-Json -Compress))",
    '} catch {',
    "  if ($_.Exception.NativeErrorCode -eq 1223 -or $_.Exception.Message -match 'cancel') { [Console]::Out.Write('{\"elevated\":false,\"cancelled\":true}') }",
    "  else { [Console]::Out.Write((@{ elevated = $false; cancelled = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress)) }",
    '}',
  ].join('\n');
}

const OPS = ['probe', 'list', 'inspect', 'create', 'attach', 'detach', 'expand', 'shrink', 'compact', 'convert', 'test'];
const UNBUILT = {
  merge: 'Merging needs the list of every sibling a merge invalidates and a verified copy first; that flow is not built yet.',
  sets: 'VHD Set checkpoints (take, apply, delete) are not built yet.',
  metadata: 'Viewing and editing VHDX custom metadata and resetting the disk identifier are not built yet.',
  mirror: 'Live mirroring and resilient change tracking views are not built yet.',
  devdrive: 'Dev Drive creation and trust settings are not built yet.',
  nativeboot: 'Native boot preparation (DISM, bcdboot and BCD backup) is not built yet.',
  quickpack: 'Quick pack (drop files to create a hash-verified VHDX) is not built yet.',
  reparent: 'Reconnecting a moved parent is not built yet.',
};

// Validate a request and build { route, admin, script, equivalent }.
function build(op, a, routes) {
  if (!OPS.includes(op)) throw new Error(`"${op}" is not an allowed virtual disk operation.`);
  a = a || {};
  routes = routes || {};
  const q = psQuote;
  let route = 'storage', admin = false, body = '', ps = '', dp = '';
  const needPath = (exts) => { const e = validPath(a.path, exts); if (e) throw new Error(e); };
  switch (op) {
    case 'probe':
      body = ["$id = [Security.Principal.WindowsIdentity]::GetCurrent()", '$r.isAdmin = ([Security.Principal.WindowsPrincipal]$id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)', "$r.hyperv = [bool](Get-Command New-VHD -ErrorAction SilentlyContinue)", "$r.storage = [bool](Get-Command Mount-DiskImage -ErrorAction SilentlyContinue)", "$r.virtdisk = Test-Path (Join-Path $env:SystemRoot 'System32\\virtdisk.dll')", '$os = Get-CimInstance Win32_OperatingSystem', '$r.os = $os.Caption; $r.build = $os.BuildNumber'].join('\n');
      route = 'probe'; break;
    case 'list':
      body = ["$r.disks = @(Get-Disk | Where-Object { $_.BusType -eq 'File Backed Virtual' } | ForEach-Object {", '  $d = $_', "  $vols = @(Get-Partition -DiskNumber $d.Number -ErrorAction SilentlyContinue | ForEach-Object { $p = $_; $v = $p | Get-Volume -ErrorAction SilentlyContinue; [ordered]@{ partition = $p.PartitionNumber; letter = [string]$p.DriveLetter; size = $p.Size; fs = $v.FileSystem; label = $v.FileSystemLabel; free = $v.SizeRemaining } })", '  [ordered]@{ number = $d.Number; path = $d.Location; size = $d.Size; readOnly = $d.IsReadOnly; status = [string]$d.OperationalStatus; style = [string]$d.PartitionStyle; volumes = $vols }', '})'].join('\n');
      ps = "Get-Disk | Where-Object BusType -eq 'File Backed Virtual' | Get-Partition | Get-Volume"; break;
    case 'inspect': {
      needPath(ALL_EXT);
      const fileInfo = `$f = Get-Item -LiteralPath ${q(a.path)}; $r.fileBytes = $f.Length; $r.modified = $f.LastWriteTimeUtc.ToString('o'); $r.attributes = [string]$f.Attributes`;
      if (routes.hyperv && ext(a.path) !== '.iso') { route = 'hyperv'; body = fileInfo + `\n$v = Get-VHD -Path ${q(a.path)}\n$r.info = [ordered]@{ format = [string]$v.VhdFormat; type = [string]$v.VhdType; size = $v.Size; fileSize = $v.FileSize; minimumSize = $v.MinimumSize; blockSize = $v.BlockSize; logicalSector = $v.LogicalSectorSize; physicalSector = $v.PhysicalSectorSize; fragmentation = $v.FragmentationPercentage; attached = $v.Attached; diskNumber = $v.DiskNumber; parentPath = $v.ParentPath; diskIdentifier = [string]$v.DiskIdentifier; alignment = $v.Alignment }`; ps = `Get-VHD -Path ${q(a.path)} | Format-List *`; }
      else { body = fileInfo + `\n$i = Get-DiskImage -ImagePath ${q(a.path)}\n$r.info = [ordered]@{ type = [string]$i.StorageType; size = $i.Size; fileSize = $i.FileSize; attached = $i.Attached; diskNumber = $i.Number; devicePath = $i.DevicePath }`; ps = `Get-DiskImage -ImagePath ${q(a.path)}`; }
      break;
    }
    case 'create': {
      const e = validateCreate(a); if (e) throw new Error(e);
      const f = ext(a.path);
      const exists = `if (Test-Path -LiteralPath ${q(a.path)}) { throw 'A file already exists at that path; nothing was overwritten.' }`;
      const block = a.blockSizeMB ? a.blockSizeMB * MiB : 0, ls = a.logicalSector || 0, phs = a.physicalSector || 0;
      if (routes.hyperv) {
        route = 'hyperv';
        let cmd = `New-VHD -Path ${q(a.path)}`;
        if (a.type === 'differencing') cmd += ` -Differencing -ParentPath ${q(a.parentPath)}`; else cmd += ` -SizeBytes ${a.sizeBytes} -${a.type === 'fixed' ? 'Fixed' : 'Dynamic'}`;
        if (block) cmd += ` -BlockSizeBytes ${block}`; if (ls) cmd += ` -LogicalSectorSizeBytes ${ls}`; if (phs) cmd += ` -PhysicalSectorSizeBytes ${phs}`;
        ps = cmd; body = exists + '\n$null = ' + cmd;
      } else {
        if (f === '.vhds') throw new Error('Creating a VHD Set needs the Hyper-V module on this host, which was not found.');
        route = 'virtdisk';
        ps = `[MvlVirtDisk]::Create(${q(a.path)}, ${a.type === 'differencing' ? 0 : a.sizeBytes}, $${a.type === 'fixed'}, ${a.type === 'differencing' ? q(a.parentPath) : '$null'}, ${block}, ${ls}, ${phs})`;
        body = exists + '\n' + ADD_TYPE + '\n' + ps;
      }
      if (a.init) {
        admin = true;
        const init = `$img = Mount-DiskImage -ImagePath ${q(a.path)} -PassThru | Get-DiskImage\n$disk = Get-Disk -Number $img.Number\nInitialize-Disk -Number $disk.Number -PartitionStyle ${a.init.style}\n$part = New-Partition -DiskNumber $disk.Number -UseMaximumSize${a.init.letter ? ' -AssignDriveLetter' : ''}\n$vol = Format-Volume -Partition $part -FileSystem ${a.init.fs} -NewFileSystemLabel ${q(a.init.label)} -Confirm:$false\n$r.diskNumber = $disk.Number; $r.letter = [string]$part.DriveLetter; $r.fs = $vol.FileSystem`;
        body += '\n' + init; ps += '\n' + init;
      }
      body += `\n$r.created = ${q(a.path)}`;
      dp = a.type === 'differencing' ? `create vdisk file="${a.path}" parent="${a.parentPath}"` : `create vdisk file="${a.path}" maximum=${Math.ceil(a.sizeBytes / MiB)} type=${a.type === 'fixed' ? 'fixed' : 'expandable'}`;
      break;
    }
    case 'attach': {
      needPath(['.vhd', '.vhdx', '.vhds', '.iso']);
      const iso = ext(a.path) === '.iso';
      admin = !iso;
      const access = iso || a.readOnly ? 'ReadOnly' : 'ReadWrite';
      ps = `Mount-DiskImage -ImagePath ${q(a.path)} -Access ${access}${a.noDriveLetter ? ' -NoDriveLetter' : ''} -PassThru`;
      body = `$cur = Get-DiskImage -ImagePath ${q(a.path)}\nif ($cur.Attached) { $r.already = $true; $r.diskNumber = $cur.Number } else { $i = ${ps} | Get-DiskImage; $r.diskNumber = $i.Number; $r.access = '${access}' }`;
      dp = `select vdisk file="${a.path}"\nattach vdisk${access === 'ReadOnly' ? ' readonly' : ''}`;
      break;
    }
    case 'detach':
      needPath(['.vhd', '.vhdx', '.vhds', '.iso']);
      admin = ext(a.path) !== '.iso';
      ps = `Dismount-DiskImage -ImagePath ${q(a.path)}`;
      body = `$cur = Get-DiskImage -ImagePath ${q(a.path)}\nif (-not $cur.Attached) { $r.already = $true } else { $null = ${ps}; $r.detached = $true }`;
      dp = `select vdisk file="${a.path}"\ndetach vdisk`;
      break;
    case 'expand': {
      needPath(['.vhd', '.vhdx']);
      const se = sizeError(a.sizeBytes, ext(a.path)); if (se) throw new Error(se);
      const check = `$cur = (Get-DiskImage -ImagePath ${q(a.path)}).Size\nif (${a.sizeBytes} -le $cur) { throw 'The new size must be larger than the current size; use Shrink to make a disk smaller.' }`;
      if (routes.hyperv) { route = 'hyperv'; ps = `Resize-VHD -Path ${q(a.path)} -SizeBytes ${a.sizeBytes}`; body = check + '\n' + ps; }
      else { route = 'virtdisk'; ps = `[MvlVirtDisk]::Resize(${q(a.path)}, ${a.sizeBytes})`; body = check + '\n' + ADD_TYPE + '\n' + ps; }
      if (a.extendPartition) {
        admin = true;
        const ext2 = `$img = Get-DiskImage -ImagePath ${q(a.path)}\nif ($img.Attached) { Update-Disk -Number $img.Number; $last = Get-Partition -DiskNumber $img.Number | Sort-Object Offset | Select-Object -Last 1; $max = (Get-PartitionSupportedSize -DiskNumber $img.Number -PartitionNumber $last.PartitionNumber).SizeMax; if ($max -gt $last.Size) { Resize-Partition -DiskNumber $img.Number -PartitionNumber $last.PartitionNumber -Size $max; $r.extendedPartition = $last.PartitionNumber } } else { $r.extendNote = 'The disk is not attached, so its partition was not extended. Attach it and grow again with the same size to extend.' }`;
        body += '\n' + ext2; ps += '\n' + ext2;
      }
      body += `\n$r.newSize = ${a.sizeBytes}`;
      dp = `select vdisk file="${a.path}"\nexpand vdisk maximum=${Math.ceil(a.sizeBytes / MiB)}`;
      break;
    }
    case 'shrink':
      needPath(['.vhdx']);
      if (!routes.hyperv) throw new Error('Shrinking is built on the Hyper-V module here, which was not found on this host.');
      route = 'hyperv';
      if (a.toMinimum) ps = `Resize-VHD -Path ${q(a.path)} -ToMinimumSize`;
      else { const se = sizeError(a.sizeBytes, '.vhdx'); if (se) throw new Error(se); ps = `Resize-VHD -Path ${q(a.path)} -SizeBytes ${a.sizeBytes}`; }
      body = `$min = (Get-VHD -Path ${q(a.path)}).MinimumSize\n$r.minimumSize = $min\n${a.toMinimum ? '' : `if (${a.sizeBytes} -lt $min) { throw ('The smallest safe size is ' + $min + ' bytes. Shrink the last partition first to go lower.') }\n`}${ps}\n$r.newSize = (Get-VHD -Path ${q(a.path)}).Size`;
      break;
    case 'compact':
      needPath(['.vhd', '.vhdx', '.avhd', '.avhdx']);
      if (routes.hyperv) {
        if (!OPT_MODES.includes(a.mode)) throw new Error('Choose a compact mode.');
        route = 'hyperv'; ps = `Optimize-VHD -Path ${q(a.path)} -Mode ${a.mode}`;
        body = `$before = (Get-Item -LiteralPath ${q(a.path)}).Length\n${ps}\n$r.before = $before; $r.after = (Get-Item -LiteralPath ${q(a.path)}).Length; $r.mode = '${a.mode}'`;
      } else {
        route = 'virtdisk'; ps = `[MvlVirtDisk]::Compact(${q(a.path)})`;
        body = `$before = (Get-Item -LiteralPath ${q(a.path)}).Length\n${ADD_TYPE}\n${ps}\n$r.before = $before; $r.after = (Get-Item -LiteralPath ${q(a.path)}).Length; $r.mode = 'VirtDisk default (no mode choice on this route)'`;
      }
      dp = `select vdisk file="${a.path}"\nattach vdisk readonly\ncompact vdisk\ndetach vdisk`;
      break;
    case 'convert': {
      needPath(['.vhd', '.vhdx']);
      const de = validPath(a.dest, ['.vhd', '.vhdx', '.vhds']); if (de) throw new Error('Destination: ' + de);
      if (a.dest.toLowerCase() === a.path.toLowerCase()) throw new Error('Choose a different destination file.');
      if (a.vhdType != null && !['Fixed', 'Dynamic'].includes(a.vhdType)) throw new Error('Choose fixed or dynamic, or keep the source type.');
      if (!routes.hyperv) throw new Error('Converting is built on the Hyper-V module here, which was not found on this host.');
      route = 'hyperv';
      ps = `Convert-VHD -Path ${q(a.path)} -DestinationPath ${q(a.dest)}${a.vhdType ? ' -VHDType ' + a.vhdType : ''}`;
      body = `if (Test-Path -LiteralPath ${q(a.dest)}) { throw 'A file already exists at the destination; nothing was overwritten.' }\n$src = Get-VHD -Path ${q(a.path)}\nif ($src.Attached) { throw 'Detach the source first; conversion works offline only.' }\nif (${q(ext(a.dest))} -eq '.vhd' -and $src.Size -gt ${LIMITS.vhdMax}) { throw 'The source is larger than 2,040 GB, which a VHD cannot hold.' }\n${ps}\n$r.dest = ${q(a.dest)}; $r.sourceKept = $true`;
      break;
    }
    case 'test':
      needPath(['.vhd', '.vhdx', '.avhd', '.avhdx', '.vhds']);
      if (!routes.hyperv) throw new Error('Chain testing uses Test-VHD from the Hyper-V module, which was not found on this host.');
      route = 'hyperv'; ps = `Test-VHD -Path ${q(a.path)}`; body = `$r.usable = [bool](${ps})`;
      break;
  }
  return { op, route, routeName: ROUTE_NAMES[route] || route, admin, body, equivalent: { powershell: route === 'virtdisk' ? ADD_TYPE + '\n' + ps : ps, diskpart: dp, diskpartNote: dp ? 'DiskPart reads scripts in the console code page, so paths with non-ASCII letters can fail there.' : '' } };
}

module.exports = { LIMITS, DISK_EXT, ALL_EXT, OPT_MODES, FILE_SYSTEMS, OPS, UNBUILT, ROUTE_NAMES, psQuote, ext, validPath, parseSize, sizeError, validateCreate, envelope, encode, powershellArgs, elevatedLauncher, build, VIRTDISK_CS };
