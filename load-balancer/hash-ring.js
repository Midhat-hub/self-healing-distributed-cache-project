import crypto from "node:crypto";

// A consistent hash ring using virtual nodes for even distribution.
//
// Idea: hash both keys and (virtual) node positions onto the same numeric
// circle (0 .. 2^32-1). A key belongs to whichever node's virtual point is
// the *next one clockwise* from the key's own hash position.
//
// Virtual nodes (~100 per physical node) exist purely so that each physical
// node ends up owning many small, scattered arcs of the ring instead of one
// big arc — which is what makes the request distribution even across nodes.

const VIRTUAL_NODES_PER_NODE = 100;

function hashToInt(str) {
  // md5 is fine here — we're not doing anything security-sensitive,
  // just need a well-distributed number from a string.
  const hash = crypto.createHash("md5").update(str).digest("hex");
  // Take the first 8 hex chars -> a 32-bit unsigned integer
  return parseInt(hash.slice(0, 8), 16);
}

export class HashRing {
  constructor() {
    // Sorted array of { point, nodeId } - the ring itself
    this.ring = [];
    // nodeId -> node metadata (url etc.), so the ring only stores ids
    this.nodes = new Map();
  }

  addNode(node) {
    this.nodes.set(node.id, node);
    for (let i = 0; i < VIRTUAL_NODES_PER_NODE; i++) {
      const point = hashToInt(`${node.id}#${i}`);
      this.ring.push({ point, nodeId: node.id });
    }
    this.ring.sort((a, b) => a.point - b.point);
  }

  removeNode(nodeId) {
    this.nodes.delete(nodeId);
    this.ring = this.ring.filter((entry) => entry.nodeId !== nodeId);
  }

  // Returns the node object that owns this key ("primary")
  getNode(key) {
    if (this.ring.length === 0) return undefined;

    const point = hashToInt(key);
    // Find the first ring entry with point >= key's point (walk clockwise).
    // If we run off the end, wrap around to the first entry.
    let entry = this.ring.find((e) => e.point >= point);
    if (!entry) entry = this.ring[0];

    return this.nodes.get(entry.nodeId);
  }

  // Returns the *next distinct* node clockwise after the primary — used as
  // the replica target so a key's primary and replica are never the same node.
  getReplicaNode(key) {
    const primary = this.getNode(key);
    if (!primary || this.nodes.size < 2) return undefined;

    const point = hashToInt(key);
    let startIndex = this.ring.findIndex((e) => e.point >= point);
    if (startIndex === -1) startIndex = 0;

    for (let i = 0; i < this.ring.length; i++) {
      const idx = (startIndex + i) % this.ring.length;
      const candidate = this.nodes.get(this.ring[idx].nodeId);
      if (candidate && candidate.id !== primary.id) {
        return candidate;
      }
    }
    return undefined;
  }

  getAllNodes() {
    return Array.from(this.nodes.values());
  }
}