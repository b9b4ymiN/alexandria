// Dependencies every write tool needs, threaded in from server.ts so a
// test can construct them directly without going through stdio
// (node G5.2 §4.j — tools stay independent of how they were registered).
import type { AgentApiClient } from "./api-client.js";

export interface ToolDeps {
  apiClient: AgentApiClient;
  maxUploadBytes: number;
}
