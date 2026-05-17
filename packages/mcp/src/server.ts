#!/usr/bin/env node
// Luxxon MCP server — exposes Luxxon as agent-callable tools.
//
// Transport: stdio. Drop into a Claude Desktop / Cursor / Claude
// Code config and the tools appear under "Luxxon". Hosted (HTTP/SSE)
// transport is the v0.3 plan once we know which agent frameworks
// need it.
//
// Tool surface (v0.2):
//   - request_live_view       → open + dispatch + wait-for-LIVE
//                              (headline; one tool call → live session)
//   - wait_for_live           → keep waiting on a known sessionId
//                              that hasn't reached LIVE yet
//   - list_sessions           → enumerate workspace sessions (recovery)
//   - get_session             → state + meter fields
//   - get_frame               → latest JPEG, returned as image content
//   - get_stream_url          → WHEP URL for native WebRTC consumers
//   - end_session             → close a LIVE session
//   - cancel_session          → terminate a pre-LIVE session
//   - get_pricing_quote       → estimate cost before opening
//   - get_coverage            → public list of live operator coverage circles
//   - get_wallet              → workspace pool balance + last sync
//   - get_settlement          → on-chain tx info for a session post-end

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { Luxxon, type LuxxonError } from "@luxxon/sdk";

// ── env + client ──────────────────────────────────────────────────────────
// Lazy-validate the API key. Catalog introspection (Glama, mcp.so,
// Smithery) starts the server without env vars to call
// `tools/list` and read the static schema; hard-exiting at
// startup blocked the listing. We let the server boot regardless;
// each tool handler checks `luxxon` and returns a clear error if
// the user hasn't set LUXXON_API_KEY.
const API_KEY = process.env.LUXXON_API_KEY;
const BASE_URL = process.env.LUXXON_API_URL;
const luxxon: Luxxon | null = API_KEY
  ? new Luxxon({
      apiKey: API_KEY,
      ...(BASE_URL ? { baseUrl: BASE_URL } : {}),
    })
  : null;

const NO_API_KEY_HINT =
  "LUXXON_API_KEY is not set. Mint one at https://console.luxxon.dev and pass it via the MCP client's env config (e.g. claude_desktop_config.json → mcpServers.luxxon.env.LUXXON_API_KEY).";

// ── tool schemas ─────────────────────────────────────────────────────────
const SessionIdArg = z.object({
  sessionId: z.string().describe("UUID of the Luxxon session"),
});

const RequestLiveViewArg = z.object({
  lat: z
    .number()
    .describe("WGS84 latitude of the point to observe (decimal degrees)"),
  lng: z
    .number()
    .describe("WGS84 longitude of the point to observe (decimal degrees)"),
  maxDurationSeconds: z
    .number()
    .describe(
      "Upper bound on session length, in seconds. The meter stops at /end or this duration, whichever is first.",
    ),
  waitTimeoutSeconds: z
    .number()
    .optional()
    .describe(
      "Seconds to wait for an operator to start streaming before the session expires without a meter. Independent of maxDurationSeconds (which only bounds the LIVE meter). Server clamps to [5, 3600]; default 300.",
    ),
  quoteId: z
    .string()
    .optional()
    .describe(
      "Optional quoteId from get_pricing_quote to lock the rate. Without it, the spot rate at create-time is used.",
    ),
  timeoutMs: z
    .number()
    .optional()
    .describe(
      "Max time to wait for the operator to go LIVE (ms). Default 30000. If the operator hasn't gone LIVE by then, returns the sessionId + current state instead of erroring — use wait_for_live to keep waiting or cancel_session to give up.",
    ),
});

const WaitForLiveArg = z.object({
  sessionId: z
    .string()
    .describe(
      "UUID of an existing session (REQUESTED or ASSIGNED) to wait on.",
    ),
  timeoutMs: z
    .number()
    .optional()
    .describe(
      "Max additional wait time in ms. Default 30000. Returns the current state + sessionId if the operator still hasn't gone LIVE — call again to keep waiting, or cancel_session.",
    ),
});

const PricingQuoteArg = z.object({
  lat: z.number().describe("WGS84 latitude (decimal degrees)"),
  lng: z.number().describe("WGS84 longitude (decimal degrees)"),
  durationSeconds: z
    .number()
    .describe("Intended session length in seconds — drives the total estimate."),
});

const NoArgs = z.object({});

