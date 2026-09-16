#!/usr/bin/env bash
# Bearing — starts the local program and opens the dashboard in your browser.
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Get it from https://nodejs.org (version 22 or newer)."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "First run — installing dependencies. This happens once."
  npm install
fi

npm start
