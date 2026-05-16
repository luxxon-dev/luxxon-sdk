# @luxxon/mcp

[MCP](https://modelcontextprotocol.io) server that exposes Luxxon
as agent-callable tools. Agents open live video sessions at any
lat/lng, fetch JPEG frames straight into a vision model, and read
on-chain settlement — without ever leaving the chat.

```bash
# Run on demand (no global install needed)
npx -y --package=@luxxon/mcp luxxon-mcp

# Or install globally and run by bin name
npm install -g @luxxon/mcp
luxxon-mcp
```

## Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`
(or `%APPDATA%\Claude\claude_desktop_config.json` on Windows):

```json
{
  "mcpServers": {
    "luxxon": {
      "command": "npx",
      "args": ["-y", "--package=@luxxon/mcp", "luxxon-mcp"],
      "env": {
        "LUXXON_API_KEY": "lxxn_test_..."
      }
    }
  }
}
```

Restart Claude. Ten tools appear under **Luxxon**:

| Tool | What it does |
|---|---|
| `request_live_view` | **Headline.** Open + dispatch + wait-for-LIVE in one call. Returns sessionId + whepUrl. |
| `get_session` | Read state + meter fields of a session. |
| `get_frame` | Latest decoded frame as a JPEG (LIVE only). Returned as an `image` content block — Claude sees it directly. |
| `get_stream_url` | WHEP playback URL for native WebRTC. |
| `end_session` | Close a LIVE session. Triggers on-chain settlement. |
| `cancel_session` | Cancel a pre-LIVE session. |
| `get_pricing_quote` | Estimate cost before opening — returns rate + total in µUSDC. |
| `get_coverage` | Anonymized live operator coverage map. Pre-flight check. |
| `get_wallet` | Workspace pool balance + last on-chain sync. |
| `get_settlement` | On-chain settlement state + tx hash after end_session. |

The vision-model integration "just works": when Claude calls
`get_frame`, the JPEG comes back as an `image` content block —
Claude sees it directly, no base64 plumbing on your side.

## Headline flow (`request_live_view`)

One tool call from prompt to LIVE session:

```
You: Look at lat 4.71, lng -74.05 for 30 seconds and tell me what's happening.

Claude calls request_live_view({ lat: 4.71, lng: -74.05, maxDurationSeconds: 30 })
  → Luxxon opens the session, dispatches an operator, waits for LIVE
  → returns { sessionId, whepUrl, hint: "call get_frame next" }

Claude calls get_frame({ sessionId })
  → JPEG returned inline; Claude sees the scene

Claude calls end_session({ sessionId })
  → relayer settles on-chain; tx hash available via get_settlement
```

## Cursor / other MCP clients

Same shape — wherever your MCP client expects a server stanza:

```json
{
  "command": "npx",
  "args": ["-y", "--package=@luxxon/mcp", "luxxon-mcp"],
  "env": { "LUXXON_API_KEY": "lxxn_test_..." }
}
```

## Local dev

```bash
git clone https://github.com/luxxon-dev/luxxon-sdk
cd luxxon-sdk
pnpm install
pnpm --filter @luxxon/mcp build
# Point your MCP client at the local build:
#   "command": "node",
#   "args": ["/abs/path/to/luxxon-sdk/packages/mcp/dist/server.js"]
```

Pass `LUXXON_API_URL=http://localhost:3010/api/v1` to hit a local
lx-api dev server instead of production.

## Roadmap

Tracked at [docs.luxxon.dev](https://docs.luxxon.dev). Near-term
additions when their API counterparts ship:

- `get_observation` — single-frame SKU (when the per-frame pricing
  path lands).
- Bounty tools (`create_bounty`, `get_bounty_status`) — pay-on-
  fulfillment for unsupported locations.

## Versioning

`v0.x` — the tool surface can change with minor bumps. The
underlying REST API is what's stable; this MCP is one of many
possible bindings (see `@luxxon/sdk` for the typed TS client).
