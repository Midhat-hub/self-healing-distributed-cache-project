import { useStats } from "./useStats";
import "./App.css";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

function StatCard({ label, value, sublabel }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sublabel && <div className="stat-sublabel">{sublabel}</div>}
    </div>
  );
}

function NodeStatusPanel({ nodes }) {
  return (
    <div className="node-panel">
      {nodes.map((node) => (
        <div
          key={node.id}
          className={`node-badge node-${node.status.toLowerCase()}`}
        >
          <span className="node-id">{node.id}</span>
          <span className="node-status">{node.status}</span>
          {node.missedBeats > 0 && (
            <span className="node-missed">missed: {node.missedBeats}</span>
          )}
        </div>
      ))}
    </div>
  );
}

function TrendChart({ history }) {
  return (
    <div className="chart-container">
      <ResponsiveContainer width="100%" height={250}>
        <LineChart data={history}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="time" tick={{ fontSize: 11 }} />
          <YAxis yAxisId="left" />
          <YAxis yAxisId="right" orientation="right" domain={[0, 100]} />
          <Tooltip />
          <Legend />
          <Line
            yAxisId="left"
            type="monotone"
            dataKey="totalRequests"
            stroke="#2e7d32"
            name="Total Requests"
            dot={false}
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="hitRatePercent"
            stroke="#1565c0"
            name="Hit Rate %"
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
export default function App() {
  const { stats, history, error } = useStats();

  if (error) {
    return (
      <div className="app">
        <h1>Meridian Dashboard</h1>
        <p className="error">Couldn't reach the Load Balancer: {error}</p>
        <p>Make sure the Load Balancer is running on port 3000.</p>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="app">
        <h1>Meridian Dashboard</h1>
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="app">
      <h1>Dashboard</h1>

      <div className="stat-grid">
        <StatCard label="Total Requests" value={stats.totalRequests} />
        <StatCard label="Hit Rate" value={`${stats.hitRatePercent}%`} />
        <StatCard label="p50 Latency" value={`${stats.latency.p50}ms`} />
        <StatCard label="p95 Latency" value={`${stats.latency.p95}ms`} />
        <StatCard label="p99 Latency" value={`${stats.latency.p99}ms`} />
      </div>

      <h2>Node Status</h2>
      <NodeStatusPanel nodes={stats.nodes} />
      <h2>Trends</h2>
      <TrendChart history={history} />
    </div>
  );
}
