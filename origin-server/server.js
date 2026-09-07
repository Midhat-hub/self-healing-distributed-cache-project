import express from "express";
import { pool } from "./db.js";

const PORT = process.env.PORT || 4000;
const app = express();
app.use(express.json());

// Health check — used by the Load Balancer's heartbeat loop
app.get("/health", (_req, res) => {
  res.json({ status: "UP", service: "origin-server", time: Date.now() });
});

// GET /origin/products/:id -> called by a cache node on a cache MISS
app.get("/origin/products/:id", async (req, res) => {
  const { id } = req.params;

  const result = await pool.query("SELECT * FROM products WHERE id = $1", [id]);

  if (result.rows.length === 0) {
    console.log(`[origin] GET /products/${id} -> not found`);
    return res.status(404).json({ error: "not_found", id });
  }

  console.log(`[origin] GET /products/${id} -> found`);
  res.json(result.rows[0]);
});

// PUT /origin/products/:id -> updates go straight to the DB (source of truth)
app.put("/origin/products/:id", async (req, res) => {
  const { id } = req.params;
  const { name, price, category, description, stock } = req.body;

  const result = await pool.query(
    `UPDATE products
     SET name = COALESCE($1, name),
         price = COALESCE($2, price),
         category = COALESCE($3, category),
         description = COALESCE($4, description),
         stock = COALESCE($5, stock),
         updated_at = NOW()
     WHERE id = $6
     RETURNING *`,
    [name, price, category, description, stock, id]
  );

  if (result.rows.length === 0) {
    console.log(`[origin] PUT /products/${id} -> not found`);
    return res.status(404).json({ error: "not_found", id });
  }

  console.log(`[origin] PUT /products/${id} -> updated`);
  res.json(result.rows[0]);
});

app.listen(PORT, () => {
  console.log(`[origin-server] listening on http://localhost:${PORT}`);
});