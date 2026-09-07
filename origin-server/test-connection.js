import { pool } from "./db.js";

const result = await pool.query("SELECT NOW()");
console.log("Connected to Postgres. Server time:", result.rows[0].now);
await pool.end();