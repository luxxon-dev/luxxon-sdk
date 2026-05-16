import { type LuxxonError, makeLuxxonError } from "./errors.js";
import type {
  AcceptSessionInput,
  ApiKey,
  ApiKeyCreated,
  AvailabilityState,
  ChallengeResponse,
  Config,
  CoverageEntry,
  CreateApiKeyInput,
  CreateSessionInput,
  CreateWorkspaceInput,
  DemandCell,
  Frame,
  Health,
  LocationHeartbeatInput,
  Me,
  OnChainEvent,
  PriceQuote,
  PricingQuoteInput,
  ProducerToken,
  SelectWorkspaceInput,
  SelectWorkspaceResponse,
  Session,
  SessionCancelAllResult,
  SessionStarted,
  SettlementView,
  ViewerToken,
  WalletEventsInput,
  WalletLoginInput,
  WalletLoginResponse,
  WalletState,
  Workspace,
  WorkspaceCreated,
  UpdateWorkspaceInput,
} from "./types.js";

const DEFAULT_BASE_URL = "https://api.luxxon.dev/api/v1";

export interface LuxxonOptions {
  /** `lxxn_live_*` or `lxxn_test_*`. Required unless `bearer` or `cookie` is provided. */
  apiKey?: string;
  /** Pre-formatted `Authorization: Bearer …` value. Overrides apiKey. */
  bearer?: string;
  /** Wallet-session cookie value (`lx_session=…`). Use this for browser callers; mutually exclusive with apiKey. */
  cookie?: string;
  /** Override the API origin + version path. Default: production. */
  baseUrl?: string;
  /** Override the `fetch` implementation (testing). */
  fetch?: typeof fetch;
  /** Optional default `X-Lx-Consistency-Token`. Most callers don't need this. */
  consistencyToken?: string;
}

/**
 * Luxxon API client. One instance per workspace API key.
 *
 * ```ts
 * const lx = new Luxxon({ apiKey: process.env.LUXXON_API_KEY });
 *
 * // High-level: open a session, wait for LIVE, get a frame.
 * const { session, frame } = await lx.requestLiveView({
 *   lat: 4.71, lng: -74.05, maxDurationSeconds: 30,
 * });
 *
 * // Or step-by-step:
 * const created = await lx.sessions.create({ lat: 4.71, lng: -74.05, maxDurationSeconds: 30 });
 * await lx.sessions.dispatch(created.id);
 * const live = await lx.sessions.waitFor(created.id, (s) => s.state === "LIVE");
 * const jpeg = await lx.sessions.frame(live.id);
 * ```
 */
export class Luxxon {
  readonly baseUrl: string;

  readonly auth: AuthResource;
  readonly me: MeResource;
  readonly config: ConfigResource;
  readonly health: HealthResource;
  readonly coverage: CoverageResource;
  readonly demand: DemandResource;
  readonly workspaces: WorkspacesResource;
  readonly pricing: PricingResource;
  readonly sessions: SessionsResource;
  readonly wallet: WalletResource;
  readonly settlements: SettlementsResource;

  private readonly authHeader: string | null;
  private readonly cookieHeader: string | null;
  private readonly fetchImpl: typeof fetch;
  private consistencyToken: string | null;

  constructor(options: LuxxonOptions = {}) {
    const hasAuth = options.apiKey || options.bearer || options.cookie;
    if (!hasAuth) {
      throw new Error(
        "Luxxon: pass `apiKey`, `bearer`, or `cookie` (set LUXXON_API_KEY in env for the simplest case).",
      );
    }
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.authHeader = options.bearer ?? (options.apiKey ? `Bearer ${options.apiKey}` : null);
    this.cookieHeader = options.cookie ? formatCookieHeader(options.cookie) : null;
    this.consistencyToken = options.consistencyToken ?? null;

    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (!this.fetchImpl) {
      throw new Error(
        "Luxxon: no `fetch` implementation found. Provide one via the `fetch` option (Node <18).",
      );
    }

    this.auth = new AuthResource(this);
    this.me = new MeResource(this);
    this.config = new ConfigResource(this);
    this.health = new HealthResource(this);
    this.coverage = new CoverageResource(this);
    this.demand = new DemandResource(this);
    this.workspaces = new WorkspacesResource(this);
    this.pricing = new PricingResource(this);
    this.sessions = new SessionsResource(this);
    this.wallet = new WalletResource(this);
    this.settlements = new SettlementsResource(this);
  }

