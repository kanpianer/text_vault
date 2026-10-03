/**
 * Brute-force protection: progressive back-off on failed credential checks.
 *
 * Two counters are kept per protected resource (vault or share):
 *   - per (resource, client IP): small free budget, protects against a single attacker;
 *   - per resource (global): larger budget, protects against distributed guessing.
 * After the free budget is spent each further failure doubles the lock window (capped).
 * Successful verification clears the per-client counter.
 */

export const FAILURE_DEFAULTS = {
  perClientFree: 10,
  globalFree: 100,
  baseDelayMs: 1000,
  maxLockMs: 15 * 60 * 1000,
  resetAfterMs: 60 * 60 * 1000,
};

/** Pure state transition used by both the in-memory and KV trackers. */
export function nextFailureState(entry, now, freeBudget, opts = FAILURE_DEFAULTS) {
  const fresh = !entry || now - (entry.lastFailure || 0) > opts.resetAfterMs;
  const count = (fresh ? 0 : entry.count || 0) + 1;
  let lockedUntil = fresh ? 0 : entry.lockedUntil || 0;
  if (count > freeBudget) {
    const over = count - freeBudget;
    const delay = Math.min(opts.maxLockMs, opts.baseDelayMs * Math.pow(2, Math.min(over - 1, 30)));
    lockedUntil = now + delay;
  }
  return { count, lockedUntil, lastFailure: now };
}

function blockedResult(entries, now) {
  const until = Math.max(0, ...entries.map((e) => (e && e.lockedUntil) || 0));
  if (until > now) {
    return { blocked: true, retryAfterSec: Math.max(1, Math.ceil((until - now) / 1000)) };
  }
  return { blocked: false, retryAfterSec: 0 };
}

/** In-memory tracker for the single-process Express server. */
export function createMemoryFailureTracker(options = {}) {
  const opts = { ...FAILURE_DEFAULTS, ...options };
  const maxEntries = options.maxEntries || 50000;
  const store = new Map();
  const now = options.now || (() => Date.now());

  const clientKey = (scope, ip) => `c:${scope}:${ip || "unknown"}`;
  const globalKey = (scope) => `g:${scope}`;

  function put(key, value) {
    store.delete(key);
    store.set(key, value);
    // Bounded memory: evict oldest entries first (Map preserves insertion order).
    while (store.size > maxEntries) {
      const oldest = store.keys().next().value;
      store.delete(oldest);
    }
  }

  return {
    check(scope, ip) {
      return blockedResult([store.get(clientKey(scope, ip)), store.get(globalKey(scope))], now());
    },
    fail(scope, ip) {
      const t = now();
      put(clientKey(scope, ip), nextFailureState(store.get(clientKey(scope, ip)), t, opts.perClientFree, opts));
      put(globalKey(scope), nextFailureState(store.get(globalKey(scope)), t, opts.globalFree, opts));
    },
    succeed(scope, ip) {
      store.delete(clientKey(scope, ip));
    },
    reset() {
      store.clear();
    },
  };
}

/** Cloudflare KV-backed tracker (eventually consistent — approximate, but bounds guessing rate). */
export function createKvFailureTracker(kv, options = {}) {
  const opts = { ...FAILURE_DEFAULTS, ...options };
  const now = options.now || (() => Date.now());
  const ttlSec = Math.max(60, Math.ceil(opts.resetAfterMs / 1000));

  const clientKey = (scope, ip) => `rl:c:${scope}:${ip || "unknown"}`;
  const globalKey = (scope) => `rl:g:${scope}`;

  async function read(key) {
    if (!kv) return null;
    try {
      const raw = await kv.get(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  async function write(key, value) {
    if (!kv) return;
    try {
      await kv.put(key, JSON.stringify(value), { expirationTtl: ttlSec });
    } catch {
      // Rate-limit bookkeeping must never break the main request.
    }
  }

  return {
    async check(scope, ip) {
      const [c, g] = await Promise.all([read(clientKey(scope, ip)), read(globalKey(scope))]);
      return blockedResult([c, g], now());
    },
    async fail(scope, ip) {
      const t = now();
      const [c, g] = await Promise.all([read(clientKey(scope, ip)), read(globalKey(scope))]);
      await Promise.all([
        write(clientKey(scope, ip), nextFailureState(c, t, opts.perClientFree, opts)),
        write(globalKey(scope), nextFailureState(g, t, opts.globalFree, opts)),
      ]);
    },
    async succeed(scope, ip) {
      if (!kv) return;
      try {
        await kv.delete(clientKey(scope, ip));
      } catch {
        /* ignore */
      }
    },
  };
}
