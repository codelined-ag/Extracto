#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${EXTRACTO_REPO_URL:-https://github.com/codelined-ag/Extracto.git}"
REPO_REF="${EXTRACTO_REPO_REF:-v0.7.0}"
INSTALL_DIR="${EXTRACTO_INSTALL_DIR:-$HOME/.local/share/extracto}"
AUTOSTART="${EXTRACTO_AUTOSTART:-1}"

case "$REPO_URL" in
  https://*) : ;;
  *) printf "✖ EXTRACTO_REPO_URL must be https:// (got %s)\n" "$REPO_URL" >&2; exit 1 ;;
esac

if [ -t 1 ]; then
  C_RESET=$'\033[0m'; C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_BLUE=$'\033[34m'
else
  C_RESET=""; C_RED=""; C_GREEN=""; C_BLUE=""
fi

die() { printf "%s✖%s %s\n" "$C_RED" "$C_RESET" "$*" >&2; exit 1; }
info() { printf "%s•%s %s\n" "$C_BLUE" "$C_RESET" "$*"; }
ok()  { printf "%s✔%s %s\n" "$C_GREEN" "$C_RESET" "$*"; }

case "$(uname -s 2>/dev/null)" in
  Linux|Darwin) : ;;
  *) die "Unsupported OS. Use scripts/install.ps1 on Windows." ;;
esac

if ! command -v git >/dev/null 2>&1; then
  die "git is required. Install it (e.g. apt install git, brew install git) and re-run."
fi

mkdir -p "$(dirname "$INSTALL_DIR")"

info "Plan: clone $REPO_URL @ $REPO_REF -> $INSTALL_DIR (Ctrl-C within 3s to abort)"
sleep 3 || true

if [ -d "$INSTALL_DIR/.git" ]; then
  info "Updating Extracto checkout at $INSTALL_DIR"
  git -C "$INSTALL_DIR" fetch --depth 1 origin "$REPO_REF"
  git -C "$INSTALL_DIR" reset --hard "FETCH_HEAD"
else
  info "Cloning $REPO_URL @ $REPO_REF -> $INSTALL_DIR"
  staging="${INSTALL_DIR}.partial.$$"
  trap 'rm -rf "$staging"' EXIT
  git clone --depth 1 --branch "$REPO_REF" "$REPO_URL" "$staging"
  mv "$staging" "$INSTALL_DIR"
  trap - EXIT
fi

cd "$INSTALL_DIR"
[ -x "./install-extracto.sh" ] || chmod +x ./install-extracto.sh
./install-extracto.sh

ok "Extracto installed at $INSTALL_DIR"

if [ "$AUTOSTART" = "1" ] && command -v extracto >/dev/null 2>&1; then
  info "Starting Extracto..."
  extracto on || true
else
  info "Run 'extracto on' to start. Open http://localhost:3000 to sign up."
fi
