# Consistent Hashing Distributed Cache

A self-healing, distributed caching system built from scratch to demonstrate core distributed systems concepts: consistent hashing, replication, automatic failover, and rebalancing — with an API gateway, load balancer, and live observability dashboard.

## Architecture

Client / Load Test
|
v
API Gateway <- bearer auth, per-key rate limiting
|
v
Load Balancer <- consistent hash ring, heartbeats, failover, /stats
|
v
Cache Nodes (A, B, C) <- in-memory store + TTL, replicates to ring neighbor
| (on miss)
v
Origin Server + Postgres <- source of truth
React Dashboard
polls Load Balancer's /stats every 1.5s

## Features

- **Consistent hashing** with 100 virtual nodes per physical node — adding/removing a node only redistributes a fraction of keys, not all of them
- **Replication** — every write goes to a primary node synchronously and a replica node asynchronously
- **Failure detection** — heartbeats every 2s; a node is marked DOWN after 2 missed beats, UP after 1 success
- **Automatic failover** — reads for a dead node's keys transparently reroute to its replica
- **Automatic rebalancing** — a recovered node is re-inserted into the ring and has its keys copied back live
- **API Gateway** — bearer token auth + per-key token-bucket rate limiting
- **Live dashboard** — real-time hit rate, p50/p95/p99 latency, per-node health, request trends
- **Load test harness** — concurrent, randomized traffic generator with full performance reporting

## Tech Stack

Node.js / Express (all backend services), PostgreSQL (origin database), React + Recharts (dashboard).

## Project Structure

| Folder                                          | Responsibility                                     |
| ----------------------------------------------- | -------------------------------------------------- |
| `origin-server/`                                | Postgres-backed source of truth                    |
| `cache-node/`, `cache-node-b/`, `cache-node-c/` | In-memory cache nodes (3 instances)                |
| `load-balancer/`                                | Hash ring, health monitoring, routing, rebalancing |
| `gateway/`                                      | Auth + rate limiting front door                    |
| `dashboard/`                                    | React observability UI                             |
| `load-test/`                                    | Concurrent load-testing harness                    |

## Setup

Each service needs its own `npm install`. From the root:

```bash
cd origin-server && npm install
cd ../cache-node && npm install
cd ../cache-node-b && npm install
cd ../cache-node-c && npm install
cd ../load-balancer && npm install
cd ../gateway && npm install
cd ../dashboard && npm install
cd ../load-test && npm install
```

You'll also need a local Postgres instance. Create a database and add credentials to `origin-server/.env`:

PGHOST=localhost
PGPORT=5432
PGUSER=postgres
PGPASSWORD=your_password
PGDATABASE=meridian

Seed the database:

```bash
cd origin-server
node init-db.js
```

## Running it

Each service runs as its own process. Open a separate terminal for each:

```bash
cd origin-server && node server.js       # port 4000
cd cache-node && node server.js          # port 5001
cd cache-node-b && node server.js        # port 5002
cd cache-node-c && node server.js        # port 5003
cd load-balancer && node server.js       # port 3000
cd gateway && node server.js             # port 8080
cd dashboard && npm run dev              # http://localhost:5173
```

## Demo: killing a node

1. Run the load test: `cd load-test && node run.js 150 3`
2. While it's running, stop one cache node (`Ctrl+C`)
3. Watch the dashboard — that node's status flips to DOWN within ~4 seconds, and the load test keeps succeeding via automatic failover
4. Restart the node — watch it rejoin the ring and get its keys copied back automatically

## Load Testing

```bash
cd load-test
node run.js <totalRequests> <concurrency>
# e.g. node run.js 200 5
```

Reports throughput, hit rate, latency percentiles (p50/p95/p99), per-node distribution, and errors by status code.

## Out of Scope (by design)

- No quorum/strict consistency — eventually consistent, single replica per key
- No persistence in cache nodes — in-memory only
- No true gossip protocol — the load balancer is a single coordinator
- No real geographic distribution
- LRU/LFU eviction — a stretch goal, unrelated to self-healing
