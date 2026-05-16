// Typed error codes emitted by the Luxxon API. Mirrors the
// `code` field on the `LxErrorResponseDto` shape. Add new entries
// as the API surfaces them — unknown codes still surface as
// strings through `LuxxonError.code`, so this is a typing
// convenience, not a closed set.
export type LuxxonErrorCode =
  | "NOT_AUTHENTICATED"
  | "NOT_AUTHORIZED"
  | "INVALID_TOKEN"
  | "INVALID_API_KEY"
  | "REVOKED_API_KEY"
  | "MISSING_TOKEN"
  | "WORKSPACE_MISMATCH"
  | "INVALID_INPUT"
  | "INVALID_STATE"
  | "NOT_FOUND"
  | "SESSION_NOT_FOUND"
  | "WORKSPACE_NOT_FOUND"
  | "QUOTE_NOT_FOUND"
  | "QUOTE_EXPIRED"
  | "NO_COVERAGE"
  | "UNAVAILABLE"
  | "INSUFFICIENT_POOL"
  | "FRAME_NOT_AVAILABLE"
  | "CONFLICT"
  | "AUTHZ_ERROR"
  | "DATABASE_ERROR"
  | "VIDEO_ERROR"
  | "EXTERNAL_ERROR"
  | "INTERNAL_SERVER_ERROR"
  | "HTTP_ERROR"
  | "INVALID_RESPONSE";

export interface LuxxonError extends Error {
  status: number;
  code: LuxxonErrorCode | string;
  detail?: string;
  /** Raw response body (string) for debugging. */
  raw: string;
}

export function makeLuxxonError(
  status: number,
  code: string,
  raw: string,
  message?: string,
  detail?: string,
): LuxxonError {
  const err = new Error(message ?? `${code} (${status})`) as LuxxonError;
  err.status = status;
  err.code = code;
  err.detail = detail;
  err.raw = raw;
  return err;
}