  /**
   * High-level helper: open a session, push-dispatch an operator,
   * wait for LIVE, return the session + a viewer token. Throws on
   * `NO_COVERAGE` (no operator in range) or timeout.
   *
   * Equivalent to `sessions.create()` + `sessions.dispatch()` +
   * `sessions.waitFor(s => s.state === "LIVE")` + `sessions.viewerToken()`.
   *
   * For a frame instead of a stream URL, use `sessions.frame()`
   * after this resolves — the cache fills ~3-5s after LIVE
   * (waiting on the first keyframe).
   */
  async requestLiveView(
    input: CreateSessionInput & {
      /** Max time to wait for state=LIVE (ms). Default 30_000. */
      timeoutMs?: number;
      /** Poll interval while waiting (ms). Default 1000. */
      pollIntervalMs?: number;
    },
  ): Promise<{ session: Session; viewer: ViewerToken }> {
    const { timeoutMs, pollIntervalMs, ...createInput } = input;
    const session = await this.sessions.create(createInput);
    await this.sessions.dispatch(session.id);
    const live = await this.sessions.waitFor(
      session.id,
      (s) => s.state === "LIVE",
      { timeoutMs, pollIntervalMs },
    );
    const viewer = await this.sessions.viewerToken(live.id);
    return { session: live, viewer };
  }

  /**
   * Low-level JSON request. Public for users who need an operation
   * the typed methods don't cover yet. Handles auth, error
   * shape, and the API's `{statusCode,message,data}` success envelope.
   */
  async json<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await this.raw(path, {
      ...init,
      headers: {
        accept: "application/json",
        ...(init.headers as Record<string, string> | undefined),
      },
    });

    // Capture any fresh consistency token the API echoes back.
    const echo = res.headers.get("x-lx-consistency-token");
    if (echo) this.consistencyToken = echo;

    const text = await res.text();
    if (text.length === 0) {
      if (!res.ok) {
        throw makeLuxxonError(res.status, "HTTP_ERROR", "");
      }
      return undefined as T;
    }

    let body: unknown = {};
    try {
      body = JSON.parse(text);
    } catch {
      throw makeLuxxonError(res.status, "INVALID_RESPONSE", text);
    }

    if (!res.ok) {
      const errBody = body as { code?: string; message?: string; detail?: string };
      throw makeLuxxonError(
        res.status,
        errBody.code ?? "HTTP_ERROR",
        text,
        errBody.message,
        errBody.detail,
      );
    }

