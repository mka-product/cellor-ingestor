#!/usr/bin/env bash
set -euo pipefail

python3 -m venv .venv
. .venv/bin/activate
pip install -r api/requirements.txt -r worker/requirements.txt

if command -v npm >/dev/null 2>&1; then
  (cd web && npm install)
fi

echo "Bootstrap complete."
