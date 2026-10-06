#!/usr/bin/env bash
# Re-run every deployed-side check for 墨排.
set -uo pipefail
for s in server-acceptance-test.sh server-e2e-check.sh; do
  echo
  echo "################ ${s} ################"
  bash "/opt/mopai/scripts/${s}"
done