const tools = [
  {
    name: "request_live_view",
    description:
      "Open a Luxxon session at a lat/lng, push-dispatch the longest-idle operator in range, and wait for the operator to go LIVE. Returns the sessionId either way: if LIVE within timeoutMs, the response includes whepUrl + a hint to call get_frame; if still ASSIGNED/REQUESTED after timeoutMs, the response includes the sessionId + current state + a hint to call wait_for_live or cancel_session. Only NO_COVERAGE (no operator in range at dispatch time) errors hard. Charges the workspace's pool per second of LIVE time at session end.",
    inputSchema: RequestLiveViewArg,
  },
  {
    name: "wait_for_live",
    description:
      "Continue waiting on an existing session (REQUESTED or ASSIGNED) until it reaches LIVE. Use this after request_live_view returned with state≠LIVE, or after re-discovering a sessionId via list_sessions. Returns whepUrl on success. If the operator still hasn't gone LIVE within timeoutMs, returns the current state + sessionId so you can call again or cancel_session.",
    inputSchema: WaitForLiveArg,
  },
  {
    name: "list_sessions",
    description:
      "List sessions in the caller's workspace, newest first. Useful for recovering a sessionId when a previous request_live_view returned without one, or for auditing recent activity. Filter client-side by state (REQUESTED, ASSIGNED, LIVE, ENDED, EXPIRED, CANCELLED).",
    inputSchema: NoArgs,
  },
  {
    name: "get_session",
    description:
      "Read the current state of a Luxxon session (REQUESTED, ASSIGNED, LIVE, ENDED, etc.) plus meter fields (cleanSeconds, chargedMicroUsdc, settlementTxHash).",
    inputSchema: SessionIdArg,
  },
  {
    name: "get_frame",
    description:
      "Fetch the latest decoded video frame from a LIVE Luxxon session as a JPEG image. Hand the returned image straight to a vision model. Returns FRAME_NOT_AVAILABLE for ~3-5s after a session goes LIVE while the first keyframe arrives — retry if you hit that.",
    inputSchema: SessionIdArg,
  },
  {
    name: "get_stream_url",
    description:
      "Return a WHEP playback URL for a LIVE session. For agents with their own WebRTC stack; most agents should prefer get_frame instead.",
    inputSchema: SessionIdArg,
  },
  {
    name: "end_session",
    description:
      "End a LIVE Luxxon session. Closes the meter; computes cleanSeconds; the relayer settles on-chain shortly after. For pre-LIVE sessions use cancel_session instead.",
    inputSchema: SessionIdArg,
  },
  {
    name: "cancel_session",
    description:
      "Cancel a pre-LIVE Luxxon session (REQUESTED or ASSIGNED). For LIVE sessions use end_session — this one will error with INVALID_STATE.",
    inputSchema: SessionIdArg,
  },
  {
    name: "get_pricing_quote",
    description:
      "Get a price quote for a session at a lat/lng + duration. Returns a quoteId, rate per second, and an estimated total — all in µUSDC (1 USDC = 1,000,000 µUSDC). Optional input for request_live_view to lock the rate.",
    inputSchema: PricingQuoteArg,
  },
  {
    name: "get_coverage",
    description:
      "Public list of live operator coverage circles (centroid + radius + device kind). Anonymized — no operator ids. Useful as a pre-flight check before request_live_view.",
    inputSchema: NoArgs,
  },
  {
    name: "get_wallet",
    description:
      "Workspace pool balance + last on-chain sync block. Use to decide whether to top up before a session.",
    inputSchema: NoArgs,
  },
  {
    name: "get_settlement",
    description:
      "On-chain settlement state + tx hash for a session after end_session. State machine: NOT_READY → PENDING → SUBMITTED → CONFIRMED. txHash is set once SUBMITTED.",
    inputSchema: SessionIdArg,
  },
] as const;

