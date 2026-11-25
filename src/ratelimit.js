// Tiny in-memory fixed-window limiter (single-process). Used to slow down password guessing.
export class RateLimiter {
  constructor(max, windowMs) { this.max = max; this.windowMs = windowMs; this.hits = new Map(); }
  #entry(key) {
    const now = Date.now(); let e = this.hits.get(key);
    if (!e || e.resetAt <= now) { e = { count: 0, resetAt: now + this.windowMs }; this.hits.set(key, e); }
    return e;
  }
  blocked(key) { return this.#entry(key).count >= this.max; }
  fail(key) { this.#entry(key).count++; }
  reset(key) { this.hits.delete(key); }
  prune() { const now = Date.now(); for (const [k, e] of this.hits) if (e.resetAt <= now) this.hits.delete(k); }
}
