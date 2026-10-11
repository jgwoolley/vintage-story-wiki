#!/usr/bin/env bash
set -e

# ---- Defaults ----
SERVER_BRANCH="stable"
SERVER_VERSION="1.22.7"
SERVER_DIR="vs_server"
MODS_DIR="Mods"
FORCE=0
MODS=()   # entries like "modid" or "modid:version"

# ---- Colors (only when attached to a terminal) ----
if [ -t 1 ]; then
  RED='\033[31m'; GREEN='\033[32m'; YELLOW='\033[33m'; BLUE='\033[34m'; RESET='\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; BLUE=''; RESET=''
fi

info() { printf "${BLUE}==>${RESET} %s\n" "$1"; }
ok()   { printf "${GREEN}✔${RESET} %s\n" "$1"; }
skip() { printf "${YELLOW}-${RESET} %s\n" "$1"; }
err()  { printf "${RED}✘${RESET} %s\n" "$1" >&2; }

usage() {
  cat <<EOF
Usage: $0 [options]

  --server-branch BRANCH   Vintage Story server branch (default: $SERVER_BRANCH)
  --server-version VER     Vintage Story server version (default: $SERVER_VERSION)
  --server-dir DIR         Install directory for the server (default: $SERVER_DIR)
  --mod MODID[:VERSION]    Mod to install, repeatable. Omit VERSION for latest.
                           MODID is the numeric id or slug from mods.vintagestory.at
  --force                  Re-download/reinstall even if already present
  -h, --help                Show this help

Example:
  $0 --server-version 1.22.7 --mod 123:0.6.4 --mod betterruins
EOF
}

# ---- Argument parsing ----
while [ $# -gt 0 ]; do
  case "$1" in
    --server-branch) SERVER_BRANCH="$2"; shift 2 ;;
    --server-branch=*) SERVER_BRANCH="${1#*=}"; shift ;;
    --server-version) SERVER_VERSION="$2"; shift 2 ;;
    --server-version=*) SERVER_VERSION="${1#*=}"; shift ;;
    --server-dir) SERVER_DIR="$2"; shift 2 ;;
    --server-dir=*) SERVER_DIR="${1#*=}"; shift ;;
    --mod) MODS+=("$2"); shift 2 ;;
    --mod=*) MODS+=("${1#*=}"); shift ;;
    --force) FORCE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) err "Unknown argument: $1"; usage; exit 1 ;;
  esac
done

SERVER_ARCHIVE="vs_server.tar.gz"
SERVER_URL="https://cdn.vintagestory.at/gamefiles/$SERVER_BRANCH/vs_server_linux-x64_$SERVER_VERSION.tar.gz"

# ---- Server install ----
install_server() {
  if [ "$FORCE" -eq 0 ] && [ -d "$SERVER_DIR" ] && [ -n "$(ls -A "$SERVER_DIR" 2>/dev/null)" ]; then
    skip "Server already present in $SERVER_DIR/, skipping (use --force to reinstall)"
    return
  fi

  info "Downloading Vintage Story server $SERVER_VERSION ($SERVER_BRANCH)"
  curl -sSfL -o "$SERVER_ARCHIVE" "$SERVER_URL" >/dev/null

  info "Extracting server to $SERVER_DIR/"
  mkdir -p "$SERVER_DIR"
  tar -xzf "$SERVER_ARCHIVE" -C "$SERVER_DIR" >/dev/null 2>&1
  rm -f "$SERVER_ARCHIVE"

  ok "Server installed"
}

# ---- Mod install (via the ModDB API, mods.vintagestory.at) ----
install_mod() {
  local spec="$1"
  local modid="${spec%%:*}"
  local version=""
  if [[ "$spec" == *:* ]]; then
    version="${spec#*:}"
  fi

  info "Looking up mod '$modid'${version:+ version $version}"

  local api_json
  api_json="$(curl -sSfL "https://mods.vintagestory.at/api/mod/$modid")"

  local filename mainfile
  if [ -n "$version" ]; then
    filename="$(echo "$api_json" | jq -r --arg v "$version" '.mod.releases[] | select(.modversion == $v) | .filename' | head -n1)"
    mainfile="$(echo "$api_json" | jq -r --arg v "$version" '.mod.releases[] | select(.modversion == $v) | .mainfile' | head -n1)"
  else
    filename="$(echo "$api_json" | jq -r '.mod.releases[0].filename')"
    mainfile="$(echo "$api_json" | jq -r '.mod.releases[0].mainfile')"
  fi

  if [ -z "$filename" ] || [ "$filename" = "null" ]; then
    err "Could not find mod '$modid'${version:+ version $version} on mods.vintagestory.at"
    return 1
  fi

  local dest="$MODS_DIR/$filename"

  if [ "$FORCE" -eq 0 ] && [ -f "$dest" ]; then
    skip "Mod already present: $dest (use --force to re-download)"
    return
  fi

  info "Downloading mod $filename"
  mkdir -p "$MODS_DIR"
  local download_url="$mainfile"
  if [[ "$download_url" != http*://* ]]; then
    download_url="https://mods.vintagestory.at$download_url"
  fi
  curl -sSfL -o "$dest" "$download_url" >/dev/null

  ok "Mod saved to $dest"
}

# ---- Run ----
if ! command -v jq >/dev/null 2>&1; then
  err "jq is required for mod lookups but was not found. Install it (e.g. apt install jq) and re-run."
  exit 1
fi

install_server

for spec in "${MODS[@]}"; do
  install_mod "$spec"
done

ok "Done"