// ── server setup ─────────────────────────────────────────────────────────
const server = new Server(
  {
    name: "luxxon",
    version: "0.2.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: zodToJsonSchema(t.inputSchema),
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  if (!luxxon) {
    return {
      isError: true,
      content: [{ type: "text", text: NO_API_KEY_HINT }],
    };
  }
  try {
    switch (name) {
      case "request_live_view": {
        const input = RequestLiveViewArg.parse(args);
        const timeoutMs = input.timeoutMs ?? 30_000;

        // Inlined create + dispatch + waitFor (instead of
        // luxxon.requestLiveView) so we keep the sessionId locally
        // and can surface it to the agent on a wait-for-LIVE
        // timeout. Otherwise the throw inside waitFor loses the
        // sessionId and the agent has no way to recover.
        const created = await luxxon.sessions.create({
          lat: input.lat,
          lng: input.lng,
          maxDurationSeconds: input.maxDurationSeconds,
          ...(input.waitTimeoutSeconds !== undefined
            ? { waitTimeoutSeconds: input.waitTimeoutSeconds }
            : {}),
          ...(input.quoteId ? { quoteId: input.quoteId } : {}),
        });

        try {
          await luxxon.sessions.dispatch(created.id);
        } catch (err) {
          // Dispatch failed (typically NO_COVERAGE). Surface the
          // sessionId so the agent can cancel cleanly rather than
          // leaking a REQUESTED session into the workspace.
          const e = err as LuxxonError;
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    sessionId: created.id,
                    state: created.state,
                    error: e.code ?? "DISPATCH_FAILED",
                    message: e.message ?? (err as Error).message,
                    detail: e.detail,
                    hint: `Dispatch failed. Call cancel_session("${created.id}") to release the REQUESTED session.`,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        try {
          const live = await luxxon.sessions.waitFor(
            created.id,
            (s) => s.state === "LIVE",
            { timeoutMs },
          );
          const viewer = await luxxon.sessions.viewerToken(live.id);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    sessionId: live.id,
                    state: live.state,
                    operatorWorkspaceId: live.operatorWorkspaceId,
                    whepUrl: viewer.whepUrl,
                    startedAt: live.startedAt,
                    hint: "Session is LIVE. Call get_frame in ~3-5s for the first decoded JPEG, or open whepUrl in a WebRTC player. Call end_session to close.",
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        } catch (err) {
          // Operator hasn't gone LIVE in time (TIMEOUT) or the
          // session reached a terminal state (INVALID_STATE). Either
          // way, return the sessionId + current state so the agent
          // can decide: wait_for_live again, or cancel_session.
          const e = err as LuxxonError;
          const current = await luxxon.sessions
            .get(created.id)
            .catch(() => null);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    sessionId: created.id,
                    state: current?.state ?? "UNKNOWN",
                    operatorWorkspaceId: current?.operatorWorkspaceId,
                    waitOutcome: e.code ?? "TIMEOUT",
                    waitMessage: e.message ?? (err as Error).message,
                    hint: `Operator hasn't gone LIVE (state=${current?.state ?? "unknown"}). Call wait_for_live("${created.id}") to keep waiting, or cancel_session("${created.id}") to give up.`,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }
      }

      case "wait_for_live": {
        const input = WaitForLiveArg.parse(args);
        const timeoutMs = input.timeoutMs ?? 30_000;
        try {
          const live = await luxxon.sessions.waitFor(
            input.sessionId,
            (s) => s.state === "LIVE",
            { timeoutMs },
          );
          const viewer = await luxxon.sessions.viewerToken(live.id);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    sessionId: live.id,
                    state: live.state,
                    operatorWorkspaceId: live.operatorWorkspaceId,
                    whepUrl: viewer.whepUrl,
                    startedAt: live.startedAt,
                    hint: "Session is LIVE. Call get_frame in ~3-5s for the first decoded JPEG.",
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        } catch (err) {
          const e = err as LuxxonError;
          const current = await luxxon.sessions
            .get(input.sessionId)
            .catch(() => null);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    sessionId: input.sessionId,
                    state: current?.state ?? "UNKNOWN",
                    waitOutcome: e.code ?? "TIMEOUT",
                    waitMessage: e.message ?? (err as Error).message,
                    hint: `Still not LIVE (state=${current?.state ?? "unknown"}). Call wait_for_live again to keep waiting, or cancel_session to give up.`,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }
      }

      case "list_sessions": {
        NoArgs.parse(args ?? {});
        const sessions = await luxxon.sessions.list();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { count: sessions.length, sessions },
                null,
                2,
              ),
            },
          ],
        };
      }

      case "get_session": {
        const { sessionId } = SessionIdArg.parse(args);
        const session = await luxxon.sessions.get(sessionId);
        return {
          content: [
            { type: "text", text: JSON.stringify(session, null, 2) },
          ],
        };
      }

      case "get_frame": {
        const { sessionId } = SessionIdArg.parse(args);
        const frame = await luxxon.sessions.frame(sessionId);
        return {
          content: [
            {
              type: "image",
              data: Buffer.from(frame.bytes).toString("base64"),
              mimeType: frame.contentType,
            },
          ],
        };
      }

      case "get_stream_url": {
        const { sessionId } = SessionIdArg.parse(args);
        const token = await luxxon.sessions.viewerToken(sessionId);
        return {
          content: [
            { type: "text", text: JSON.stringify(token, null, 2) },
          ],
        };
      }

      case "end_session": {
        const { sessionId } = SessionIdArg.parse(args);
        const session = await luxxon.sessions.end(sessionId);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  sessionId: session.id,
                  state: session.state,
                  cleanSeconds: session.cleanSeconds,
                  chargedMicroUsdc: session.chargedMicroUsdc,
                  settlementTxHash: session.settlementTxHash,
                  hint: "Meter is closed. Poll get_settlement to watch the on-chain settle reach CONFIRMED.",
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      case "cancel_session": {
        const { sessionId } = SessionIdArg.parse(args);
        const session = await luxxon.sessions.cancel(sessionId);
        return {
          content: [
            { type: "text", text: `Cancelled. New state: ${session.state}` },
          ],
        };
      }

      case "get_pricing_quote": {
        const input = PricingQuoteArg.parse(args);
        const quote = await luxxon.pricing.quote(input);
        return {
          content: [
            { type: "text", text: JSON.stringify(quote, null, 2) },
          ],
        };
      }

      case "get_coverage": {
        NoArgs.parse(args ?? {});
        const list = await luxxon.coverage.list();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { count: list.length, coverage: list },
                null,
                2,
              ),
            },
          ],
        };
      }

      case "get_wallet": {
        NoArgs.parse(args ?? {});
        const wallet = await luxxon.wallet.get();
        return {
          content: [
            { type: "text", text: JSON.stringify(wallet, null, 2) },
          ],
        };
      }

      case "get_settlement": {
        const { sessionId } = SessionIdArg.parse(args);
        const settlement = await luxxon.settlements.get(sessionId);
        return {
          content: [
            { type: "text", text: JSON.stringify(settlement, null, 2) },
          ],
        };
      }

      default:
        return {
          isError: true,
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
        };
    }
  } catch (err) {
    const e = err as Partial<LuxxonError> & Error;

    // SDK already attached structured fields (`code`, `status`,
    // `detail`, `raw`). The previous formatter built `${code}
    // (${status}): ${message}` — but for SDK-thrown errors where
    // `message` defaults to `${code} (${status})` the result is a
    // doubled string. Return a structured JSON payload instead so
    // the model can read individual fields without us guessing the
    // right human format.
    if (e.code) {
      const status = e.status ?? 0;
      const retryable =
        status === 408 ||
        status === 429 ||
        (status >= 500 && status < 600) ||
        e.code === "INVALID_RESPONSE" ||
        e.code === "EXTERNAL_ERROR";
      // For non-JSON upstream bodies (gateway 502/503/504 HTML
      // from CloudFront, ALB, nginx), `raw` carries the actual
      // text. Truncate so it doesn't blow up the tool response.
      const upstreamSnippet =
        e.raw && e.raw.length > 0
          ? e.raw.slice(0, 240).replace(/\s+/g, " ").trim()
          : undefined;
      // Avoid the `${code} (${status})` boilerplate the SDK adds
      // when no real message was provided.
      const synthesizedMessage = `${e.code} (${status})`;
      const message =
        e.message && e.message !== synthesizedMessage
          ? e.message
          : undefined;
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                code: e.code,
                status,
                ...(message ? { message } : {}),
                ...(e.detail ? { detail: e.detail } : {}),
                retryable,
                ...(upstreamSnippet ? { upstream: upstreamSnippet } : {}),
              },
              null,
              2,
            ),
          },
        ],
      };
    }
    return {
      isError: true,
      content: [{ type: "text", text: e.message ?? String(err) }],
    };
  }
});

