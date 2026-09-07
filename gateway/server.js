import express from "express";
import dotenv from "dotenv";
import { TokenBucketLimiter } from "./token-bucket.js";

dotenv.config();

const PORT = process.env.PORT || 8080;
const LB_URL = process.env.LB_URL || "http://localhost:3000";

// Hardcoded API keys for the demo. Real systems would store these in a DB.
const VALID_API_KEYS = new Set(["key-alice", "key-bob"]);

const limiter = new TokenBucketLimiter({ capacity: 50, refillPerSecond: 5 });

const app = express();
app.use(express.json());

// --- Structured request log, same pattern as the Load Balancer -------------
const MAX_LOG_ENTRIES = 50;
const requestLog = [];

function logRequest(entry) {
  requestLog.unshift({ ...entry, timestamp: new Date().toISOString() });
  if (requestLog.length > MAX_LOG_ENTRIES) requestLog.pop();
}

// --- Auth + rate limit middleware -------------------------------------------
function authenticate(req, res, next) {
  const authHeader = req.headers["authorization"];
  const apiKey = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!apiKey || !VALID_API_KEYS.has(apiKey)) {
    logRequest({
      apiKey: apiKey || "none",
      endpoint: req.originalUrl,
      statusCode: 401,
      latency: 0,
    });
    return res.status(401).json({ error: "unauthorized", message: "Missing or invalid API key" });
  }

  req.apiKey = apiKey;
  next();
}

function rateLimit(req, res, next) {
  const allowed = limiter.tryConsume(req.apiKey);

  if (!allowed) {
    logRequest({
      apiKey: req.apiKey,
      endpoint: req.originalUrl,
      statusCode: 429,
      latency: 0,
    });
    return res.status(429).json({
      error: "rate_limited",
      message: "Too many requests. Slow down.",
      remainingTokens: 0,
    });
  }

  next();
}

app.use(authenticate);
app.use(rateLimit);

// --- Forward everything else through to the Load Balancer ------------------
app.get("/cache/:key", async (req, res) => {
  const { key } = req.params;
  const start = Date.now();

  try {
    const lbRes = await fetch(`${LB_URL}/cache/${key}`);
    const body = await lbRes.json();
    const latency = Date.now() - start;

    logRequest({ apiKey: req.apiKey, endpoint: req.originalUrl, statusCode: lbRes.status, latency });
    res.status(lbRes.status).json(body);
  } catch (err) {
    console.error("[gateway] failed to reach load balancer:", err.message);
    res.status(502).json({ error: "load_balancer_unreachable" });
  }
});

app.post("/cache/:key", async (req, res) => {
  const { key } = req.params;
  const start = Date.now();

  try {
    const lbRes = await fetch(`${LB_URL}/cache/${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
    const body = await lbRes.json();
    const latency = Date.now() - start;

    logRequest({ apiKey: req.apiKey, endpoint: req.originalUrl, statusCode: lbRes.status, latency });
    res.status(lbRes.status).json(body);
  } catch (err) {
    console.error("[gateway] failed to reach load balancer:", err.message);
    res.status(502).json({ error: "load_balancer_unreachable" });
  }
});

app.get("/gateway-logs", (_req, res) => {
  res.json({ requests: requestLog });
});

app.listen(PORT, () => {
  console.log(`[gateway] listening on http://localhost:${PORT} (LB: ${LB_URL})`);
});
