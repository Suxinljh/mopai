#!/usr/bin/env bash
# Stage a script onto cc-tokyo-01 with byte-exact LF endings.
#
#   wsl -e bash scripts/stage-to-tokyo.sh <windows-or-wsl-path> [remote-path]
#
# Run it *inside* WSL (as above). Reading through WSL's /mnt keeps the bytes
# exactly as written; piping from PowerShell rewrites the final newline as CRLF
# and bash then fails on the last line with `$'\r': command not found`.
set -euo pipefail

SRC="$1"
REMOTE_PATH="${2:-/tmp/staged.sh}"

# Accept a Windows path (E:\a\b) and translate it to /mnt/e/a/b.
case "$SRC" in
  [A-Za-z]:\\*)
    drive=$(printf '%s' "${SRC%%:*}" | tr 'A-Z' 'a-z')
    rest="${SRC#*:}"
    rest="${rest//\\//}"
    SRC="/mnt/$drive$rest"
    ;;
esac

if [ ! -f "$SRC" ]; then
  echo "no such file: $SRC" >&2
  exit 1
fi

echo "staging $SRC -> cc-tokyo-01:$REMOTE_PATH"
cat "$SRC" | ssh -o ConnectTimeout=20 -o BatchMode=yes cc-tokyo-01 "cat > $REMOTE_PATH && chmod +x $REMOTE_PATH"
ssh -o ConnectTimeout=20 -o BatchMode=yes cc-tokyo-01 "printf '  remote: %s lines, %s CR\n' \"\$(wc -l < $REMOTE_PATH)\" \"\$(tr -cd '\r' < $REMOTE_PATH | wc -c)\""
