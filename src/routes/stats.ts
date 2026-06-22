import type { FastifyInstance } from "fastify";
import { pool } from "../db/pool.js";
import type { SnapshotManager } from "../snapshot/SnapshotManager.js";

export function registerStatsRoutes(
  app: FastifyInstance,
  snapshotManager: SnapshotManager,
): void {
  app.get("/api/stats", async () => {
    const [productCount, categoryCount] = await Promise.all([
      pool.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM products",
      ),
      pool.query<{ count: string }>(
        "SELECT COUNT(DISTINCT category)::text AS count FROM products",
      ),
    ]);

    return {
      product_count: Number(productCount.rows[0]?.count ?? 0),
      active_snapshot_sessions: snapshotManager.getSessionCount(),
      categories: Number(categoryCount.rows[0]?.count ?? 0),
    };
  });
}
