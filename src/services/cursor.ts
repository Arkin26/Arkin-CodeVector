import type { PaginationCursor } from "../types/product.js";

export function encodeCursor(cursor: PaginationCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCursor(encoded: string): PaginationCursor {
  const parsed = JSON.parse(
    Buffer.from(encoded, "base64url").toString("utf8"),
  ) as PaginationCursor;

  if (!parsed.updated_at || !parsed.id) {
    throw new Error("Invalid cursor payload.");
  }

  return parsed;
}
