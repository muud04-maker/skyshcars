/*
  Small in-memory rate limiter. It protects login, quote and contact forms from rapid abuse.
  Note: counters are per server process (they reset on restart). That is adequate for a single
  Hostinger Node instance; use Cloudflare/WAF rules for heavier protection.
*/
type Bucket = { hits: number[] };
const store = new Map<string, Bucket>();

export function clientIp(req: Request) {
  const h = req.headers;
  const xf = h.get('x-forwarded-for');
  return (xf ? xf.split(',')[0].trim() : h.get('x-real-ip') || 'unknown').slice(0, 64);
}

/** Returns {ok:false, retryAfter} when the key has exceeded `limit` hits within `windowMs`. */
export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const b = store.get(key) || { hits: [] };
  b.hits = b.hits.filter(t => now - t < windowMs);
  if (b.hits.length >= limit) {
    store.set(key, b);
    return { ok: false, retryAfter: Math.ceil((windowMs - (now - b.hits[0])) / 1000) };
  }
  b.hits.push(now);
  store.set(key, b);
  if (store.size > 5000) for (const [k, v] of store) if (!v.hits.length || now - v.hits[v.hits.length - 1] > windowMs) store.delete(k);
  return { ok: true, retryAfter: 0 };
}

export function tooMany(retryAfter: number) {
  return Response.json({ error: 'Too many attempts. Please wait a few minutes and try again.' }, { status: 429, headers: { 'Retry-After': String(retryAfter) } });
}

export const clean = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
export const looksEmail = (v: string) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(v);
