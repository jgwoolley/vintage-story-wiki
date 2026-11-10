#!/usr/bin/env bash
# Removes every global copy of vsdev on this machine (including stale ones that shadow the new one on PATH), builds the one in this
# checkout and installs it globally.
#
#   apps/vsdev/scripts/reinstall.sh           install a standalone copy (npm pack + npm install -g); rerun to update
#   apps/vsdev/scripts/reinstall.sh --link    npm link instead: follows this checkout, rebuild to update (for working on vsdev)
#   apps/vsdev/scripts/reinstall.sh --remove  only remove, install nothing
#
# Works from any folder. Uses sudo only for a copy in a folder you can't write to (e.g. /usr), and says so first.
set -euo pipefail

mode=pack
case "${1:-}" in
  "") ;;
  --link) mode=link ;;
  --remove) mode=remove ;;
  -h|--help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *) echo "unknown option '$1' (try --help)" >&2; exit 2 ;;
esac

if [[ -t 1 ]]; then bold=$'\e[1m'; dim=$'\e[2m'; green=$'\e[32m'; yellow=$'\e[33m'; reset=$'\e[0m'; else bold=; dim=; green=; yellow=; reset=; fi
step() { printf '%s==>%s %s\n' "$bold" "$reset" "$*"; }
note() { printf '    %s%s%s\n' "$dim" "$*" "$reset"; }

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
command -v npm >/dev/null || { echo "npm not found" >&2; exit 1; }

# 1. Remove old copies. Every `vsdev` on PATH is a symlink (or shim) into some <prefix>/lib/node_modules/@nf3t/vsdev.
step "Removing old copies of vsdev"
declare -A prefixes=()
while IFS= read -r bin; do
  [[ -n "$bin" ]] || continue
  real="$(readlink -f "$bin" 2>/dev/null || true)"
  # Direct package folder (npm link points it at a checkout), so look at the link the bin goes through as well.
  target="$(readlink "$bin" 2>/dev/null || true)"
  case "$target" in
    */lib/node_modules/@nf3t/vsdev/*) pkg="$(cd "$(dirname "$bin")" && cd "$(dirname "$target")/.." && pwd)" ;;
    *) pkg="" ;;
  esac
  if [[ -n "$pkg" ]]; then prefixes["$(dirname "$(dirname "$(dirname "$(dirname "$pkg")")")")"]=1; fi
  note "found $bin${real:+ -> $real}"
done < <(type -ap vsdev 2>/dev/null | awk '!seen[$0]++')
# The current npm prefix too, in case its bin isn't on PATH.
prefixes["$(npm prefix -g)"]=1

removed=0
for prefix in "${!prefixes[@]}"; do
  if [[ -e "$prefix/lib/node_modules/@nf3t/vsdev" ]] || [[ -L "$prefix/lib/node_modules/@nf3t/vsdev" ]] || [[ -e "$prefix/bin/vsdev" ]] || [[ -L "$prefix/bin/vsdev" ]]; then
    sudo=
    if [[ ! -w "$prefix/lib/node_modules" ]] || [[ ! -w "$prefix/bin" ]]; then
      sudo=sudo
      printf '    %s%s is not writable by you: using sudo%s\n' "$yellow" "$prefix" "$reset"
    fi
    note "uninstalling from $prefix"
    $sudo npm uninstall -g @nf3t/vsdev --prefix "$prefix" >/dev/null 2>&1 || true
    # npm leaves a dangling link behind sometimes (a link to a checkout that moved); clear what is left of ours.
    $sudo rm -rf "$prefix/lib/node_modules/@nf3t/vsdev" "$prefix/bin/vsdev"
    removed=$((removed + 1))
  fi
done
[[ "$removed" -gt 0 ]] && echo "    removed $removed old install(s)" || echo "    none found"

[[ "$mode" = remove ]] && { hash -r 2>/dev/null || true; echo "${green}done${reset}"; exit 0; }

# 2. Build and install the one in this checkout (into your own npm prefix; no sudo).
cd "$repo"
step "Installing dependencies and building"
npm install --ignore-scripts --silent --no-audit --no-fund  # no dependency needs its install scripts
npm run build -w @nf3t/vsdev --silent

if [[ "$mode" = link ]]; then
  step "Linking this checkout globally"
  npm link -w @nf3t/vsdev --silent
else
  step "Packing and installing a standalone copy"
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  npm pack -w @nf3t/vsdev --pack-destination "$tmp" --silent >/dev/null
  npm install -g "$tmp"/nf3t-vsdev-*.tgz --silent --no-audit --no-fund
fi

# 3. Check it is the one that runs.
hash -r 2>/dev/null || true
step "Checking"
if ! command -v vsdev >/dev/null; then
  echo "${yellow}vsdev is installed but not on PATH. Add $(npm prefix -g)/bin to PATH.${reset}" >&2
  exit 1
fi
others="$(type -ap vsdev | awk '!seen[$0]++' | wc -l)"
note "$(command -v vsdev)"
[[ "$others" -gt 1 ]] && echo "${yellow}more than one vsdev is still on PATH (type -a vsdev); the first one wins${reset}"
echo "${green}done${reset}: run \`vsdev --help\`"
