/**
 * Provider interface for quota monitoring tools.
 * Each provider knows how to fetch and parse quota data for a specific model API.
 */
export const PROVIDER_NAME_REGEX = /^[a-z][a-z0-9]*$/;

/**
 * @typedef {Object} IProvider
 * @property {string} name          - Unique lowercase identifier, e.g. "glm" or "minimax"
 * @property {string} displayName   - Human-readable name for display, e.g. "GLM" or "MiniMax"
 * @property {string|null} quotaUrl  - API endpoint for quota data, null if derived from base-url
 * @property {string|undefined} authKey - Env var key for auth token, e.g. "ANTHROPIC_AUTH_TOKEN"
 * @property {string|undefined} baseUrlKey - Env var key for base URL, e.g. "ANTHROPIC_BASE_URL"
 */

/**
 * @typedef {(config: object, fetchImpl?: function) => object} FetchFn
 * Returns a raw response object: { kind: "response", status, json, text }
 *                                       or { kind: "unavailable" }
 */

/**
 * @typedef {(response: object) => object} ParseFn
 * Returns a parsed quota result:
 *   { kind: "success", leftPercent, usedPercent, nextResetTime, level, quotas, mcp, ... }
 *   { kind: "auth_error" }
 *   { kind: "rate_limited" }
 *   { kind: "unavailable" }
 */

/**
 * @param {IProvider} provider
 * @returns {boolean}
 */
export function isValidProvider(provider) {
  return (
    provider &&
    typeof provider.name === "string" &&
    PROVIDER_NAME_REGEX.test(provider.name) &&
    typeof provider.fetch === "function" &&
    typeof provider.parse === "function"
  );
}
