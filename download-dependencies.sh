#!/usr/bin/env bash
# download-dependencies.sh: fetches the pinned Node.js for this platform from dependencies.json into
# ${XDG_CACHE_HOME:-$HOME/.cache}/material-vm-labs/deps, verifies its SHA-256 before extracting,
# activates it with a locked, journaled swap that keeps the last good copy, then installs the npm
# packages from their lock files. On Linux and macOS this covers the site, the PDF and the tests;
# the Windows apps and installer are built with download-dependencies.bat and build.bat.
#   ./download-dependencies.sh [-s|--silent]     (SILENT=1 also works; it never prompts)
#   eval "$(./download-dependencies.sh --print-path)"  adds the verified tools to this shell's PATH
# Exits non-zero on the first real problem. Nothing it fetches goes into the repository.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
print_path=0
for a in "$@"; do
  case "$a" in
    -s|--silent|/s) SILENT=1 ;;
    --print-path) print_path=1 ;;
    *) echo "problem: unknown option $a" >&2; exit 2 ;;
  esac
done
log() { if [ "$print_path" = 1 ]; then printf '%s %s\n' "$(date +%H:%M:%S)" "$*" >&2; else printf '%s %s\n' "$(date +%H:%M:%S)" "$*"; fi; }
fail() { log "problem: $*"; exit 1; }
sha256() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) platform=linux-x64 ;;
  Linux-aarch64|Linux-arm64) platform=linux-arm64 ;;
  Darwin-arm64) platform=darwin-arm64 ;;
  Darwin-x86_64) platform=darwin-x64 ;;
  *) fail "no pinned dependencies for $(uname -s) $(uname -m) in dependencies.json" ;;
esac
command -v python3 >/dev/null 2>&1 || fail "python3 is needed to read dependencies.json"
command -v tar >/dev/null 2>&1 || fail "tar is needed to extract the archives"
dl() { if command -v curl >/dev/null 2>&1; then curl -fsSL --retry 2 -o "$2" "$1"; elif command -v wget >/dev/null 2>&1; then wget -q -O "$2" "$1"; else fail "curl or wget is needed to download $1"; fi; }

deps_root="${XDG_CACHE_HOME:-$HOME/.cache}/material-vm-labs/deps"
mkdir -p "$deps_root"
journal="$deps_root/activation.journal"
lock="$deps_root/.lock"

# Exclusive lock: mkdir is atomic; a lock left by a process that has ended is taken over.
for _ in $(seq 1 300); do
  if mkdir "$lock" 2>/dev/null; then echo $$ > "$lock/pid"; break; fi
  owner="$(cat "$lock/pid" 2>/dev/null || true)"
  if [ -n "$owner" ] && ! kill -0 "$owner" 2>/dev/null; then log "[--] taking over a lock left by process $owner, which has ended"; rm -rf "$lock"; continue; fi
  sleep 2
done
[ -d "$lock" ] && [ "$(cat "$lock/pid" 2>/dev/null)" = "$$" ] || fail "another dependency fetch holds $lock"
trap 'rm -rf "$lock"' EXIT

# A tree is valid only when every file in its receipt still has the recorded SHA-256.
valid_tree() {
  local dir="$1" rec="$1/.mvl-receipt" sum file
  [ -f "$rec" ] || return 1
  [ -s "$rec" ] || return 1
  while read -r sum file; do
    [ -n "$file" ] || continue
    [ -f "$dir/$file" ] || return 1
    [ "$(sha256 "$dir/$file")" = "$sum" ] || return 1
  done < "$rec"
  return 0
}

