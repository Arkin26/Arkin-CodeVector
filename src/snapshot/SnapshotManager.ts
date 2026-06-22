import type pg from "pg";
import { config } from "../config.js";
import type { PaginationCursor, Product, ProductQueryOptions } from "../types/product.js";
import {
  buildProductQuery,
  mapProductRows,
  toNextCursor,
} from "../services/productService.js";

interface SnapshotSession {
  client: pg.PoolClient;
  snapshotId: string;
  createdAt: number;
  expiresAt: number;
}

export class SnapshotExpiredError extends Error {
  constructor() {
    super("Snapshot session expired. Start a new listing.");
    this.name = "SnapshotExpiredError";
  }
}

export class SnapshotNotFoundError extends Error {
  constructor() {
    super("Snapshot session not found. Start a new listing.");
    this.name = "SnapshotNotFoundError";
  }
}

export class SnapshotCapacityError extends Error {
  constructor() {
    super("Too many active browse sessions. Try again shortly.");
    this.name = "SnapshotCapacityError";
  }
}

const SNAPSHOT_ID_PATTERN = /^[0-9A-F]+-[0-9A-F]+-[0-9]+$/i;

export function assertValidSnapshotId(snapshotId: string): void {
  if (!SNAPSHOT_ID_PATTERN.test(snapshotId)) {
    throw new SnapshotNotFoundError();
  }
}

export class SnapshotManager {
  private sessions = new Map<string, SnapshotSession>();
  private cleanupTimer: NodeJS.Timeout;

  constructor(private readonly pool: pg.Pool) {
    this.cleanupTimer = setInterval(() => this.cleanupExpired(), 60_000);
    this.cleanupTimer.unref();
  }

  shutdown(): void {
    clearInterval(this.cleanupTimer);
    for (const session of this.sessions.values()) {
      session.client.release();
    }
    this.sessions.clear();
  }

  async listProducts(
    options: ProductQueryOptions,
  ): Promise<{ products: Product[]; snapshotId: string; hasNext: boolean }> {
    if (options.snapshot) {
      return this.paginateWithinSnapshot(options);
    }
    return this.createSession(options);
  }

  private async createSession(
    options: ProductQueryOptions,
  ): Promise<{ products: Product[]; snapshotId: string; hasNext: boolean }> {
    if (this.sessions.size >= config.maxSnapshotSessions) {
      throw new SnapshotCapacityError();
    }

    const client = await this.pool.connect();
    const now = Date.now();
    const expiresAt = now + config.snapshotTtlMs;

    try {
      await client.query(
        "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
      );
      const snapshotResult = await client.query<{ snapshot: string }>(
        "SELECT pg_export_snapshot() AS snapshot",
      );
      const snapshotId = snapshotResult.rows[0]?.snapshot;
      if (!snapshotId) {
        throw new Error("Failed to export PostgreSQL snapshot.");
      }

      const { text, values } = buildProductQuery({
        limit: options.limit,
        category: options.category,
      });
      const result = await client.query(text, values);
      const { products, hasNext } = mapProductRows(result.rows, options.limit);

      this.sessions.set(snapshotId, {
        client,
        snapshotId,
        createdAt: now,
        expiresAt,
      });

      return { products, snapshotId, hasNext };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
      throw error;
    }
  }

  private async paginateWithinSnapshot(
    options: ProductQueryOptions,
  ): Promise<{ products: Product[]; snapshotId: string; hasNext: boolean }> {
    assertValidSnapshotId(options.snapshot!);
    const session = this.sessions.get(options.snapshot!);
    if (!session) {
      throw new SnapshotNotFoundError();
    }
    if (Date.now() > session.expiresAt) {
      this.releaseSession(options.snapshot!);
      throw new SnapshotExpiredError();
    }
    if (!options.cursor) {
      throw new Error("Cursor is required when using a snapshot.");
    }

    const client = await this.pool.connect();
    try {
      await client.query(
        "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
      );
      await client.query(
        `SET TRANSACTION SNAPSHOT '${session.snapshotId}'`,
      );

      const { text, values } = buildProductQuery({
        limit: options.limit,
        category: options.category,
        cursor: options.cursor,
      });
      const result = await client.query(text, values);
      const { products, hasNext } = mapProductRows(result.rows, options.limit);

      await client.query("COMMIT");
      return {
        products,
        snapshotId: session.snapshotId,
        hasNext,
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private releaseSession(snapshotId: string): void {
    const session = this.sessions.get(snapshotId);
    if (!session) {
      return;
    }
    session.client.query("ROLLBACK").catch(() => undefined);
    session.client.release();
    this.sessions.delete(snapshotId);
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [snapshotId, session] of this.sessions.entries()) {
      if (now > session.expiresAt) {
        this.releaseSession(snapshotId);
      }
    }
  }
}

export function buildPageInfo(
  snapshotId: string,
  products: Product[],
  hasNext: boolean,
): { snapshot: string; next_cursor: string | null; has_next: boolean } {
  const lastProduct = products.at(-1);
  return {
    snapshot: snapshotId,
    next_cursor:
      hasNext && lastProduct ? toNextCursor(lastProduct) : null,
    has_next: hasNext,
  };
}
