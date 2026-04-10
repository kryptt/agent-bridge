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
  --format=cjs \
  --outfile="$DEST" \
  --minify-syntax

# Ensure shebang is present (esbuild may strip it from the entry point)
if ! head -1 "$DEST" | grep -q '^#!/'; then
  sed -i '1i#!/usr/bin/env node' "$DEST"
fi

chmod +x "$DEST"
echo "MCP binary ready: $DEST"
echo "Install: sudo cp $DEST /usr/local/bin/agent-bridge-mcp"
