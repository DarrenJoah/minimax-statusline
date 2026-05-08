import { isValidProvider } from "./IProvider.js";
import { glm } from "./glm.js";
import { minimax } from "./minimax.js";
import { minimaxIntl } from "./minimax-intl.js";
import { kimi } from "./kimi.js";

export const ALL_PROVIDERS = [glm, minimax, minimaxIntl, kimi];

/** @type {Map<string, IProvider>} */
export const PROVIDER_MAP = new Map(ALL_PROVIDERS.map((p) => [p.name, p]));

export function isKnownProvider(name) {
  return PROVIDER_MAP.has(name);
}

export function getProvider(name) {
  return PROVIDER_MAP.get(name) ?? null;
}

export function assertValidProvider(name) {
  const provider = getProvider(name);
  if (!provider || !isValidProvider(provider)) {
    throw new Error(`Unknown provider: ${name}`);
  }
  return provider;
}