    // Success-envelope unwrap: `{statusCode, message, data, timestamp}` → `data`.
    const wrapped = body as { data?: T };
    return (wrapped.data ?? (body as T));
  }

  /**
   * Low-level fetch — returns the raw Response. Use this for
   * binary endpoints (e.g. frame JPEGs).
   */
  async raw(path: string, init: RequestInit = {}): Promise<Response> {
    const url = path.startsWith("http") ? path : `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      ...(init.headers as Record<string, string> | undefined),
    };
    if (this.authHeader) headers.authorization = this.authHeader;
    if (this.cookieHeader) headers.cookie = this.cookieHeader;
    if (this.consistencyToken) headers["x-lx-consistency-token"] = this.consistencyToken;
    return this.fetchImpl(url, { ...init, headers });
  }

  /** Update the consistency token used on subsequent requests. */
  setConsistencyToken(token: string | null): void {
    this.consistencyToken = token;
  }
}

/* ──────────────────────────────────────────────────────────────
 * Resources
 * ──────────────────────────────────────────────────────────── */

class AuthResource {
  constructor(private readonly c: Luxxon) {}

  /** Mint a SIWE challenge for a wallet. The wallet then signs `message`. */
  challenge(walletAddress: string): Promise<ChallengeResponse> {
    return this.c.json<ChallengeResponse>("/auth/wallet/challenge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ walletAddress }),
    });
  }

  /** Verify a SIWE signature and start a wallet session. */
  login(input: WalletLoginInput): Promise<WalletLoginResponse> {
    return this.c.json<WalletLoginResponse>("/auth/wallet/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  }

  /** Pin the wallet session to a chosen workspace. */
  selectWorkspace(input: SelectWorkspaceInput): Promise<SelectWorkspaceResponse> {
    return this.c.json<SelectWorkspaceResponse>("/auth/workspace/select", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  }

  /** Tear down the wallet session. No-op for API-key callers. */
  logout(): Promise<{ ok: true }> {
    return this.c.json<{ ok: true }>("/auth/logout", { method: "POST" });
  }
}

class MeResource {
  constructor(private readonly c: Luxxon) {}

  /** Identity introspection. Shape depends on auth path (wallet vs. API key). */
  get(): Promise<Me> {
    return this.c.json<Me>("/me");
  }
}

class ConfigResource {
  constructor(private readonly c: Luxxon) {}

  /** Public chain + contract metadata. Cache-friendly; safe to memoize. */
  get(): Promise<Config> {
    return this.c.json<Config>("/config");
  }
}

class HealthResource {
  constructor(private readonly c: Luxxon) {}

  /** Public proof-of-life endpoint. */
  get(): Promise<Health> {
    return this.c.json<Health>("/health");
  }
}

class CoverageResource {
  constructor(private readonly c: Luxxon) {}

  /** Anonymized list of live operator coverage circles. */
  list(): Promise<CoverageEntry[]> {
    return this.c.json<CoverageEntry[]>("/coverage");
  }
}

class DemandResource {
  constructor(private readonly c: Luxxon) {}

  /** Last-30-day request heatmap, aggregated by ~5km cells. */
  heatmap(): Promise<DemandCell[]> {
    return this.c.json<DemandCell[]>("/demand");
  }
}

class PricingResource {
  constructor(private readonly c: Luxxon) {}

  /** Pre-session price quote. Returns a `quoteId` to lock the rate on `sessions.create()`. */
  quote(input: PricingQuoteInput): Promise<PriceQuote> {
    const qs = new URLSearchParams();
    qs.set("lat", String(input.lat));
    qs.set("lng", String(input.lng));
    qs.set("durationSeconds", String(input.durationSeconds));
    if (input.workspaceId) qs.set("workspaceId", input.workspaceId);
    return this.c.json<PriceQuote>(`/pricing/quote?${qs.toString()}`);
  }
}

class WorkspacesResource {
  constructor(private readonly c: Luxxon) {}

  /** Workspace-creation challenge (separate from auth challenge). */
  challenge(walletAddress: string): Promise<ChallengeResponse> {
    return this.c.json<ChallengeResponse>("/workspaces/challenge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ walletAddress }),
    });
  }

  /** Create a workspace. Caller must hold a session for `walletAddress`. */
  create(input: CreateWorkspaceInput): Promise<WorkspaceCreated> {
    return this.c.json<WorkspaceCreated>("/workspaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  }

  /** List workspaces visible to the caller. */
  list(): Promise<Workspace[]> {
    return this.c.json<Workspace[]>("/workspaces");
  }

  get(id: string): Promise<Workspace> {
    return this.c.json<Workspace>(`/workspaces/${encodeURIComponent(id)}`);
  }

  /**
   * Update a workspace. Patchable: `name`, `availabilityState` (supplier only),
   * `coverageLat / coverageLng / coverageRadiusMeters`, `deviceKind`.
   * Going ONLINE requires the full coverage triple to be set.
   */
  update(id: string, input: UpdateWorkspaceInput): Promise<Workspace> {
    return this.c.json<Workspace>(`/workspaces/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  }

  /** Convenience for the most common availability flip. */
  setAvailability(id: string, state: Exclude<AvailabilityState, "BUSY">): Promise<Workspace> {
    return this.update(id, { availabilityState: state });
  }

  /** Producer location heartbeat — ~5s cadence while ONLINE. */
  heartbeat(id: string, input: LocationHeartbeatInput): Promise<Workspace> {
    return this.c.json<Workspace>(`/workspaces/${encodeURIComponent(id)}/location`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  }

  /** Mint a new API key. The plaintext is returned ONCE on this call. */
  createApiKey(workspaceId: string, input: CreateApiKeyInput): Promise<ApiKeyCreated> {
    return this.c.json<ApiKeyCreated>(
      `/workspaces/${encodeURIComponent(workspaceId)}/api-keys`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      },
    );
  }

  /** Revoke an API key. Honors a 60s grace window for in-flight requests. */
  revokeApiKey(workspaceId: string, keyId: string): Promise<ApiKey> {
    return this.c.json<ApiKey>(
      `/workspaces/${encodeURIComponent(workspaceId)}/api-keys/${encodeURIComponent(keyId)}/revoke`,
      { method: "POST" },
    );
  }
}

