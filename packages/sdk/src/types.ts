// Types mirror the public OpenAPI spec
// (https://api.luxxon.dev/api/v1/docs-json). Hand-written rather
// than generated to keep the surface tight + readable; if the API
// adds a field that's relevant to integrators, we add it here
// explicitly. Fields the public surface shouldn't lean on (soft-
// delete timestamps, dormant scaffolds) are intentionally omitted.

/* ──────────────────────────────────────────────────────────────
 * Sessions
 * ──────────────────────────────────────────────────────────── */

export type SessionState =
  | "REQUESTED"
  | "ASSIGNED"
  | "LIVE"
  | "PAUSED"
  | "ENDED"
  | "EXPIRED"
  | "CANCELLED";

export interface Session {
  id: string;
  consumerWorkspaceId: string;
  operatorWorkspaceId: string | null;
  state: SessionState;
  maxDurationSeconds: number;
  /** Rate per second in µUSDC. String — may exceed JS Number. */
  ratePerSecondMicroUsdc: string;
  /** Pre-authorized hold in µUSDC. */
  holdMicroUsdc: string;
  startedAt: string | null;
  endedAt: string | null;
  /** Chargeable seconds at /end — (endedAt - startedAt) - sum(disconnect windows). */
  cleanSeconds: number;
  /** Derived: cleanSeconds × ratePerSecondMicroUsdc. */
  chargedMicroUsdc: string;
  settlementTxHash: string | null;
  /** Cloudflare Stream live_input uid while LIVE; null otherwise. */
  videoBackendRef: string | null;
  createdAt: string;
  /** Pool model: stays false except in legacy code paths. */
  authorized: boolean;
  /** WHEP playback URL — present when state=LIVE. Session-scoped secret. */
  whepUrl?: string | null;
  /** WHIP publish URL — present when state=LIVE and the caller is the operator. */
  whipUrl?: string | null;
}

export interface CreateSessionInput {
  lat: number;
  lng: number;
  maxDurationSeconds: number;
  /** Optional pre-fetched price-quote id to lock the rate at quote time. */
  quoteId?: string;
  /** Optional. Defaults to caller's workspace; required for wallet sessions if it disagrees. */
  workspaceId?: string;
}

export interface AcceptSessionInput {
  /** Operator workspace to claim the session for. Optional for API-key callers (defaults to the key's workspace). */
  operatorWorkspaceId?: string;
}

export interface Frame {
  /** Raw JPEG bytes. */
  bytes: Uint8Array;
  /** MIME type from the server; always image/jpeg today. */
  contentType: string;
}

export interface ViewerToken {
  videoBackendRef: string;
  /** WHEP playback URL (Cloudflare Stream). Treat as session-scoped secret. */
  whepUrl: string;
}

export interface ProducerToken {
  videoBackendRef: string;
  /** WHIP publish URL. The URL itself is the auth bearer. */
  whipUrl: string;
}

export interface SessionStarted {
  session: Session;
  videoBackendRef: string;
  whipUrl: string;
  whepUrl: string;
}

/**
 * Returned from `sessions.cancelAllAssignments()`. The operator's
 * bulk cancel of every ASSIGNED session their workspace owns.
 */
export interface SessionCancelAllResult {
  /** Number of sessions cancelled. */
  count: number;
  /** Cancelled session ids, oldest first by `createdAt`. */
  cancelled: string[];
}

/* ──────────────────────────────────────────────────────────────
 * Pricing
 * ──────────────────────────────────────────────────────────── */

export interface PriceQuote {
  quoteId: string;
  /** µUSDC per second. String to preserve BigInt precision. */
  ratePerSecondMicroUsdc: string;
  /** µUSDC for the requested duration at the quoted rate. */
  estimatedTotalMicroUsdc: string;
  supplyFactor: number;
  demandFactor: number;
  corridorMultiplier: number;
  baseRatePerSecondMicroUsdc: string;
  /** ISO timestamp; quotes typically valid for ~5 min. */
  expiresAt: string;
}

export interface PricingQuoteInput {
  lat: number;
  lng: number;
  durationSeconds: number;
  /** Optional — only meaningful for wallet-session callers. */
  workspaceId?: string;
}

/* ──────────────────────────────────────────────────────────────
 * Wallet
 * ──────────────────────────────────────────────────────────── */

export interface WalletState {
  workspaceId: string;
  walletAddress: string;
  /** Watcher-snapshot balance in µUSDC. */
  trackedBalance: string;
  lastSyncBlock: string;
  updatedAt: string;
}

export type OnChainEventKind =
  | "DEPOSIT"
  | "WITHDRAWAL"
  | "SETTLE"
  | "APPROVAL";

export interface OnChainEvent {
  id: string;
  workspaceId: string;
  kind: OnChainEventKind;
  txHash: string;
  blockNumber: string;
  confirmedAt: string;
  /** Event amount in µUSDC. */
  amountUsdc: string;
  /** Session id when the event is a settlement; null otherwise. */
  relatedSession: string | null;
}

export interface WalletEventsInput {
  cursor?: string;
  limit?: number;
  /** Only meaningful for wallet-session callers. */
  workspaceId?: string;
}

/* ──────────────────────────────────────────────────────────────
 * Settlements
 * ──────────────────────────────────────────────────────────── */

export type SettlementState =
  | "NOT_READY"
  | "PENDING"
  | "SUBMITTED"
  | "CONFIRMED";

export interface SettlementPayload {
  sessionId: string;
  consumerWalletAddress: string;
  operatorWalletAddress: string;
  ratePerSecondMicroUsdc: string;
  chargeableSeconds: number;
  toAmountMicroUsdc: string;
  feeAmountMicroUsdc: string;
}

