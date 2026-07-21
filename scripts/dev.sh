#!/usr/bin/env bash
# Build the client bundle, then serve the PWA and the API together from one origin.
set -euo pipefail

cd "$(dirname "$0")/.."

npm run build
exec npx wrangler dev --config worker/wrangler.toml "$@"
