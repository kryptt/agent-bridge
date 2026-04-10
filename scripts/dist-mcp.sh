#!/usr/bin/env bash
# Bundles @kryptt/mcp-server into a single self-standing Node.js executable.
#
# Usage:
#   ./scripts/dist-mcp.sh              # outputs to dist/agent-bridge-mcp
#   ./scripts/dist-mcp.sh /usr/local/bin/agent-bridge-mcp   # install directly
set -euo pipefail
cd "$(dirname "$0")/.."

DEST="${1:-dist/agent-bridge-mcp}"

echo "Building workspace (tsc -b)..."
npx tsc -b packages/agent-bus packages/mcp-server

echo "Bundling MCP server with esbuild..."
mkdir -p "$(dirname "$DEST")"
npx esbuild packages/mcp-server/dist/index.js \
  --bundle \
  --platform=node \
  --target=node20 \
  --format=esm \
  --banner:js='#!/usr/bin/env node' \
  --outfile="$DEST" \
  --sourcemap=linked \
  --minify-syntax

chmod +x "$DEST"
echo "MCP binary ready: $DEST"
echo "Install: sudo cp $DEST /usr/local/bin/agent-bridge-mcp"
