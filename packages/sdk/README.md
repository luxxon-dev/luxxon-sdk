# @luxxon/sdk

TypeScript SDK for the [Luxxon API](https://docs.luxxon.dev). Pure
`fetch`, no native dependencies, ships ESM + types. Tracks the full
public REST surface.

```bash
npm install @luxxon/sdk
```

## Quick start

```ts
import { Luxxon } from "@luxxon/sdk";

const lx = new Luxxon({ apiKey: process.env.LUXXON_API_KEY });

// Open a session, push-dispatch an operator, wait for LIVE,
// and get a viewer URL in one call.
const { session, viewer } = await lx.requestLiveView({
  lat: 4.71, lng: -74.05,
  maxDurationSeconds: 30,
});

// Or grab a JPEG once the cache fills (~3-5s after LIVE).
const { bytes } = await lx.sessions.frame(session.id);

// Tear it down whenever — your call.
await lx.sessions.end(session.id);
```

## Auth

API key (server-side), wallet session cookie (browser), or a
pre-formatted bearer header:

```ts
new Luxxon({ apiKey: "lxxn_live_..." });
new Luxxon({ bearer: "Bearer lxxn_live_..." });
new Luxxon({ cookie: "lx_session=eyJ..." });   // browser / SSR
```

## Surface

11 resources covering every public path on `api.luxxon.dev/api/v1`:

| Resource | Methods |
|---|---|
| `lx.auth` | `challenge / login / selectWorkspace / logout` |
| `lx.me` | `get` |
| `lx.config` | `get` |
| `lx.health` | `get` |
| `lx.coverage` | `list` |
| `lx.demand` | `heatmap` |
| `lx.pricing` | `quote` |
| `lx.workspaces` | `challenge / create / list / get / update / setAvailability / heartbeat / createApiKey / revokeApiKey` |
| `lx.sessions` | `create / get / dispatch / accept / start / end / cancel / frame / viewerToken / producerToken / waitFor` |
| `lx.wallet` | `get / events` |
| `lx.settlements` | `get` |

Plus one high-level convenience at the top level:

- `lx.requestLiveView({ lat, lng, maxDurationSeconds })` → orchestrates
  `create + dispatch + waitFor(LIVE) + viewerToken` in one call.

For anything not exposed yet, drop to the escape hatch:

```ts
const data = await lx.json("/some-new-endpoint");
const res  = await lx.raw("/some-new-endpoint", { method: "POST", body });
```

## Patterns

**Lifecycle, manual:**

```ts
const s = await lx.sessions.create({ lat, lng, maxDurationSeconds: 60 });
await lx.sessions.dispatch(s.id);  // 503 NO_COVERAGE if no operator in range
const live = await lx.sessions.waitFor(s.id, (x) => x.state === "LIVE");
// … poll frames or hand `live.whepUrl` to a WebRTC player …
await lx.sessions.end(s.id);
```

**Quote first, lock the rate:**

```ts
const quote = await lx.pricing.quote({ lat: 4.71, lng: -74.05, durationSeconds: 30 });
const s     = await lx.sessions.create({ lat: 4.71, lng: -74.05, maxDurationSeconds: 30, quoteId: quote.quoteId });
```

**Wallet inspection:**

```ts
const state  = await lx.wallet.get();              // tracked balance + last block
const events = await lx.wallet.events({ limit: 50 }); // deposits / settles / approvals
```

**Settlement check after a session ends:**

```ts
const settle = await lx.settlements.get(sessionId);
// settle.state: NOT_READY | PENDING | SUBMITTED | CONFIRMED
// settle.txHash when state === CONFIRMED
```

**Operator side — accept + start + heartbeat:**

```ts
await lx.workspaces.setAvailability(workspaceId, "ONLINE");
await lx.sessions.accept(sessionId);
const { whipUrl } = await lx.sessions.start(sessionId);
// Publish via WHIP; keep heartbeating while you stream.
await lx.workspaces.heartbeat(workspaceId, {
  lat, lng, accuracyMeters: 8, sequence: Date.now(),
});
```

## Errors

Typed errors with a stable `code` per the
[error reference](https://docs.luxxon.dev/concepts/conventions):

```ts
import type { LuxxonError } from "@luxxon/sdk";

try {
  await lx.sessions.frame(id);
} catch (err) {
  const e = err as LuxxonError;
  if (e.code === "FRAME_NOT_AVAILABLE") {
    // First keyframe hasn't arrived — retry in 1s.
  } else if (e.code === "NO_COVERAGE") {
    // Dispatch found no operator in range.
  } else {
    throw err;
  }
}
```

Common codes: `NOT_AUTHENTICATED`, `NOT_AUTHORIZED`, `INVALID_INPUT`,
`INVALID_STATE`, `NOT_FOUND`, `NO_COVERAGE`, `FRAME_NOT_AVAILABLE`,
`CONFLICT`, `AUTHZ_ERROR`, `DATABASE_ERROR`.

## Stability

`v0.x` — minor versions can change the typed surface. Pin exact
version until 1.0. The underlying REST API is what's stable; this
SDK is one of many possible bindings.

## MCP

The MCP server in [`@luxxon/mcp`](../mcp) wraps this SDK as
agent-callable tools for Claude Desktop / Cursor / Claude Code.
