// Content Worker entry (alexandria-content).
// Serves uploaded HTML on a dedicated content origin, isolated from the
// app/admin origin (AGENT.md §8). Placeholder only — node G1.9 wires up
// serving the current version from R2. This Worker declares no D1, no R2
// and no secret binding yet; when D1 is later bound here it must stay
// strictly read-only (IMPLEMENTATION_PLAN.md §5 constraint 3).
export default {
  async fetch(_request: Request): Promise<Response> {
    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler;
