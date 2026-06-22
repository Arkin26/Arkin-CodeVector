import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../src/db/pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function seed() {
  const countResult = await pool.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM products",
  );
  const existing = Number(countResult.rows[0]?.count ?? 0);

  if (existing > 0) {
    console.log(`Database already has ${existing} products. Skipping seed.`);
    console.log("To re-seed, truncate the table first: TRUNCATE products;");
    await pool.end();
    return;
  }

  const sql = await fs.readFile(path.join(__dirname, "seed.sql"), "utf8");
  const start = Date.now();
  await pool.query(sql);
  const elapsed = Date.now() - start;

  const result = await pool.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM products",
  );
  console.log(`Seeded ${result.rows[0]?.count} products in ${elapsed}ms.`);
  await pool.end();
}

seed().catch((error) => {
  console.error(error);
  process.exit(1);
});
