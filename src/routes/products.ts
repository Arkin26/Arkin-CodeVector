import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { decodeCursor } from "../services/cursor.js";
import {
  SnapshotCapacityError,
  SnapshotExpiredError,
  SnapshotManager,
  SnapshotNotFoundError,
  buildPageInfo,
} from "../snapshot/SnapshotManager.js";

interface ProductsQuerystring {
  limit?: number;
  category?: string;
  snapshot?: string;
  cursor?: string;
}

export function registerProductRoutes(
  app: FastifyInstance,
  snapshotManager: SnapshotManager,
): void {
  app.get<{ Querystring: ProductsQuerystring }>(
    "/api/products",
    async (request, reply) => {
      const limit = Math.min(
        Math.max(request.query.limit ?? config.defaultPageLimit, 1),
        config.maxPageLimit,
      );
      const { category, snapshot, cursor: cursorParam } = request.query;

      let cursor;
      if (cursorParam) {
        try {
          cursor = decodeCursor(cursorParam);
        } catch {
          return reply.code(400).send({
            error: "invalid_cursor",
            message: "Cursor is malformed. Start a new listing.",
          });
        }
      }

      if (snapshot && !cursor) {
        return reply.code(400).send({
          error: "cursor_required",
          message: "Cursor is required when using a snapshot.",
        });
      }

      try {
        const result = await snapshotManager.listProducts({
          limit,
          category,
          snapshot,
          cursor,
        });

        return {
          data: result.products,
          page_info: buildPageInfo(
            result.snapshotId,
            result.products,
            result.hasNext,
          ),
        };
      } catch (error) {
        if (error instanceof SnapshotExpiredError) {
          return reply.code(410).send({
            error: "snapshot_expired",
            message: error.message,
          });
        }
        if (error instanceof SnapshotNotFoundError) {
          return reply.code(410).send({
            error: "snapshot_not_found",
            message: error.message,
          });
        }
        if (error instanceof SnapshotCapacityError) {
          return reply.code(503).send({
            error: "snapshot_capacity",
            message: error.message,
          });
        }
        throw error;
      }
    },
  );
}
