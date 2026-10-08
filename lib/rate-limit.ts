/** A small per-address request limit, held in this server instance's memory.
 *
 * It is a floor, not a wall: each instance counts on its own, so it blunts a
 * single client hammering the endpoint but is not a substitute for the
 * platform's firewall. It applies only when the platform reports a client
 * address, which is always the case in production. */
type Window = { start: number; count: number };
const MAX_TRACKED = 5000;
export function rateLimiter(limit: number, windowMs: number) {
  const seen = new Map<string, Window>();
  /** True if this request is within the limit. */
  return function allow(client: string | null, now = Date.now()): boolean {
    if (!client) return true;
    const w = seen.get(client);
    if (!w || now - w.start >= windowMs) {
      if (seen.size >= MAX_TRACKED) {
        for (const [k, v] of seen) if (now - v.start >= windowMs) seen.delete(k);
        // Still full of live windows: drop the oldest so memory stays bounded.
        if (seen.size >= MAX_TRACKED) seen.delete(seen.keys().next().value!);
      }
      seen.set(client, { start: now, count: 1 });
      return true;
    }
    return ++w.count <= limit;
  };
}
/** The client address as reported by the platform's proxy, if any. */
export function clientOf(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first && first.length <= 64 ? first : null;
}
