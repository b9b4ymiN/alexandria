// Content Worker entry (alexandria-content).
//
// Serves uploaded HTML on a dedicated content origin, isolated from the
// app/admin origin (AGENT.md §8). All request handling lives in
// src/content/handler.ts (Node G1.9); this file only wires the Worker's
// bindings to it. Bindings are exactly the D1 database and the R2 bucket
// declared in wrangler.content.jsonc — no admin or agent secret is bound
// here (IMPLEMENTATION_PLAN.md §5 Architecture Constraint 3, Node G1.9
// Implementation Requirement 2).
import { handleContentRequest, type ContentEnv } from "./handler";

export default {
  fetch(request: Request, env: ContentEnv): Promise<Response> {
    return handleContentRequest(request, env);
  },
} satisfies ExportedHandler<ContentEnv>;
