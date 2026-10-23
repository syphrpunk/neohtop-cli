#!/bin/sh
# st — sloppytop from this checkout (the TypeScript CLI).
# ./sloppytop is the same command. The Go TUI remains ./sloppytop-cli.

set -eu

source=$0
while [ -L "$source" ]; do
  linkdir=$(CDPATH= cd -- "$(dirname -- "$source")" && pwd)
  target=$(readlink "$source")
  case $target in
    /*) source=$target ;;
    *) source=$linkdir/$target ;;
  esac
done
root=$(CDPATH= cd -- "$(dirname -- "$source")" && pwd)
entry=$root/ts/src/index.ts

if [ ! -f "$entry" ]; then
  echo "st: missing $entry" >&2
  exit 1
fi

if command -v bun >/dev/null 2>&1; then
  exec bun "$entry" "$@"
fi
if command -v mise >/dev/null 2>&1; then
  exec mise exec -- bun "$entry" "$@"
fi

echo "st: bun is not on PATH. From this repo, run: mise install" >&2
exit 127
