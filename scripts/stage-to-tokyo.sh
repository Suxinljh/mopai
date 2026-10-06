#!/usr/bin/env bash
# Stage a script onto cc-tokyo-01 with byte-exact LF endings.
#
# Run from WSL:  bash scripts/stage-to-tokyo.sh <windows-path> [remote-path]
#
# Windows -> WSL -> ssh keeps bytes intact; piping from PowerShell adds a CR to
# the final newline, which makes bash complain about $'\r'.
set -euo pipefail

SRC="$1"
REMOTE_PATH="${2:-/tmp/staged.sh}"

# Translate a Windows path (E:\a\b) into its /mnt/e/a/b form when needed.
case "$SRC" in
  [A-Za-z]:\\*)
    drive=$(printf '%s' "${SRC%%:*}" | tr 'A-Z' 'a-z')
    rest="${SRC#*:}"
    rest="${rest//\\//}"
    SRC="/mnt/$drive$rest"
    ;;
esac

echo "staging $SRC -> cc-tokyo-01:$REMOTE_PATH"
sshc() { ssh -o ConnectTimeout=20 -o BatchMode=yes cc-tokyo-01 "$@"; }

cat "$SRC" | sshc "cat > $REMOTE_PATH && chmod +x $REMOTE_PATH"
sshc "echo -n 'remote CR count: '; tr -cd '\r' < $REMOTE_PATH | wc -c; echo -n 'remote lines: '; wc -l < $REMOTE_PATH"
