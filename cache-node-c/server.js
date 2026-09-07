import express from "express";
import dotenv from "dotenv";
import * as cache from "./cache-store.js";

dotenv.config();

const PORT = process.env.PORT || 5001;
const ORIGIN_URL = process.env.ORIGIN_URL || "http://localhost:4000";
const DEFAULT_TTL_SECONDS = 60; // how long a cached product stays fresh

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "UP", service: "cache-node", port: PORT, size: cache.size() });
});

// GET /cache/:key -> check cache first, fall back to origin on a miss
app.get("/cache/:key", async (req, res) => {
  const { key } = req.params;
  const start = Date.now();

  const cached = cache.get(key);
  if (cached !== undefined) {
    const latency = Date.now() - start;
    console.log(`[cache-node:${PORT}] HIT  key=${key} latency=${latency}ms`);
    return res.json({ key, value: cached, hit: true });
  }

  // Miss — go fetch it from the origin server.
  // Our key format is "product:<id>", so pull the id back out to call origin.
  const id = key.split(":")[1];

  try {
    const originRes = await fetch(`${ORIGIN_URL}/origin/products/${id}`);
    if (originRes.status === 404) {
      const latency = Date.now() - start;
      console.log(`[cache-node:${PORT}] MISS key=${key} -> not found in origin latency=${latency}ms`);
      return res.status(404).json({ error: "not_found", key });
    }

    const value = await originRes.json();
    cache.set(key, value, DEFAULT_TTL_SECONDS);

    const latency = Date.now() - start;
    console.log(`[cache-node:${PORT}] MISS key=${key} -> fetched from origin latency=${latency}ms`);
    res.json({ key, value, hit: false });
  } catch (err) {
    console.error(`[cache-node:${PORT}] error reaching origin:`, err.message);
    res.status(502).json({ error: "origin_unreachable" });
  }
});

// SET /cache/:key -> write-through: update origin, then cache the new value
app.post("/cache/:key", async (req, res) => {
  const { key } = req.params;
  const { value } = req.body;
  if (value === undefined) {
    return res.status(400).json({ error: "missing_value" });
  }

  cache.set(key, value, DEFAULT_TTL_SECONDS);
  console.log(`[cache-node:${PORT}] SET key=${key}`);
  res.json({ key, value, cached: true });
});

// DELETE /cache/:key -> just evict it from this node's memory
app.delete("/cache/:key", (req, res) => {
  const { key } = req.params;
  cache.del(key);
  console.log(`[cache-node:${PORT}] DELETE key=${key}`);
  res.status(204).end();
});
// POST /replicate/:key -> internal: another node's LB write landed here
// as this key's replica copy. Not meant to be called by clients directly.
app.post("/replicate/:key", (req, res) => {
  const { key } = req.params;
  const { value } = req.body;
  if (value === undefined) {
    return res.status(400).json({ error: "missing_value" });
  }

  cache.set(key, value, DEFAULT_TTL_SECONDS);
  console.log(`[cache-node:${PORT}] REPLICATE key=${key}`);
  res.json({ key, replicated: true });
});

// GET /keys -> internal: lists every key this node currently holds.
// Used by the Load Balancer to copy keys back when a node rejoins.
app.get("/keys", (_req, res) => {
  res.json({ keys: cache.keys() });
});
app.listen(PORT, () => {
  console.log(`[cache-node] listening on http://localhost:${PORT} (origin: ${ORIGIN_URL})`);
});