/** A small per-address request limit, held in this server instance's memory.
 *
 * It is a floor, not a wall: each instance counts on its own, so it blunts a
 * single client hammering the endpoint but is not a substitute for the
 * platform's firewall. It applies only when the platform reports a client
 * address, which is always the case in production. */
type Window = { start: number; count: number };
const MAX_TRACKED = 5000;
/** Everyone who does not fit in the table shares this one window, so filling
 * the table cannot be used to get a fresh allowance. */
const OVERFLOW = "*";
export function rateLimiter(limit: number, windowMs: number) {
  const seen = new Map<string, Window>();
  const count = (key: string, now: number) => {
    const w = seen.get(key);
    if (!w || now - w.start >= windowMs) {
      seen.set(key, { start: now, count: 1 });
      return true;
    }
    return ++w.count <= limit;
  };
  /** True if this request is within the limit. */
  return function allow(client: string | null, now = Date.now()): boolean {
    if (!client) return true;
    if (seen.has(client)) return count(client, now);
    if (seen.size >= MAX_TRACKED)
      for (const [k, v] of seen) if (now - v.start >= windowMs) seen.delete(k);
    return count(seen.size >= MAX_TRACKED ? OVERFLOW : client, now);
  };
}
/** The client address as the hosting platform reports it. Vercel sets
 * `x-real-ip` and overwrites `x-forwarded-for` itself; a value the client
 * sent is never trusted there. An IPv6 client is identified by its /64, since
 * one subscriber controls all of it. */
export function clientOf(request: Request): string | null {
  const raw =
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0] ??
    "";
  const ip = raw.trim();
  if (!ip || ip.length > 64) return null;
  return ip.includes(":") ? ip.toLowerCase().split(":").slice(0, 4).join(":") : ip;
}
