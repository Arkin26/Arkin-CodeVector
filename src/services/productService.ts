import type { PaginationCursor, Product } from "../types/product.js";
import { encodeCursor } from "./cursor.js";

interface QueryParts {
  text: string;
  values: unknown[];
}

interface BuildQueryOptions {
  limit: number;
  category?: string;
  cursor?: PaginationCursor;
}

export function buildProductQuery(options: BuildQueryOptions): QueryParts {
  const values: unknown[] = [];
  const whereClauses: string[] = [];
  let paramIndex = 1;

  if (options.category) {
    whereClauses.push(`category = $${paramIndex++}`);
    values.push(options.category);
  }

  if (options.cursor) {
    whereClauses.push(
      `(updated_at, id) < ($${paramIndex++}::timestamptz, $${paramIndex++}::uuid)`,
    );
    values.push(options.cursor.updated_at, options.cursor.id);
  }

  const whereSql =
    whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

  values.push(options.limit + 1);
  const limitParam = `$${paramIndex}`;

  const text = `
    SELECT id, name, category, price::text, created_at, updated_at
    FROM products
    ${whereSql}
    ORDER BY updated_at DESC, id DESC
    LIMIT ${limitParam}
  `;

  return { text, values };
}

export function mapProductRows(
  rows: Product[],
  limit: number,
): { products: Product[]; hasNext: boolean } {
  const hasNext = rows.length > limit;
  const products = hasNext ? rows.slice(0, limit) : rows;
  return { products, hasNext };
}

export function toNextCursor(product: Product): string {
  return encodeCursor({
    updated_at: new Date(product.updated_at).toISOString(),
    id: product.id,
  });
}

export async function listCategories(pool: {
  query: (text: string) => Promise<{ rows: Array<{ category: string }> }>;
}): Promise<string[]> {
  const result = await pool.query(
    "SELECT DISTINCT category FROM products ORDER BY category",
  );
  return result.rows.map((row) => row.category);
}
