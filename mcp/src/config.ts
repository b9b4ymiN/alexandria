// Configuration for the Alexandria MCP server.
//
// Node G5.2, requirement 1: the server reads its two required settings
// from the environment, fails fast with a clear message on stderr and a
// non-zero exit when either is missing, and never prints the key
// (requirement 3). Nothing in this module writes to stdout — on a stdio
// MCP server stdout is the protocol wire (AGENT.md §13, node G5.2 §4.g).

/** Mirrors DEFAULT_MAX_UPLOAD_BYTES in src/domain/documents/html-validation.ts.
 *
 * That file is Worker-targeted and cannot be imported across the package
 * boundary, so the value is duplicated here. The Agent API is the
 * enforcing authority for this limit; this constant exists only so the
 * MCP server can fail a local check fast, before spending a network round
 * trip on a file the API would reject anyway (node G5.2 requirement 2,
 * §4.f).
 */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export interface Config {
  apiUrl: string;
  agentKey: string;
  maxUploadBytes: number;
}

export class ConfigError extends Error {}

/**
 * Reads and validates configuration from `env`. Throws {@link ConfigError}
 * with a message safe to print (it never includes the key's value) when a
 * required variable is missing or blank.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const apiUrl = env.ALEXANDRIA_API_URL?.trim();
  const agentKey = env.ALEXANDRIA_AGENT_KEY?.trim();

  const missing: string[] = [];
  if (!apiUrl) missing.push("ALEXANDRIA_API_URL");
  if (!agentKey) missing.push("ALEXANDRIA_AGENT_KEY");

  if (missing.length > 0 || !apiUrl || !agentKey) {
    throw new ConfigError(
      `Missing required environment variable(s): ${missing.join(", ")}. ` +
        "Set ALEXANDRIA_API_URL (the Alexandria Agent API base URL) and " +
        "ALEXANDRIA_AGENT_KEY (the agent's bearer key) before starting the server.",
    );
  }

  return { apiUrl, agentKey, maxUploadBytes: MAX_UPLOAD_BYTES };
}
