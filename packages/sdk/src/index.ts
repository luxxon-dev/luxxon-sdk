// Luxxon TypeScript SDK — public entry point.
//
// Pure-fetch HTTP client over the Luxxon REST API. No native deps,
// no codegen — hand-typed methods over the operations agents and
// integrators actually use. The MCP server in `@luxxon/mcp`
// imports from here so it stays in lockstep with the SDK surface.
//
// Tracks the public OpenAPI spec at
// https://api.luxxon.dev/api/v1/docs-json — when the API adds a
// new operation we expose it here or skip with a comment
// explaining why (most often: internal-only or deferred-feature).

export { Luxxon } from "./client.js";
export type { LuxxonOptions } from "./client.js";
export type { LuxxonError, LuxxonErrorCode } from "./errors.js";

export type {
  // Sessions
  Session,
  SessionState,
  CreateSessionInput,
  AcceptSessionInput,
  Frame,
  ViewerToken,
  ProducerToken,
  SessionStarted,
  SessionCancelAllResult,
  // Pricing
  PriceQuote,
  PricingQuoteInput,
  // Wallet + settlements
  WalletState,
  WalletEventsInput,
  OnChainEvent,
  OnChainEventKind,
  SettlementView,
  SettlementState,
  SettlementPayload,
  // Config / health
  Config,
  Health,
  // Coverage / demand
  CoverageEntry,
  DemandCell,
  // Workspaces + API keys
  Workspace,
  WorkspaceCreated,
  WorkspaceRole,
  AvailabilityState,
  DeviceKind,
  MemberRole,
  CreateWorkspaceInput,
  UpdateWorkspaceInput,
  LocationHeartbeatInput,
  ApiKey,
  ApiKeyCreated,
  ApiKeyEnvironment,
  CreateApiKeyInput,
  // Auth / me
  ChallengeResponse,
  WalletLoginInput,
  WalletLoginResponse,
  WorkspaceMembership,
  SelectWorkspaceInput,
  SelectWorkspaceResponse,
  Me,
  MeWalletSession,
  MeApiKey,
} from "./types.js";
