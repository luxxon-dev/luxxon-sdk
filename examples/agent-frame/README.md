# Example: fetch a frame from a LIVE session

Pulls the latest decoded JPEG from a Luxxon session and writes it
to disk. Demonstrates the *consumption* surface — the moat — in
its simplest form.

```bash
LUXXON_API_KEY=lxxn_test_... SESSION_ID=b1e2f3a4-... \
  pnpm --filter @luxxon-examples/agent-frame start
```

This is the same code path the [`@luxxon/mcp`](../../packages/mcp)
server's `get_frame` tool walks under the hood — when Claude
Desktop calls that tool, the JPEG goes straight back to the model
as an image content block.

## Pre-req: a LIVE session you can read

For now session creation requires the consumer wallet to sign an
EIP-712 Authorization (custodial-sign path lands on the API
side later). To get a LIVE session you can point at:

1. Open [docs.luxxon.dev](https://docs.luxxon.dev), follow the
   quickstart through `/sessions` → `/dispatch` → sign → `/authorize`
   → `/start`.
2. Have an operator publish to the WHIP URL `/start` returned.
3. Paste the session id into `SESSION_ID` above.

Or run against your own local lx-api dev server with
`LUXXON_API_URL=http://localhost:3010/api/v1`.
