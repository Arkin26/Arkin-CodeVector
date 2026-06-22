import type { FastifyInstance } from "fastify";
import { pool } from "../db/pool.js";

const DEMO_INSERT_COUNT = 50;
const DEMO_UPDATE_COUNT = 50;

export function registerDemoRoutes(app: FastifyInstance): void {
  app.post("/api/demo/insert-products", async () => {
    const result = await pool.query<{ count: string }>(
      `
      WITH inserted AS (
        INSERT INTO products (name, category, price, created_at, updated_at)
        SELECT
          'DEMO-INSERT-' || g.i,
          'electronics',
          99.99,
          now(),
          now()
        FROM generate_series(1, $1) AS g(i)
        RETURNING id
      )
      SELECT COUNT(*)::text AS count FROM inserted
      `,
      [DEMO_INSERT_COUNT],
    );

    const inserted = Number(result.rows[0]?.count ?? 0);
    return {
      inserted,
      message: `${inserted} products inserted with updated_at = now(). Active browse sessions remain frozen.`,
    };
  });

  app.post("/api/demo/update-products", async () => {
    const result = await pool.query<{ count: string }>(
      `
      WITH picked AS (
        SELECT id
        FROM products
        WHERE name NOT LIKE 'DEMO-INSERT-%'
        ORDER BY random()
        LIMIT $1
      ),
      updated AS (
        UPDATE products
        SET updated_at = now()
        WHERE id IN (SELECT id FROM picked)
        RETURNING id
      )
      SELECT COUNT(*)::text AS count FROM updated
      `,
      [DEMO_UPDATE_COUNT],
    );

    const updated = Number(result.rows[0]?.count ?? 0);
    return {
      updated,
      message: `${updated} products updated to updated_at = now(). Active browse sessions remain frozen.`,
    };
  });
}
