#!/usr/bin/env bash
# Reproduce the CI job locally against a clean checkout of a commit.
# Usage: scripts/preflight.sh [rev...]   (defaults to HEAD)
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
cd "$root"

fail() {
  echo "preflight: $*" >&2
  exit 1
}

# CI pins Node from .nvmrc and pnpm from packageManager; require the same here.
want_node="$(tr -d '[:space:]' < .nvmrc)"
have_node="$(node -v | sed 's/^v//')"
[ "$have_node" = "$want_node" ] ||
  fail "Node $have_node does not match .nvmrc $want_node (run: nvm use)"

want_pnpm="$(node -p 'require("./package.json").packageManager.split("@")[1]')"
have_pnpm="$(pnpm -v)"
[ "$have_pnpm" = "$want_pnpm" ] ||
  fail "pnpm $have_pnpm does not match packageManager $want_pnpm"

[ "$#" -gt 0 ] || set -- HEAD

for rev in "$@"; do
  sha="$(git rev-parse --verify "$rev^{commit}")"
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/ant-preflight.XXXXXX")"
  trap 'git -C "$root" worktree remove --force "$tmp" >/dev/null 2>&1 || true; rm -rf "$tmp"' EXIT

  echo "preflight: checking ${sha:0:7} in a clean checkout"
  git worktree add --quiet --detach "$tmp" "$sha"
  (
    cd "$tmp"
    export HUSKY=0 CI=true
    pnpm install --frozen-lockfile --reporter=silent ||
      fail "lockfile is out of date with package.json (run: pnpm install)"
    pnpm check
  ) || fail "${sha:0:7} would fail CI"

  git worktree remove --force "$tmp"
  trap - EXIT
done

echo "preflight: passed"