export interface SettlementView {
  sessionId: string;
  state: SettlementState;
  payload?: SettlementPayload;
  txHash?: string;
  confirmedAt?: string;
}

/* ──────────────────────────────────────────────────────────────
 * Config + Health
 * ──────────────────────────────────────────────────────────── */

export interface Config {
  environment: "TEST" | "LIVE";
  chainId: number;
  chainName: string;
  rpcUrl: string;
  explorerUrl: string;
  usdcAddress: string;
  settlementAddress: string;
}

export interface Health {
  ok: boolean;
  surface: string;
  version: string;
  buildSha: string;
}

/* ──────────────────────────────────────────────────────────────
 * Coverage + Demand
 * ──────────────────────────────────────────────────────────── */

export interface CoverageEntry {
  /** Coverage circle centroid latitude. */
  lat: number;
  lng: number;
  /** Radius in meters. */
  radiusMeters: number;
  /** Operator device kind (PHONE | DRONE | …). */
  deviceKind: DeviceKind | null;
}

export interface DemandCell {
  /** Cell centroid (~5km grid snap). */
  lat: number;
  lng: number;
  /** Total requests in the last 30 days inside this cell. */
  requests: number;
  /** Subset of `requests` that weren't fulfilled (EXPIRED / no-match). */
  unmet: number;
  /** Average max-price the consumer was willing to pay (µUSDC), if known. */
  avgMaxPriceMicroUsdc: number | null;
}

/* ──────────────────────────────────────────────────────────────
 * Workspaces
 * ──────────────────────────────────────────────────────────── */

export type WorkspaceRole = "CONSUMER" | "SUPPLIER";
export type AvailabilityState = "OFFLINE" | "ONLINE" | "BUSY";
export type DeviceKind =
  | "PHONE"
  | "LAPTOP"
  | "DRONE"
  | "PTZ"
  | "FIXED"
  | "OTHER";
export type MemberRole = "OWNER" | "ADMIN" | "VIEWER";

export interface Workspace {
  id: string;
  slug: string;
  name: string;
  walletAddress: string;
  roles: WorkspaceRole[];
  availabilityState: AvailabilityState;
  coverageLat: number | null;
  coverageLng: number | null;
  coverageRadiusMeters: number | null;
  deviceKind: DeviceKind | null;
  lastSeenAt: string | null;
  createdAt: string;
  createdByWallet: string;
  deletedAt: string | null;
}

export interface WorkspaceCreated extends Workspace {
  /** SpiceDB ZedToken; pass on follow-up calls as `X-Lx-Consistency-Token`. */
  consistencyToken: string | null;
}

export interface CreateWorkspaceInput {
  slug: string;
  name: string;
  walletAddress: string;
  /** Signature over the challenge message from `workspaces.challenge()`. */
  signature: string;
  nonce: string;
  roles: WorkspaceRole[];
}

export interface UpdateWorkspaceInput {
  name?: string;
  availabilityState?: "ONLINE" | "OFFLINE";
  coverageLat?: number;
  coverageLng?: number;
  coverageRadiusMeters?: number;
  deviceKind?: DeviceKind;
}

export interface LocationHeartbeatInput {
  lat: number;
  lng: number;
  /** GPS accuracy radius (m); ≤100m is honored for geofence checks. */
  accuracyMeters: number;
  /** Monotone per-workspace counter. Replays / out-of-order → 409. */
  sequence: number | string;
  /** Correlate to a LIVE session. */
  sessionId?: string;
  /** Reserved for future movement-plausibility caps. */
  speedMps?: number;
}

/* ──────────────────────────────────────────────────────────────
 * API keys
 * ──────────────────────────────────────────────────────────── */

export type ApiKeyEnvironment = "LIVE" | "TEST";

export interface ApiKey {
  id: string;
  workspaceId: string;
  /** First 20 chars of the plaintext key. Safe for UI display. */
  prefix: string;
  label: string;
  environment: ApiKeyEnvironment;
  scopes: string[];
  lastUsedAt: string | null;
  revokedAt: string | null;
  gracePeriodEnd: string | null;
  createdAt: string;
  createdByWallet: string;
}

export interface ApiKeyCreated extends ApiKey {
  /** Full plaintext key — server returns once; store it now or never. */
  plaintext: string;
}

export interface CreateApiKeyInput {
  label: string;
  environment: ApiKeyEnvironment;
  scopes: string[];
}

/* ──────────────────────────────────────────────────────────────
 * Auth + Me
 * ──────────────────────────────────────────────────────────── */

export interface ChallengeResponse {
  nonce: string;
  /** Exact bytes to sign — server-issued; don't modify. */
  message: string;
  expiresAt: string;
}

export interface WalletLoginInput {
  walletAddress: string;
  nonce: string;
  /** 0x-prefixed signature. EOA or ERC-1271 smart-wallet sig. */
  signature: string;
}

export interface WalletLoginResponse {
  walletAddress: string;
  workspaces: WorkspaceMembership[];
}

export interface WorkspaceMembership {
  id: string;
  slug: string;
  name: string;
  role: MemberRole;
}

export interface SelectWorkspaceInput {
  workspaceId: string;
}

export interface SelectWorkspaceResponse {
  walletAddress: string;
  workspaceId: string;
  role: MemberRole;
}

export interface MeWalletSession {
  kind: "wallet_session";
  walletAddress: string;
  activeWorkspaceId: string | null;
  activeRole: MemberRole | null;
  workspaces: WorkspaceMembership[];
}

export interface MeApiKey {
  kind: "api_key";
  keyId: string;
  workspaceId: string;
  environment: ApiKeyEnvironment;
  scopes: string[];
  workspace: {
    id: string;
    slug: string;
    name: string;
  } | null;
}

export type Me = MeWalletSession | MeApiKey;
