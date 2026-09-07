import { pool } from "./db.js";

async function init() {
  // Drop-and-recreate keeps this repeatable while we're still developing
  await pool.query(`DROP TABLE IF EXISTS products`);

  await pool.query(`
    CREATE TABLE products (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      price NUMERIC(10, 2) NOT NULL,
      category TEXT NOT NULL,
      description TEXT,
      stock INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  console.log("Table 'products' created.");

  const categories = ["Electronics", "Books", "Clothing", "Home", "Sports"];

  for (let i = 1; i <= 100; i++) {
    const category = categories[i % categories.length];
    await pool.query(
      `INSERT INTO products (name, price, category, description, stock)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        `${category} Item ${i}`,
        (Math.random() * 200 + 5).toFixed(2),
        category,
        `Sample description for ${category.toLowerCase()} item ${i}.`,
        Math.floor(Math.random() * 100),
      ]
    );
  }

  console.log("Seeded 100 sample products.");
  await pool.end();
}

init().catch((err) => {
  console.error("Failed to init DB:", err);
  process.exit(1);
});