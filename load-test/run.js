import dotenv from "dotenv";
dotenv.config();

const GATEWAY_URL = process.env.GATEWAY_URL || "http://localhost:8080";

// A couple of demo API keys, mirroring the Gateway's hardcoded set,
// so we can also exercise per-key rate limiting if desired.
const API_KEYS = ["key-alice", "key-bob"];

// --- Config -------------------------------------------------------------
const TOTAL_REQUESTS = Number(process.argv[2]) || 200;
const CONCURRENCY = Number(process.argv[3]) || 5; // how many requests in flight at once
const KEY_SPACE = 50; // product:1 .. product:50, keeps enough repeats for real hit rate
const WRITE_RATIO = 0.2; // ~20% of requests are writes (SET), rest are reads (GET)

// --- Results tracking -----------------------------------------------------
const results = {
  total: 0,
  success: 0,
  errorsByStatus: {}, // e.g. { 429: 176, 502: 3 }
  hits: 0,
  misses: 0,
  latencies: [],
  perNode: {},
};

function pickApiKey() {
  return API_KEYS[Math.floor(Math.random() * API_KEYS.length)];
}

function pickKey() {
  const id = Math.floor(Math.random() * KEY_SPACE) + 1;
  return `product:${id}`;
}

async function doRead(key, apiKey) {
  const start = Date.now();
  const res = await fetch(`${GATEWAY_URL}/cache/${key}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const latency = Date.now() - start;
  const body = await res.json().catch(() => ({}));
  return { res, body, latency };
}

async function doWrite(key, apiKey) {
  const start = Date.now();
  const res = await fetch(`${GATEWAY_URL}/cache/${key}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ value: { note: "load-test write", ts: Date.now() } }),
  });
  const latency = Date.now() - start;
  const body = await res.json().catch(() => ({}));
  return { res, body, latency };
}

async function fireOne() {
  const key = pickKey();
  const apiKey = pickApiKey();
  const isWrite = Math.random() < WRITE_RATIO;

  try {
    const { res, body, latency } = isWrite
      ? await doWrite(key, apiKey)
      : await doRead(key, apiKey);

    results.total++;
    results.latencies.push(latency);

    if (res.ok) {
      results.success++;
      if (typeof body.hit === "boolean") {
        if (body.hit) results.hits++;
        else results.misses++;
      }
      const nodeId = body.servedBy || body.primary;
      if (nodeId) {
        results.perNode[nodeId] = (results.perNode[nodeId] || 0) + 1;
      }
    } else {
      results.errorsByStatus[res.status] = (results.errorsByStatus[res.status] || 0) + 1;
    }
  } catch (err) {
    results.total++;
    results.errorsByStatus["network"] = (results.errorsByStatus["network"] || 0) + 1;
  }
}

function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return 0;
  const index = Math.ceil((p / 100) * sortedArr.length) - 1;
  return sortedArr[Math.max(0, Math.min(index, sortedArr.length - 1))];
}

async function worker(requestsRemainingRef) {
  while (requestsRemainingRef.count > 0) {
    requestsRemainingRef.count--;
    await fireOne();
  }
}

async function main() {
  console.log(`[load-test] firing ${TOTAL_REQUESTS} requests, concurrency=${CONCURRENCY}`);
  console.log(`[load-test] target: ${GATEWAY_URL}`);

  const startTime = Date.now();
  const requestsRemainingRef = { count: TOTAL_REQUESTS };

  const workers = Array.from({ length: CONCURRENCY }, () => worker(requestsRemainingRef));
  await Promise.all(workers);

  const durationSeconds = (Date.now() - startTime) / 1000;
  const sortedLatencies = [...results.latencies].sort((a, b) => a - b);
  const throughput = results.total / durationSeconds;
  const hitTotal = results.hits + results.misses;
  const hitRate = hitTotal ? (results.hits / hitTotal) * 100 : 0;

  console.log("\n--- Load Test Results ---");
  console.log(`Duration:        ${durationSeconds.toFixed(2)}s`);
  console.log(`Total requests:  ${results.total}`);
  console.log(`Successful:      ${results.success}`);
  console.log(`Errors by status:`, results.errorsByStatus);
  console.log(`Throughput:      ${throughput.toFixed(1)} req/s`);
  console.log(`Hit rate:        ${hitRate.toFixed(1)}%  (${results.hits} hits / ${results.misses} misses)`);
  console.log(`Latency p50:     ${percentile(sortedLatencies, 50)}ms`);
  console.log(`Latency p95:     ${percentile(sortedLatencies, 95)}ms`);
  console.log(`Latency p99:     ${percentile(sortedLatencies, 99)}ms`);
  console.log("Per-node distribution:", results.perNode);
}

main();