class SessionsResource {
  constructor(private readonly c: Luxxon) {}

  /** Open a new session at the requested point/duration. */
  create(input: CreateSessionInput): Promise<Session> {
    return this.c.json<Session>("/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  }

  /**
   * List sessions visible to the caller's workspace, newest first.
   * Useful for recovering a sessionId when a long-running call
   * (request_live_view, wait_for_live) returned without one.
   */
  list(opts: { workspaceId?: string } = {}): Promise<Session[]> {
    const qs = opts.workspaceId
      ? `?workspaceId=${encodeURIComponent(opts.workspaceId)}`
      : "";
    return this.c.json<Session[]>(`/sessions${qs}`);
  }

  /**
   * Operator bulk cancel — cancel every `ASSIGNED` session where the
   * caller's workspace is the operator. Returns the cancelled
   * session ids and a count. Useful when an operator's device
   * crashes mid-stream and leaves a workspace stuck `BUSY`. LIVE
   * sessions are NOT touched — those still go through `end()`
   * because the meter has to run.
   *
   * Requires the `sessions:operate` scope.
   */
  cancelAllAssignments(): Promise<SessionCancelAllResult> {
    return this.c.json<SessionCancelAllResult>(
      "/sessions/cancel-all-assignments",
      { method: "POST" },
    );
  }

  /** Fetch a session's current state. Either side of the session can read. */
  get(sessionId: string): Promise<Session> {
    return this.c.json<Session>(`/sessions/${encodeURIComponent(sessionId)}`);
  }

  /**
   * Consumer-side push-assign: pick the longest-idle ONLINE
   * SUPPLIER whose coverage area contains the requested point.
   * Throws `NO_COVERAGE` (503) when no operator matches.
   */
  dispatch(sessionId: string): Promise<Session> {
    return this.c.json<Session>(
      `/sessions/${encodeURIComponent(sessionId)}/dispatch`,
      { method: "POST" },
    );
  }

  /** Operator-side: claim a REQUESTED session. */
  accept(sessionId: string, input: AcceptSessionInput = {}): Promise<Session> {
    return this.c.json<Session>(
      `/sessions/${encodeURIComponent(sessionId)}/accept`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      },
    );
  }

  /**
   * Operator-side: transition ASSIGNED → LIVE. Mints the Cloudflare
   * Stream `live_input` and returns WHIP + WHEP URLs.
   */
  start(sessionId: string): Promise<SessionStarted> {
    return this.c.json<SessionStarted>(
      `/sessions/${encodeURIComponent(sessionId)}/start`,
      { method: "POST" },
    );
  }

  /** End a LIVE session. Either side can call. */
  end(sessionId: string): Promise<Session> {
    return this.c.json<Session>(
      `/sessions/${encodeURIComponent(sessionId)}/end`,
      { method: "POST" },
    );
  }

  /**
   * Cancel a pre-LIVE session (REQUESTED or ASSIGNED). For LIVE
   * sessions use `end()` — DELETE returns INVALID_STATE on LIVE.
   */
  cancel(sessionId: string): Promise<Session> {
    return this.c.json<Session>(
      `/sessions/${encodeURIComponent(sessionId)}`,
      { method: "DELETE" },
    );
  }

  /**
   * Latest decoded video frame as a JPEG. LIVE sessions only.
   * Throws `FRAME_NOT_AVAILABLE` (404) until the first keyframe
   * lands (~3-5s after LIVE) and after the publisher disconnects.
   */
  async frame(sessionId: string): Promise<Frame> {
    const res = await this.c.raw(
      `/sessions/${encodeURIComponent(sessionId)}/frame`,
      { headers: { accept: "image/jpeg" } },
    );
    if (!res.ok) {
      const text = await res.text();
      let body: { code?: string; message?: string; detail?: string } = {};
      try {
        body = JSON.parse(text);
      } catch {
        /* leave body empty */
      }
      throw makeLuxxonError(
        res.status,
        body.code ?? "HTTP_ERROR",
        text,
        body.message,
        body.detail,
      );
    }
    const arr = new Uint8Array(await res.arrayBuffer());
    return {
      bytes: arr,
      contentType: res.headers.get("content-type") ?? "image/jpeg",
    };
  }

  /** WHEP playback URL for browser-side or native WebRTC consumers. */
  viewerToken(sessionId: string): Promise<ViewerToken> {
    return this.c.json<ViewerToken>(
      `/sessions/${encodeURIComponent(sessionId)}/viewer-token`,
    );
  }

  /** Operator-side WHIP URL re-fetch — recover from a tab crash mid-session. */
  producerToken(sessionId: string): Promise<ProducerToken> {
    return this.c.json<ProducerToken>(
      `/sessions/${encodeURIComponent(sessionId)}/producer-token`,
    );
  }

  /**
   * Poll `sessions.get` until `predicate(session)` is true. Throws
   * if the session reaches a terminal state (ENDED/EXPIRED/CANCELLED)
   * before the predicate matches, or after `timeoutMs`.
   */
  async waitFor(
    sessionId: string,
    predicate: (session: Session) => boolean,
    opts: { timeoutMs?: number; pollIntervalMs?: number } = {},
  ): Promise<Session> {
    const timeoutMs = opts.timeoutMs ?? 30_000;
    const pollIntervalMs = opts.pollIntervalMs ?? 1_000;
    const deadline = Date.now() + timeoutMs;
    const terminal = new Set(["ENDED", "EXPIRED", "CANCELLED"]);
    while (true) {
      const session = await this.get(sessionId);
      if (predicate(session)) return session;
      if (terminal.has(session.state)) {
        throw makeLuxxonError(
          409,
          "INVALID_STATE",
          "",
          `Session reached terminal state ${session.state} before predicate matched`,
        );
      }
      if (Date.now() >= deadline) {
        throw makeLuxxonError(
          408,
          "TIMEOUT",
          "",
          `waitFor: timed out after ${timeoutMs}ms in state ${session.state}`,
        );
      }
      await sleep(pollIntervalMs);
    }
  }
}

class WalletResource {
  constructor(private readonly c: Luxxon) {}

