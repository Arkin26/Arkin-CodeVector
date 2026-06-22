import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../src/db/pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function migrate() {
  const sql = await fs.readFile(
    path.join(__dirname, "..", "migrations", "001_products.sql"),
    "utf8",
  );
  await pool.query(sql);
  console.log("Migration applied.");
  await pool.end();
}

migrate().catch((error) => {
  console.error(error);
  process.exit(1);
});
