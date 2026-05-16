# Luxxon — TypeScript SDK + MCP server

Programmable vision for AI agents. Request live video or single
frames from real-world locations, settled on-chain in USDC.

This repo contains:

| Package | Purpose |
|---|---|
| [`packages/sdk`](./packages/sdk) | TypeScript HTTP client for the Luxxon API. Pure `fetch`, no native deps. |
| [`packages/mcp`](./packages/mcp) | MCP server exposing Luxxon as agent-callable tools (stdio transport, works with Claude Desktop / Cursor / any MCP client). |
| [`examples/`](./examples) | Runnable agent examples — copy, paste, run. |

API: [docs.luxxon.dev](https://docs.luxxon.dev) — `https://api.luxxon.dev/api/v1`.

## Why an MCP server

Agents have `fetch()`, not `<video>` tags. The MCP server turns Luxxon
into a set of tools any MCP-aware agent can call directly:

- `get_frame(sessionId)` → JPEG bytes ready for a vision model
- `get_session(sessionId)` → current state of a live session
- `cancel_session(sessionId)` → early termination

Drop the server into your Claude Desktop config and your agent can
see the world.

## Quickstart — TypeScript SDK

```ts
import { Luxxon } from "@luxxon/sdk";

const lx = new Luxxon({ apiKey: process.env.LUXXON_API_KEY });

// Read the latest frame from a LIVE session (returns a Buffer).
const jpeg = await lx.sessions.frame("sess_abc123");
```

## Quickstart — MCP server

```json
// ~/Library/Application Support/Claude/claude_desktop_config.json
{
  "mcpServers": {
    "luxxon": {
      "command": "npx",
      "args": ["-y", "--package=@luxxon/mcp", "luxxon-mcp"],
      "env": { "LUXXON_API_KEY": "lxxn_live_..." }
    }
  }
}
```

Restart Claude Desktop; the three tools appear under "Luxxon".

## Status

**v0**, building in public. The SDK + MCP cover the agent-read
surface today (frames, session state, cancel). Session *creation*
lands behind a custodial-wallet sign path that's still being
built on the API side — for now you create sessions yourself via
the REST API and use this SDK/MCP to consume them.

Public dev console + Python/Go/CLI SDKs follow. Watch this repo.