  /** Cached wallet state (tracked balance, last-synced block). */
  get(workspaceId?: string): Promise<WalletState> {
    const qs = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : "";
    return this.c.json<WalletState>(`/wallet${qs}`);
  }

  /** Cursor-paginated on-chain event ledger (deposits / settles / approvals). */
  events(input: WalletEventsInput = {}): Promise<OnChainEvent[]> {
    const qs = new URLSearchParams();
    if (input.cursor) qs.set("cursor", input.cursor);
    if (typeof input.limit === "number") qs.set("limit", String(input.limit));
    if (input.workspaceId) qs.set("workspaceId", input.workspaceId);
    const tail = qs.toString();
    return this.c.json<OnChainEvent[]>(`/wallet/events${tail ? `?${tail}` : ""}`);
  }
}

class SettlementsResource {
  constructor(private readonly c: Luxxon) {}

  /** Settlement state + tx hash for a given session. */
  get(sessionId: string): Promise<SettlementView> {
    return this.c.json<SettlementView>(
      `/settlements/${encodeURIComponent(sessionId)}`,
    );
  }
}

/* ──────────────────────────────────────────────────────────────
 * Internal helpers
 * ──────────────────────────────────────────────────────────── */

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function formatCookieHeader(value: string): string {
  // Accept either a raw value or a pre-formatted `name=value` pair.
  return value.includes("=") ? value : `lx_session=${value}`;
}

export type { LuxxonError };
