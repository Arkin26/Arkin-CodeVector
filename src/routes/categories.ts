import type { FastifyInstance } from "fastify";
import { pool } from "../db/pool.js";
import { listCategories } from "../services/productService.js";

export function registerCategoryRoutes(app: FastifyInstance): void {
  app.get("/api/categories", async () => {
    const categories = await listCategories(pool);
    return { data: categories };
  });
}
