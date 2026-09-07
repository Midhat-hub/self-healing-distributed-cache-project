Yes — good instinct to ask. This **is** a microservices architecture: 6+ independently running processes, each with a single clear responsibility, communicating only over HTTP, each independently startable/killable/restartable (which is literally what makes the self-healing demo possible — you can kill one process without taking down the others). A few honest caveats worth knowing for an interview: it's a simplified/educational version — no service discovery (URLs are hardcoded), no container orchestration (you're running raw `node` processes, not Docker/Kubernetes), no message broker (all communication is direct HTTP), and everything's one language/stack (Node.js) rather than polyglot. But structurally — separate deployable units, single-responsibility, network-based communication, independent failure domains — yes, that's the real definition of microservices, just at demo scale rather than production scale.

Now, the full breakdown:

---

### `origin-server/`

**Detailed:**

- `db.js` — creates and exports a reusable Postgres connection pool using credentials from `.env`
- `init-db.js` — one-time setup script: drops/recreates the `products` table, seeds it with 100 randomized rows across 5 categories
- `server.js`:
  - `GET /health` — reports UP, used by the Load Balancer's heartbeat
  - `GET /origin/products/:id` — looks up a product in Postgres; this is only ever called by a cache node after a cache miss
  - `PUT /origin/products/:id` — updates a product's fields directly in Postgres (partial updates via `COALESCE`)

**Short summary:** The database-backed source of truth. Holds the real product data in Postgres and only gets hit when a cache node doesn't already have what it needs.

---

### `cache-node/`, `cache-node-b/`, `cache-node-c/` (3 identical services, different ports)

**Detailed:**

- `cache-store.js` — the actual in-memory cache logic: `get` (checks expiry, evicts if stale), `set` (with TTL), `del`, `has`, `size`, `keys` (lists everything currently held)
- `server.js`:
  - `GET /health` — reports UP + current cache size
  - `GET /cache/:key` — checks memory first; on a miss, calls the origin server, stores the result with a TTL, returns it
  - `POST /cache/:key` — directly sets a value in this node's memory (used by the Load Balancer for primary writes)
  - `DELETE /cache/:key` — evicts a key
  - `POST /replicate/:key` — internal-only: stores a value that arrived as a replica copy from another node's primary write
  - `GET /keys` — internal-only: lists every key this node currently holds, used during rebalancing

**Short summary:** The actual cache. Three separate processes, each holding its own slice of data in RAM, falling back to the origin server whenever they don't have something locally.

---

### `load-balancer/`

**Detailed:**

- `hash-ring.js` — `HashRing` class implementing consistent hashing with virtual nodes:
  - `addNode` / `removeNode` — add/remove a physical node's 100 virtual points from the ring
  - `getNode(key)` — finds which node owns a given key (the "primary")
  - `getReplicaNode(key)` — finds the next distinct node clockwise (the "replica")
- `health-monitor.js` — `HealthMonitor` class:
  - Pings every node's `/health` every 2 seconds
  - Marks a node DOWN after 2 consecutive missed beats, UP after 1 success
  - Fires a callback exactly once per actual state transition
- `server.js`:
  - Wires the ring + health monitor together
  - `GET /cache/:key` — routes to the key's primary via the ring; if that node is DOWN, automatically reads from the replica instead
  - `POST /cache/:key` — writes synchronously to the primary, fires an async (non-blocking) replicate call to the replica
  - On a DOWN event: removes the node from the ring
  - On an UP event: re-adds the node to the ring, then copies back (`rebalanceInto`) any keys that now belong to it, by querying other nodes' `/keys`
  - `GET /stats` — total requests, hit rate, real p50/p95/p99 latency, per-node request counts, live node health
  - `GET /recent-requests` — structured log of the last 50 requests, for the dashboard

**Short summary:** The brain of the system. Decides which cache node owns each key, keeps a backup copy of every key on a second node, detects failures and automatically reroutes around them, and heals the ring when a node comes back.

---

### `gateway/`

**Detailed:**

- `rate-limiter.js` — a token-bucket-based `RateLimiter` class, one bucket per API key: `tryConsume` (spend a token or reject), `getRemainingTokens`
- `server.js`:
  - `authenticate` middleware — checks for a valid `Authorization: Bearer <key>` header, rejects with 401 if missing/invalid
  - `rateLimit` middleware — runs after auth, rejects with 429 if that key's bucket is empty
  - `GET`/`POST /cache/:key` — thin proxy, forwards authenticated/allowed requests straight through to the Load Balancer
  - `GET /gateway-logs` — structured log of recent requests (API key, endpoint, status, latency)

**Short summary:** The front door. Every external request must pass through here first — checked for a valid API key, then checked against that key's rate limit, before ever reaching the rest of the system.

---

### `dashboard/`

**Detailed:**

- `src/useStats.js` — a custom React hook that polls the Load Balancer's `/stats` and `/recent-requests` every 1.5 seconds, and keeps a rolling 30-point history for charting trends over time
- `src/App.jsx` — renders live stat cards (total requests, hit rate, p50/p95/p99), color-coded UP/DOWN node badges, and a live line chart of request volume + hit rate
- `src/App.css` — visual styling for all of the above

**Short summary:** The window into the system. A live-updating webpage showing exactly what's happening across the whole cluster in real time, with no manual refresh needed.

---

### `load-test/`

**Detailed:**

- `run.js`:
  - Spins up N concurrent "workers," each looping and firing requests until a shared counter hits zero
  - Randomly picks a key from a 50-key space (for realistic repeat/hit behavior) and randomly rotates between the two demo API keys
  - Mixes ~80% reads / 20% writes
  - Tracks and reports: total requests, successes, errors broken down by HTTP status code, throughput (req/s), hit rate, p50/p95/p99 latency, and per-node request distribution

**Short summary:** The stress-tester and proof of correctness. Generates realistic concurrent traffic through the whole stack and proves the system's actual performance and behavior under load — including surviving a node dying mid-run.

---

One thing still open from earlier — did you land on a name to replace "Meridian"? Once you pick one I'll go through and update it across all the `package.json`s, the dashboard title, and any log strings.