// Minimal zod → JSON-Schema. The MCP SDK accepts JSON-Schema for
// `inputSchema`; we use Zod for runtime validation + this thin
// converter for the wire format. Covers object, string, number,
// and optional wrappers — enough for the current tool surface.
//
// Uses only Zod's public accessors (`.shape`, `.description`,
// `.unwrap()`, `.isOptional()`) — not `_def.*` — because Zod 4
// reshaped the internals: `_def.shape` is no longer a function and
// `_def.description` no longer exists at runtime. Sticking to the
// public surface keeps this compatible with both Zod 3 and 4.
function zodToJsonSchema(
  schema: z.ZodTypeAny,
): Record<string, unknown> {
  if (schema instanceof z.ZodOptional) {
    // Zod 4 narrows `.unwrap()`'s return to the internal `$ZodType`
    // which isn't directly assignable to the public `ZodTypeAny`.
    // Cast — runtime instance is still the same.
    const inner = zodToJsonSchema(schema.unwrap() as z.ZodTypeAny);
    // .describe() on the outer .optional() lands on the wrapper, not
    // the inner type. Propagate it so JSON-schema callers see the doc.
    const outerDesc = schema.description;
    if (outerDesc && !inner.description) inner.description = outerDesc;
    return inner;
  }
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(value);
      if (!value.isOptional()) required.push(key);
    }
    return {
      type: "object",
      properties,
      ...(required.length ? { required } : {}),
    };
  }
  if (schema instanceof z.ZodString) {
    const out: Record<string, unknown> = { type: "string" };
    const description = schema.description;
    if (description) out.description = description;
    return out;
  }
  if (schema instanceof z.ZodNumber) {
    const out: Record<string, unknown> = { type: "number" };
    const description = schema.description;
    if (description) out.description = description;
    return out;
  }
  // Fallback — should be rare. Everything in our schemas above is
  // covered explicitly.
  return { type: "string" };
}

// ── go ──────────────────────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // eslint-disable-next-line no-console
  console.error("luxxon-mcp: ready");
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("luxxon-mcp: fatal", err);
  process.exit(1);
});
