import { useState, useEffect } from "react";

const LB_URL = "http://localhost:3000";
const POLL_INTERVAL_MS = 1500;

// Polls the Load Balancer's /stats and /recent-requests endpoints on an
// interval, and keeps a short rolling history of stats snapshots so the
// dashboard can chart trends over time, not just show the latest number.
export function useStats() {
  const [stats, setStats] = useState(null);
  const [recentRequests, setRecentRequests] = useState([]);
  const [history, setHistory] = useState([]); // array of { time, totalRequests, hitRatePercent }
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const [statsRes, requestsRes] = await Promise.all([
          fetch(`${LB_URL}/stats`),
          fetch(`${LB_URL}/recent-requests`),
        ]);
        const statsData = await statsRes.json();
        const requestsData = await requestsRes.json();

        if (cancelled) return;

        setStats(statsData);
        setRecentRequests(requestsData.requests);
        setError(null);

        setHistory((prev) => {
          const next = [
            ...prev,
            {
              time: new Date().toLocaleTimeString(),
              totalRequests: statsData.totalRequests,
              hitRatePercent: statsData.hitRatePercent,
            },
          ];
          // Keep only the last 30 points so the chart doesn't grow forever
          return next.slice(-30);
        });
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    }

    poll(); // fetch immediately on mount, don't wait for the first interval tick
    const id = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return { stats, recentRequests, history, error };
}