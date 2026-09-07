// Tracks UP/DOWN status per node via periodic heartbeats, and announces
// transitions (not every heartbeat) via an onStatusChange callback.
//
// Rules (from the spec):
// - Ping each node's /health roughly every 2 seconds
// - Mark a node DOWN after 2 consecutive missed beats
// - Mark it UP again after just 1 successful beat (fast recovery)

const HEARTBEAT_INTERVAL_MS = 2000;
const MISSED_BEATS_TO_MARK_DOWN = 2;
const HEALTH_CHECK_TIMEOUT_MS = 1500; // don't let a hung node stall the loop

export class HealthMonitor {
  constructor(nodes, onStatusChange = () => {}) {
    // nodeId -> { url, status, missedBeats }
    this.status = new Map();
    this.onStatusChange = onStatusChange;
    nodes.forEach((node) => {
      this.status.set(node.id, { url: node.url, status: "UP", missedBeats: 0 });
    });
  }

  isUp(nodeId) {
    const entry = this.status.get(nodeId);
    return entry ? entry.status === "UP" : false;
  }

  getAllStatuses() {
    return Array.from(this.status.entries()).map(([id, s]) => ({
      id,
      status: s.status,
      missedBeats: s.missedBeats,
    }));
  }

  async checkNode(nodeId) {
    const entry = this.status.get(nodeId);
    if (!entry) return;

    try {
      const res = await fetch(`${entry.url}/health`, {
        signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
      });

      if (res.ok) {
        if (entry.status === "DOWN") {
          console.log(`[health] ${nodeId} recovered -> UP`);
          entry.status = "UP";
          entry.missedBeats = 0;
          this.onStatusChange(nodeId, "UP");
        } else {
          entry.status = "UP";
          entry.missedBeats = 0;
        }
      } else {
        this._recordMiss(nodeId, entry);
      }
    } catch (err) {
      // Connection refused, timeout, DNS failure — all count as a missed beat
      this._recordMiss(nodeId, entry);
    }
  }

  _recordMiss(nodeId, entry) {
    entry.missedBeats++;
    if (entry.missedBeats >= MISSED_BEATS_TO_MARK_DOWN && entry.status !== "DOWN") {
      entry.status = "DOWN";
      console.log(`[health] ${nodeId} marked DOWN after ${entry.missedBeats} missed beats`);
      this.onStatusChange(nodeId, "DOWN");
    }
  }

  start() {
    setInterval(() => {
      for (const nodeId of this.status.keys()) {
        this.checkNode(nodeId);
      }
    }, HEARTBEAT_INTERVAL_MS);
    console.log(`[health] heartbeat loop started (every ${HEARTBEAT_INTERVAL_MS}ms)`);
  }
}