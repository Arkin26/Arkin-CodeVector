import { pool } from "../src/db/pool.js";
import { SnapshotManager } from "../src/snapshot/SnapshotManager.js";
import type { Product } from "../src/types/product.js";
import { decodeCursor } from "../src/services/cursor.js";

const LIMIT = 20;
const INSERT_COUNT = 50;

function compareProducts(a: Product, b: Product): number {
  const aTime = new Date(a.updated_at).getTime();
  const bTime = new Date(b.updated_at).getTime();
  if (aTime !== bTime) {
    return bTime - aTime;
  }
  return b.id.localeCompare(a.id);
}

function isOlderThan(product: Product, reference: Product): boolean {
  return compareProducts(product, reference) > 0;
}

async function insertDemoProducts(count: number): Promise<void> {
  await pool.query(
    `
    INSERT INTO products (name, category, price, created_at, updated_at)
    SELECT
      'VERIFY-INSERT-' || g.i,
      'electronics',
      99.99,
      now(),
      now()
    FROM generate_series(1, $1) AS g(i)
    `,
    [count],
  );
}

async function verify(): Promise<void> {
  const snapshotManager = new SnapshotManager(pool);
  const allIds: string[] = [];
  const allProducts: Product[] = [];

  console.log("Step 1: Fetch page 1 (create snapshot session)...");
  const page1 = await snapshotManager.listProducts({ limit: LIMIT });
  allProducts.push(...page1.products);
  allIds.push(...page1.products.map((p) => p.id));

  if (page1.products.length !== LIMIT) {
    throw new Error(
      `Expected ${LIMIT} products on page 1, got ${page1.products.length}. Is the DB seeded?`,
    );
  }
  if (!page1.hasNext) {
    throw new Error("Expected has_next on page 1.");
  }

  const snapshot = page1.snapshotId;
  let cursor = page1.products.at(-1);
  if (!cursor) {
    throw new Error("Page 1 returned no cursor product.");
  }

  console.log(`Step 2: Insert ${INSERT_COUNT} new products (would jump to top in live feed)...`);
  await insertDemoProducts(INSERT_COUNT);

  const fetchNextPage = async () => {
    const cursorPayload = {
      updated_at: new Date(cursor!.updated_at).toISOString(),
      id: cursor!.id,
    };
    const encoded = Buffer.from(JSON.stringify(cursorPayload), "utf8").toString(
      "base64url",
    );
    decodeCursor(encoded);

    const page = await snapshotManager.listProducts({
      limit: LIMIT,
      snapshot,
      cursor: cursorPayload,
    });

    allProducts.push(...page.products);
    allIds.push(...page.products.map((p) => p.id));

    if (page.products.length > 0) {
      cursor = page.products.at(-1);
    }

    return page;
  };

  console.log("Step 3: Fetch page 2 within frozen snapshot...");
  const page2 = await fetchNextPage();

  console.log("Step 4: Fetch page 3 within frozen snapshot...");
  const page3 = await fetchNextPage();

  await snapshotManager.shutdownAsync();

  const uniqueIds = new Set(allIds);
  const duplicates = allIds.length - uniqueIds.size;

  const page1Last = page1.products.at(-1)!;
  const orderingViolations = [...page2.products, ...page3.products].filter(
    (product) => !isOlderThan(product, page1Last),
  );

  const demoInsertsInResults = allProducts.filter((p) =>
    p.name.startsWith("VERIFY-INSERT-"),
  );

  console.log("");
  console.log("Results:");
  console.log(`  Pages fetched: 3`);
  console.log(`  Total products collected: ${allIds.length}`);
  console.log(`  Unique IDs: ${uniqueIds.size}`);
  console.log(`  Duplicates: ${duplicates}`);
  console.log(`  Ordering violations: ${orderingViolations.length}`);
  console.log(`  Demo inserts leaked into session: ${demoInsertsInResults.length}`);

  const failures: string[] = [];
  if (duplicates > 0) {
    failures.push(`Found ${duplicates} duplicate ID(s) across pages.`);
  }
  if (allIds.length !== uniqueIds.size) {
    failures.push("Unique ID count does not match total collected.");
  }
  if (orderingViolations.length > 0) {
    failures.push("Page 2/3 contains rows not older than page 1's last row.");
  }
  if (demoInsertsInResults.length > 0) {
    failures.push(
      `${demoInsertsInResults.length} newly inserted row(s) appeared in snapshot session.`,
    );
  }
  if (page2.products.length !== LIMIT) {
    failures.push(`Page 2 size mismatch: expected ${LIMIT}, got ${page2.products.length}.`);
  }

  await pool.query(
    "DELETE FROM products WHERE name LIKE 'VERIFY-INSERT-%'",
  );

  if (failures.length > 0) {
    console.error("");
    console.error("FAIL:");
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    await pool.end();
    process.exit(1);
  }

  console.log("");
  console.log(
    `PASS: ${uniqueIds.size} unique products across 3 pages; ${INSERT_COUNT} inserts ignored mid-session.`,
  );
  await pool.end();
}

verify().catch(async (error) => {
  console.error(error);
  await pool.query("DELETE FROM products WHERE name LIKE 'VERIFY-INSERT-%'").catch(
    () => undefined,
  );
  await pool.end().catch(() => undefined);
  process.exit(1);
});
