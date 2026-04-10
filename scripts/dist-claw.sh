#!/usr/bin/env bash
# Builds @kryptt/openclaw-plugin into a self-contained OpenClaw extension folder.
#
# Usage:
#   ./scripts/dist-claw.sh /path/to/dest
#
# The destination folder will contain everything OpenClaw needs to load the plugin:
#   src/           — plugin TypeScript source (loaded by OpenClaw runtime)
#   package.json   — package metadata
#   tsconfig.json  — TypeScript config for the plugin
#   openclaw.plugin.json — plugin manifest for OpenClaw loader
#   node_modules/  — all runtime dependencies pre-installed
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

DEST="${1:?Usage: dist-claw.sh <destination-folder>}"

echo "Building agent-bus (tsc -b)..."
npx tsc -b packages/agent-bus

echo "Staging openclaw-plugin to $DEST..."
rm -rf "$DEST"
mkdir -p "$DEST"

# Copy plugin source and configs
cp -r packages/openclaw-plugin/src "$DEST/src"
cp packages/openclaw-plugin/tsconfig.json "$DEST/tsconfig.json"

# Generate plugin manifest for OpenClaw loader
cat > "$DEST/openclaw.plugin.json" << 'EOF'
{
  "id": "openclaw-mqtt-plugin",
  "kind": "integration",
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "mqttUrl": { "type": "string" },
      "mqttUser": { "type": "string" },
      "mqttPass": { "type": "string" }
    }
  }
}
EOF

# Build a standalone package.json with all transitive runtime deps flattened
# (agent-bus is staged manually, so only its external deps need to be here)
node -e "
  const bus = require('$ROOT/packages/agent-bus/package.json');
  const plugin = require('$ROOT/packages/openclaw-plugin/package.json');
  const deps = { ...bus.dependencies, ...plugin.dependencies };
  delete deps['@kryptt/agent-bus'];
  const out = { ...plugin, dependencies: deps };
  require('fs').writeFileSync('$DEST/package.json', JSON.stringify(out, null, 2) + '\n');
"

# Install all external production deps (effect, mqtt, zod) at top level
cd "$DEST"
npm install --omit=dev 2>&1 | tail -3

# Restore original package.json
cp "$ROOT/packages/openclaw-plugin/package.json" "$DEST/package.json"

# Stage @kryptt/agent-bus as a local package (after npm install so it isn't clobbered)
mkdir -p "$DEST/node_modules/@kryptt/agent-bus"
cp "$ROOT/packages/agent-bus/package.json" "$DEST/node_modules/@kryptt/agent-bus/package.json"
cp -r "$ROOT/packages/agent-bus/dist" "$DEST/node_modules/@kryptt/agent-bus/dist"

# Fix tsconfig to not reference agent-bus (standalone, no project refs)
node -e "
  const ts = require('$DEST/tsconfig.json');
  delete ts.references;
  require('fs').writeFileSync('$DEST/tsconfig.json', JSON.stringify(ts, null, 2) + '\n');
"

echo "OpenClaw plugin staged at $DEST"
