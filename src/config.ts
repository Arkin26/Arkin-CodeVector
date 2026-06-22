export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgresql://products:products@localhost:5433/products",
  snapshotTtlMs: Number(process.env.SNAPSHOT_TTL_MS ?? 15 * 60 * 1000),
  maxSnapshotSessions: Number(process.env.MAX_SNAPSHOT_SESSIONS ?? 100),
  defaultPageLimit: 20,
  maxPageLimit: 100,
  demoMode: process.env.DEMO_MODE === "true",
};
