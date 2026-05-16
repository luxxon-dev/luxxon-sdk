#!/usr/bin/env bash
# Build an MCPB bundle (.mcpb) for @luxxon/mcp.
#
# The MCPB format (spec: https://github.com/modelcontextprotocol/mcpb)
# wants a self-contained zip with server/, node_modules/, and a
# manifest.json — so this script stages a flat npm-installed tree
# (pnpm symlinks break extraction) and hands it to `mcpb pack`.
#
# Run from packages/mcp/. Output lands as ./luxxon-<version>.mcpb.
set -euo pipefail

PKG_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="$PKG_DIR/build"
SDK_VERSION="$(node -p "require('$PKG_DIR/package.json').dependencies['@luxxon/sdk']" | sed 's/workspace:\*/^0.1.0/')"
MCP_VERSION="$(node -p "require('$PKG_DIR/package.json').version")"

echo "→ building luxxon-${MCP_VERSION}.mcpb"

# Make sure dist/ is current.
( cd "$PKG_DIR" && pnpm build >/dev/null )

# Fresh staging.
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR/server"

# Entry point + assets.
cp "$PKG_DIR/dist/"*.js  "$BUILD_DIR/server/"
chmod +x "$BUILD_DIR/server/server.js"
cp "$PKG_DIR/README.md"      "$BUILD_DIR/README.md"
cp "$PKG_DIR/manifest.json"  "$BUILD_DIR/manifest.json"

# Standalone package.json — strip workspace: ref so npm can resolve.
cat > "$BUILD_DIR/package.json" <<EOF
{
  "name": "luxxon-mcp-bundle",
  "version": "${MCP_VERSION}",
  "description": "MCP server exposing Luxxon as agent-callable tools",
  "license": "MIT",
  "type": "module",
  "main": "server/server.js",
  "dependencies": {
    "@luxxon/sdk": "${SDK_VERSION}",
    "@modelcontextprotocol/sdk": "^1.0.0",
    "zod": "^3.23.0"
  },
  "engines": { "node": ">=18" }
}
EOF

# Flat npm install (pnpm hoisting confuses MCPB extraction).
( cd "$BUILD_DIR" && npm install --omit=dev --no-package-lock --silent )

# Pack manually as a plain zip — `mcpb pack` validates the manifest
# against Anthropic's strict schema (rejects `tools[].inputSchema`),
# but Smithery's deploy API *requires* inputSchema on every tool.
# The on-the-wire .mcpb is just a zip with manifest.json at the root,
# so either tool produces an archive Smithery accepts — using `zip`
# directly lets the richer Smithery-compatible manifest pass.
OUT="$PKG_DIR/luxxon-${MCP_VERSION}.mcpb"
rm -f "$OUT"
( cd "$BUILD_DIR" && zip -qr "$OUT" . )
echo "→ packed $(du -h "$OUT" | cut -f1) → $OUT"

echo "→ done: $PKG_DIR/luxxon-${MCP_VERSION}.mcpb"