# Recover an interrupted activation before anything reads the folders.
if [ -f "$journal" ]; then
  log "[..] found an activation journal from an interrupted run; recovering"
  active="$(sed -n 's/^active=//p' "$journal" | head -n1)"
  backup="$(sed -n 's/^backup=//p' "$journal" | head -n1)"
  stamp="$(date +%Y%m%d%H%M%S)"
  if [ -z "$active" ] || [ -z "$backup" ] || [ "${active#"$deps_root"/}" = "$active" ] || [ "${backup#"$deps_root"/}" = "$backup" ]; then
    # Malformed journal: judge each folder on its own receipt.
    bad=0
    for d in "$deps_root"/*/; do
      d="${d%/}"; case "$d" in *.bak|*.quarantine-*) continue ;; esac
      valid_tree "$d" && continue
      if [ -d "$d.bak" ] && valid_tree "$d.bak"; then mv "$d" "$d.quarantine-$stamp"; mv "$d.bak" "$d"; log "[--] restored $(basename "$d") from its verified backup"; else bad=1; fi
    done
    for b in "$deps_root"/*.bak; do
      [ -d "$b" ] || continue
      if [ ! -e "${b%.bak}" ] && valid_tree "$b"; then mv "$b" "${b%.bak}"; log "[--] restored $(basename "${b%.bak}") from its verified backup"; fi
    done
    [ "$bad" = 0 ] || fail "the activation journal is unreadable and a dependency folder has no valid copy; the journal is kept at $journal"
    mv "$journal" "$journal.quarantine-$stamp"
  else
    if valid_tree "$active"; then rm -rf "$backup"
    elif [ -d "$backup" ] && valid_tree "$backup"; then [ -e "$active" ] && mv "$active" "$active.quarantine-$stamp"; mv "$backup" "$active"; log "[--] restored $(basename "$active") from its verified backup"
    elif [ -e "$active" ]; then mv "$active" "$active.quarantine-$stamp"; fi
    rm -f "$journal"
  fi
  log "[ok] interrupted activation recovered"
fi

# The pinned entries for this platform, as tab-separated fields.
entries="$(python3 -I - "$here/dependencies.json" "$platform" <<'PY'
import json, sys
m = json.load(open(sys.argv[1], encoding='utf-8'))
if m.get('schemaVersion') != 1: sys.exit('dependencies.json has an unknown schemaVersion')
for d in m['dependencies']:
    if d.get('platform') != sys.argv[2] or d.get('status') == 'unpinned': continue
    print('\t'.join([d['name'], d['version'], d['source'], d['sha256'], d['archive'], d['root'], ' '.join(d['provides']), d.get('pathEntry', '.')]))
PY
)" || fail "dependencies.json could not be read"
[ -n "$entries" ] || fail "dependencies.json has no pinned dependency for $platform"

path_entries=()
start_all=$(date +%s)
log "[..] platform $platform; dependencies go to $deps_root (per user)"
while IFS=$'\t' read -r name version source sum archive rootdir provides pathentry; do
  active="$deps_root/$name-$version"
  entry="$active"; [ "$pathentry" = "." ] || entry="$active/$pathentry"
  if valid_tree "$active"; then log "[ok] $name $version already present and verified in $active"; path_entries+=("$entry"); continue; fi
  t0=$(date +%s)
  staging="$deps_root/.staging-$$-$RANDOM$RANDOM"
  mkdir -p "$staging/x"
  file="$staging/$(basename "$source")"
  log "[..] downloading $name $version from $source"
  dl "$source" "$file" || { rm -rf "$staging"; fail "could not download $name $version from $source"; }
  got="$(sha256 "$file")"
  [ "$got" = "$sum" ] || { rm -rf "$staging"; fail "$name $version from $source has SHA-256 $got; dependencies.json records $sum. Nothing was extracted."; }
  log "[ok] SHA-256 verified for $(basename "$file")"
  case "$archive" in
    tar.xz) tar -xJf "$file" -C "$staging/x" ;;
    tar.gz) tar -xzf "$file" -C "$staging/x" ;;
    *) rm -rf "$staging"; fail "$name: archive type $archive is not supported here" ;;
  esac
  tree="$staging/x/$rootdir"
  [ -d "$tree" ] || { rm -rf "$staging"; fail "$name archive has no $rootdir folder"; }
  : > "$tree/.mvl-receipt"
  for p in $provides; do
    [ -s "$tree/$p" ] || { rm -rf "$staging"; fail "$name archive is missing $p"; }
    printf '%s %s\n' "$(sha256 "$tree/$p")" "$p" >> "$tree/.mvl-receipt"
  done
  # Journaled swap: active -> backup, staged -> active; the backup goes only after success.
  backup="$active.bak"
  rm -rf "$backup"
  printf 'active=%s\nbackup=%s\nstaging=%s\n' "$active" "$backup" "$staging" > "$journal.$$"
  mv "$journal.$$" "$journal"
  [ -e "$active" ] && mv "$active" "$backup"
  if mv "$tree" "$active" && valid_tree "$active"; then
    rm -rf "$backup" "$staging"; rm -f "$journal"
  else
    rm -rf "$active"; [ -d "$backup" ] && mv "$backup" "$active"; rm -rf "$staging"; rm -f "$journal"
    fail "activating $name failed; the previous copy was restored"
  fi
  log "[ok] $name $version installed in $active ($(( $(date +%s) - t0 )) s)"
  path_entries+=("$entry")
done <<< "$entries"

for e in "${path_entries[@]}"; do PATH="$e:$PATH"; done
export PATH

# npm packages, verified by the integrity hashes in each lock file.
while IFS=$'\t' read -r pname pdir plock; do
  [ -f "$here/$plock" ] || { log "[--] $pname: no $plock; skipped"; continue; }
  want="$(sha256 "$here/$plock")"
  marker="$here/$pdir/node_modules/.mvl-lock.sha256"
  if [ -f "$marker" ] && [ "$(cat "$marker")" = "$want" ] && [ -f "$here/$pdir/node_modules/.package-lock.json" ]; then
    log "[ok] $pname: packages match $plock"; continue
  fi
  log "[..] $pname: npm ci (checked against the integrity hashes in $plock)"
  if [ "$print_path" = 1 ]; then (cd "$here/$pdir" && npm ci --no-audit --no-fund >&2) || fail "$pname: npm ci failed using $plock"
  else (cd "$here/$pdir" && npm ci --no-audit --no-fund) || fail "$pname: npm ci failed using $plock"; fi
  echo "$want" > "$marker"
  log "[ok] $pname: packages installed"
done < <(python3 -I - "$here/dependencies.json" <<'PY'
import json, sys
for p in json.load(open(sys.argv[1], encoding='utf-8')).get('packages', []):
    if 'win' in p.get('platforms', ['win', 'unix']) and 'unix' not in p.get('platforms', ['unix']): continue
    print('\t'.join([p['name'], p['dir'], p['lockfile']]))
PY
)

log "[ok] dependencies ready in $(( $(date +%s) - start_all )) s"
if [ "$print_path" = 1 ]; then
  for e in "${path_entries[@]}"; do printf 'export PATH=%q:"$PATH"\n' "$e"; done
fi
