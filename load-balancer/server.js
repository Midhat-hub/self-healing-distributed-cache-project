import cors from "cors";
import express from "express";
import dotenv from "dotenv";
import { HashRing } from "./hash-ring.js";
import { HealthMonitor } from "./health-monitor.js";

dotenv.config();

const PORT = process.env.PORT || 3000;

const ALL_NODES = [
  { id: "node-A", url: "http://localhost:5001" },
  { id: "node-B", url: "http://localhost:5002" },
  { id: "node-C", url: "http://localhost:5003" },
];

const ring = new HashRing();
ALL_NODES.forEach((node) => ring.addNode(node));

async function rebalanceInto(targetNode) {
  const others = ring.getAllNodes().filter((n) => n.id !== targetNode.id);
  let copied = 0;

  for (const other of others) {
    try {
      const keysRes = await fetch(`${other.url}/keys`);
      const { keys } = await keysRes.json();

      for (const key of keys) {
        const owner = ring.getNode(key);
        if (!owner || owner.id !== targetNode.id) continue;

        const valRes = await fetch(`${other.url}/cache/${key}`);
        if (!valRes.ok) continue;
        const body = await valRes.json();
        if (body.value === undefined) continue;

        await fetch(`${targetNode.url}/cache/${key}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: body.value }),
        });
        copied++;
      }
    } catch (err) {
      console.error(`[rebalance] failed reading keys from ${other.id}:`, err.message);
    }
  }

  console.log(`[rebalance] copied ${copied} key(s) back into ${targetNode.id}`);
}

function handleStatusChange(nodeId, newStatus) {
  if (newStatus === "DOWN") {
    ring.removeNode(nodeId);
    console.log(`[rebalance] removed ${nodeId} from the ring`);
  } else if (newStatus === "UP") {
    const nodeMeta = ALL_NODES.find((n) => n.id === nodeId);
    if (!nodeMeta) return;
    ring.addNode(nodeMeta);
    console.log(`[rebalance] re-added ${nodeId} to the ring, copying keys back...`);
    rebalanceInto(nodeMeta).catch((err) =>
      console.error(`[rebalance] error rebalancing into ${nodeId}:`, err.message)
    );
  }
}

const healthMonitor = new HealthMonitor(ALL_NODES, handleStatusChange);
healthMonitor.start();

const app = express();
app.use(cors());

app.use(express.json());

// --- Stats + structured event log -------------------------------------------
const stats = {
  totalRequests: 0,
  hits: 0,
  misses: 0,
  latencies: [],
  requestsPerNode: {},
};

const MAX_RECENT_REQUESTS = 50; // cap so this never grows unbounded
const recentRequests = [];

function logRequest(entry) {
  recentRequests.unshift({ ...entry, timestamp: new Date().toISOString() });
  if (recentRequests.length > MAX_RECENT_REQUESTS) {
    recentRequests.pop();
  }
}

function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return 0;
  const index = Math.ceil((p / 100) * sortedArr.length) - 1;
  return sortedArr[Math.max(0, Math.min(index, sortedArr.length - 1))];
}

function recordRequest({ nodeId, key, operation, hit, latency, statusCode }) {
  stats.totalRequests++;
  if (hit) stats.hits++;
  else stats.misses++;
  stats.latencies.push(latency);
  stats.requestsPerNode[nodeId] = (stats.requestsPerNode[nodeId] || 0) + 1;

  logRequest({ key, operation, node: nodeId, hit, latency, statusCode });
}

// --- Read path ----------------------------------------------------------------
app.get("/cache/:key", async (req, res) => {
  const { key } = req.params;
  const primary = ring.getNode(key);

  if (!primary) {
    return res.status(503).json({ error: "no_nodes_available" });
  }

  let node = primary;
  let failedOver = false;
  if (!healthMonitor.isUp(primary.id)) {
    const replica = ring.getReplicaNode(key);
    if (replica && healthMonitor.isUp(replica.id)) {
      node = replica;
      failedOver = true;
      console.log(`[lb] ${primary.id} is DOWN, failing over to ${replica.id} for key=${key}`);
    }
  }

  const start = Date.now();
  try {
    const nodeRes = await fetch(`${node.url}/cache/${key}`);
    const body = await nodeRes.json();
    const latency = Date.now() - start;

    if (nodeRes.ok) {
      recordRequest({
        nodeId: node.id,
        key,
        operation: "GET",
        hit: body.hit,
        latency,
        statusCode: nodeRes.status,
      });
    }

    res.status(nodeRes.status).json({ ...body, servedBy: node.id, failedOver });
  } catch (err) {
    console.error(`[lb] failed to reach ${node.id}:`, err.message);
    res.status(502).json({ error: "node_unreachable", node: node.id });
  }
});

// --- Write path -----------------------------------------------------------
app.post("/cache/:key", async (req, res) => {
  const { key } = req.params;
  const { value } = req.body;
  if (value === undefined) {
    return res.status(400).json({ error: "missing_value" });
  }

  const primary = ring.getNode(key);
  const replica = ring.getReplicaNode(key);

  if (!primary) {
    return res.status(503).json({ error: "no_nodes_available" });
  }

  const start = Date.now();
  try {
    const primaryRes = await fetch(`${primary.url}/cache/${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    });
    const primaryBody = await primaryRes.json();
    const latency = Date.now() - start;

    if (primaryRes.ok) {
      recordRequest({
        nodeId: primary.id,
        key,
        operation: "SET",
        hit: null,
        latency,
        statusCode: primaryRes.status,
      });
    }

    if (replica) {
      fetch(`${replica.url}/replicate/${key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      }).catch((err) => {
        console.error(`[lb] async replicate to ${replica.id} failed:`, err.message);
      });
    }

    res.status(primaryRes.status).json({
      ...primaryBody,
      primary: primary.id,
      replica: replica ? replica.id : null,
    });
  } catch (err) {
    console.error(`[lb] failed to write to primary ${primary.id}:`, err.message);
    res.status(502).json({ error: "primary_unreachable", node: primary.id });
  }
});

// --- Stats + recent requests --------------------------------------------------
app.get("/stats", (_req, res) => {
  const { totalRequests, hits, misses, requestsPerNode, latencies } = stats;
  const hitRate = totalRequests ? (hits / totalRequests) * 100 : 0;
  const sorted = [...latencies].sort((a, b) => a - b);

  res.json({
    totalRequests,
    hits,
    misses,
    hitRatePercent: Number(hitRate.toFixed(1)),
    latency: {
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
    },
    requestsPerNode,
    nodes: healthMonitor.getAllStatuses(),
  });
});

app.get("/recent-requests", (_req, res) => {
  res.json({ requests: recentRequests });
});

app.listen(PORT, () => {
  console.log(`[load-balancer] listening on http://localhost:${PORT}`);
});