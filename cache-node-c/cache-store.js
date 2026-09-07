// A simple in-memory key-value store with per-key TTL (time-to-live).
// Each entry is { value, expiresAt }. expiresAt = null means "never expires".

const store = new Map();

function now() {
  return Date.now();
}

export function get(key) {
  const entry = store.get(key);
  if (!entry) return undefined;

  if (entry.expiresAt !== null && entry.expiresAt <= now()) {
    // Expired — treat it as a miss and clean it up
    store.delete(key);
    return undefined;
  }

  return entry.value;
}

export function set(key, value, ttlSeconds = null) {
  const expiresAt = ttlSeconds ? now() + ttlSeconds * 1000 : null;
  store.set(key, { value, expiresAt });
}

export function del(key) {
  store.delete(key);
}

export function has(key) {
  return get(key) !== undefined;
}

export function size() {
  return store.size;
}
export function keys() {
  return Array.from(store.keys());
}