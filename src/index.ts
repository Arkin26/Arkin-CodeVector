import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { pool } from "./db/pool.js";
import { SnapshotManager } from "./snapshot/SnapshotManager.js";
import { registerProductRoutes } from "./routes/products.js";
import { registerCategoryRoutes } from "./routes/categories.js";
import { registerStatsRoutes } from "./routes/stats.js";
import { registerDemoRoutes } from "./routes/demo.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const app = Fastify({ logger: true });
  const snapshotManager = new SnapshotManager(pool);

  registerProductRoutes(app, snapshotManager);
  registerCategoryRoutes(app);
  registerStatsRoutes(app, snapshotManager);

  if (config.demoMode) {
    registerDemoRoutes(app);
    app.log.info("Demo routes enabled (DEMO_MODE=true)");
  }

  await app.register(fastifyStatic, {
    root: path.join(__dirname, "..", "public"),
    prefix: "/",
  });

  app.addHook("onClose", async () => {
    await snapshotManager.shutdownAsync();
    await pool.end();
  });

  await app.listen({ port: config.port, host: "0.0.0.0" });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
