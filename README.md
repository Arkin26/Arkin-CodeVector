# Product Browse Backend — Full Project Reference

> **Purpose of this document:** This README is written to be self-contained. If you paste this entire file into any AI assistant, it should have enough context to understand, explain, debug, or extend this project without reading other files first.

---

## 1. What this project is

This is a **full-stack developer take-home assignment** implementation: a small backend that lets users browse **~200,000 products** sorted **newest first**, **filter by category**, and **paginate quickly** — while guaranteeing that if data changes during browsing (e.g. 50 products added or updated), the user **never sees the same product twice** and **never misses a product** within their browse session.

There is also an **optional simple UI** (`public/index.html`) for manual testing. The assignment grades the backend, not the UI.

**Repository name:** `codevector-product-browse`

---

## 2. Assignment requirements → implementation status

| Requirement | Status | How it's implemented |
|-------------|--------|----------------------|
| Browse ~200k products, newest first | ✅ | `ORDER BY updated_at DESC, id DESC` |
| Filter by category | ✅ | `?category=` query param + `GET /api/categories` |
| Fast pagination | ✅ | Keyset (cursor) pagination + composite indexes, no `OFFSET` |
| No duplicates/misses while data changes | ✅ | PostgreSQL snapshot + keyset pagination |
| Python or Node.js | ✅ | Node.js + TypeScript |
| Any database | ✅ | PostgreSQL 16 |
| Seed 200k products with id, name, category, price, created_at, updated_at | ✅ | `scripts/seed.sql` via `generate_series` |
| Fast seed (not row-by-row loop) | ✅ | Single bulk `INSERT … SELECT` (~1–2 seconds) |
| Seed script committed to repo | ✅ | `scripts/seed.sql` + `scripts/seed.ts` |
| Bonus: simple UI | ✅ | `public/index.html` (vanilla HTML/JS) |

**Intentionally NOT built:**
- User authentication
- Admin CRUD / write APIs for products
- Offset-based pagination (`LIMIT/OFFSET`)
- Live feed that interleaves new rows mid-pagination (conflicts with consistency requirement)
- ORM (uses raw SQL via `pg` driver)
- Redis / Elasticsearch (Postgres snapshots are sufficient)

---

## 3. Tech stack

| Layer | Technology | Version / notes |
|-------|------------|-----------------|
| Runtime | Node.js | ES modules (`"type": "module"`) |
| Language | TypeScript | Strict mode, compiles to `dist/` |
| HTTP framework | Fastify | v5 |
| Database | PostgreSQL | 16, via Docker Compose |
| DB driver | `pg` | Connection pool, raw SQL |
| Static files | `@fastify/static` | Serves `public/` |
| Dev runner | `tsx` | Hot reload for development |
| Container | Docker Compose | Postgres on host port **5433** (not 5432) |

**Why port 5433?** Many Macs already run Postgres on 5432. Docker maps `5433:5432` to avoid conflicts. The default `DATABASE_URL` uses port 5433.

---

## 4. Quick start

**Prerequisites:** Node.js 18+, Docker Desktop running.

```bash
# 1. Start Postgres
docker compose up -d

# 2. Install dependencies
npm install

# 3. Create table + indexes
npm run migrate

# 4. Insert 200,000 products
npm run seed

# 5. Start dev server
npm run dev
```

- **API:** http://localhost:3000/api/products
- **UI:** http://localhost:3000
- **Categories:** http://localhost:3000/api/categories

**Production build:**
```bash
npm run build
npm start
```

**Re-seed from scratch:**
```sql
TRUNCATE products;
```
Then `npm run seed`.

---

## 5. Environment variables

All optional. Defined in `src/config.ts`.

| Variable | Default | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | `postgresql://products:products@localhost:5433/products` | Postgres connection string |
| `PORT` | `3000` | HTTP server port |
| `SNAPSHOT_TTL_MS` | `900000` (15 min) | How long a browse session snapshot stays valid |
| `MAX_SNAPSHOT_SESSIONS` | `100` | Max concurrent snapshot sessions (each holds 1 DB connection) |

---

## 6. Project structure (every file explained)

```
codevector/
├── docker-compose.yml       # Postgres 16 container, port 5433→5432
├── package.json               # Dependencies and npm scripts
├── tsconfig.json              # TypeScript config (src/ → dist/)
├── README.md                  # This file
│
├── migrations/
│   └── 001_products.sql       # CREATE TABLE products + 2 indexes
│
├── scripts/
│   ├── migrate.ts             # Runs 001_products.sql against DATABASE_URL
│   ├── seed.sql               # Bulk INSERT of 200k rows via generate_series
│   └── seed.ts                # Runs seed.sql; skips if rows already exist
│
├── public/
│   └── index.html             # Optional browse UI (vanilla HTML/CSS/JS)
│
└── src/
    ├── index.ts               # App entry: Fastify boot, routes, static files, shutdown hooks
    ├── config.ts              # Env-based configuration
    │
    ├── db/
    │   └── pool.ts            # pg.Pool singleton + withClient() helper
    │
    ├── types/
    │   └── product.ts         # TypeScript interfaces: Product, PaginationCursor, PageInfo, etc.
    │
    ├── routes/
    │   ├── products.ts        # GET /api/products — HTTP layer only
    │   └── categories.ts      # GET /api/categories
    │
    ├── services/
    │   ├── productService.ts  # SQL query builder, row mapping, category list
    │   └── cursor.ts          # base64url encode/decode for pagination cursors
    │
    └── snapshot/
        └── SnapshotManager.ts # Core consistency layer: PG snapshot sessions
```

### Layer responsibilities (important for making changes)

| Layer | Files | Responsibility |
|-------|-------|----------------|
| **routes/** | `products.ts`, `categories.ts` | Parse HTTP params, return status codes, call services |
| **services/** | `productService.ts`, `cursor.ts` | Business logic: build SQL, encode cursors |
| **snapshot/** | `SnapshotManager.ts` | Pagination consistency: export/import PG snapshots |
| **db/** | `pool.ts` | Database connection management |
| **types/** | `product.ts` | Shared TypeScript interfaces |

**Rule:** Don't put SQL or snapshot logic in routes. Don't put HTTP concerns in services.

---

## 7. Database schema

**Table: `products`**

```sql
CREATE TABLE products (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  category    TEXT NOT NULL,
  price       NUMERIC(10, 2) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Indexes (required for fast pagination):**

```sql
-- Unfiltered browse (all products)
CREATE INDEX idx_products_updated_id
  ON products (updated_at DESC, id DESC);

-- Category-filtered browse
CREATE INDEX idx_products_category_updated_id
  ON products (category, updated_at DESC, id DESC);
```

**Seed data characteristics:**
- 200,000 rows
- Names: `Product 1`, `Product 2`, … `Product 200000`
- 10 categories cycling: electronics, books, clothing, home, sports, toys, garden, automotive, health, food
- Random prices between $0.99 and ~$500.99
- Random `created_at` within last 365 days
- Random `updated_at` within last 30 days
- Many products share the same category/timestamp values (by design)

---

## 8. API reference

### `GET /api/products`

List products with snapshot-based pagination.

**Query parameters:**

| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `limit` | No | 20 | Page size (min 1, max 100) |
| `category` | No | — | Filter to one category |
| `snapshot` | Page 2+ | — | Snapshot token from `page_info.snapshot` on page 1 |
| `cursor` | Page 2+ | — | Cursor token from `page_info.next_cursor` on previous page |

**Page 1 request (starts new browse session):**
```bash
curl "http://localhost:3000/api/products?limit=20"
curl "http://localhost:3000/api/products?category=electronics&limit=20"
```

**Page 2+ request (continues same browse session):**
```bash
curl "http://localhost:3000/api/products?limit=20&snapshot=0000000A-0000000B-1&cursor=eyJ1cGRhdGVkX2F0IjoiLi4uIn0"
```

**Success response (200):**
```json
{
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "Product 12345",
      "category": "electronics",
      "price": "42.50",
      "created_at": "2025-01-15T10:30:00.000Z",
      "updated_at": "2025-06-01T08:00:00.000Z"
    }
  ],
  "page_info": {
    "snapshot": "0000000A-0000000B-1",
    "next_cursor": "eyJ1cGRhdGVkX2F0IjoiMjAyNS0wNi0wMVQwODowMDowMC4wMDBaIiwiaWQiOiI1NTBlODQwMC1lMjliLTQxZDQtYTcxNi00NDY2NTU0NDAwMDAifQ",
    "has_next": true
  }
}
```

**Cursor format:** base64url-encoded JSON: `{ "updated_at": "ISO-8601 string", "id": "uuid" }`

**Snapshot format:** Raw PostgreSQL snapshot ID from `pg_export_snapshot()`, e.g. `0000000A-0000000B-1`

**Error responses:**

| Status | error code | When |
|--------|------------|------|
| 400 | `invalid_cursor` | Cursor string is malformed |
| 400 | `cursor_required` | `snapshot` provided without `cursor` |
| 410 | `snapshot_expired` | Browse session older than TTL |
| 410 | `snapshot_not_found` | Unknown snapshot ID or invalid format |
| 503 | `snapshot_capacity` | Too many concurrent browse sessions (>100) |
| 500 | — | Database or unexpected server error |

---

### `GET /api/categories`

Returns distinct categories for the filter dropdown.

```bash
curl "http://localhost:3000/api/categories"
```

**Response (200):**
```json
{
  "data": ["automotive", "books", "clothing", "electronics", "food", "garden", "health", "home", "sports", "toys"]
}
```

---

### Static UI

`GET /` serves `public/index.html` — a single-page product browser with:
- Category dropdown (populated from `/api/categories`)
- Product card grid (name, category, price, updated_at)
- **New browse session** button (resets snapshot, fetches page 1)
- **Load more** button (appends next page using snapshot + cursor)
- Handles 410 expired snapshot with user message

---

## 9. Pagination design (the core technical challenge)

This is the most important part of the project. Read this section carefully.

### The problem

Three pagination approaches:

| Approach | Speed | Consistent under writes? |
|----------|-------|--------------------------|
| `LIMIT/OFFSET` | Slow at scale; degrades with large offsets | ❌ Inserts shift rows → duplicates and gaps |
| Cursor only (`WHERE updated_at < ?`) | ✅ Fast with index | ❌ Updated rows can jump in sort order → misses |
| **Snapshot + keyset** | ✅ Fast with index | ✅ Stable view for entire browse session |

### Our solution: Snapshot + keyset

**Sort order:** `ORDER BY updated_at DESC, id DESC`
- `updated_at` = primary sort (newest first)
- `id` = tie-breaker (many rows share the same timestamp; UUID ensures unique ordering)

**Keyset query (page 2+):**
```sql
SELECT id, name, category, price::text, created_at, updated_at
FROM products
WHERE category = $1                                          -- optional filter
  AND (updated_at, id) < ($cursor_updated_at, $cursor_id)  -- keyset condition
ORDER BY updated_at DESC, id DESC
LIMIT $limit + 1;   -- fetch one extra row to detect has_next without COUNT(*)
```

**How snapshots work:**

1. **Page 1** (`SnapshotManager.createSession`):
   - Acquire a DB connection from the pool
   - `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`
   - `SELECT pg_export_snapshot()` → returns snapshot ID (e.g. `0000000A-0000000B-1`)
   - Run the first page query
   - **Keep the transaction open** (do NOT commit) — store connection in memory keyed by snapshot ID
   - Return products + snapshot ID to client

2. **Page 2+** (`SnapshotManager.paginateWithinSnapshot`):
   - Validate snapshot ID format (regex: `^[0-9A-F]+-[0-9A-F]+-[0-9]+$`)
   - Look up the still-open exporting transaction in memory
   - On a **new** pool connection: `BEGIN RR READ ONLY` → `SET TRANSACTION SNAPSHOT '...'`
   - Run keyset query with cursor → `COMMIT` → release connection
   - Return products + same snapshot ID

3. **Session expiry:**
   - TTL default 15 minutes (`SNAPSHOT_TTL_MS`)
   - Background cleanup every 60 seconds rolls back expired sessions
   - Client gets `410 Gone` and must start a new browse session

**Why hold a connection open on page 1?**
PostgreSQL snapshots are only importable while the exporting transaction is still active. This is a PostgreSQL requirement, not an app design choice.

**Trade-off:**
The browse session is a **point-in-time view**. Products added or updated after page 1 will NOT appear until the user starts a new session (refresh / "New browse session"). This is intentional — it's what guarantees no duplicates or misses.

### Walkthrough: 50 inserts during browse

1. User requests page 1 → server freezes DB at snapshot `S`, returns 20 products
2. Another process inserts 50 new products (all with recent `updated_at`)
3. User requests page 2 with `snapshot=S` and cursor from page 1
4. PostgreSQL replays the frozen view from snapshot `S` — the 50 new rows don't exist in that view
5. User gets the next 20 products that were positions 21–40 in the original frozen ordering
6. No duplicates from page 1, no skipped rows

### has_next detection

We fetch `limit + 1` rows. If we get more than `limit` rows, `has_next = true` and we trim the extra row. No expensive `COUNT(*)` per page.

---

## 10. Key classes and functions

### `SnapshotManager` (`src/snapshot/SnapshotManager.ts`)

The consistency engine. Main methods:

```typescript
class SnapshotManager {
  listProducts(options: ProductQueryOptions): Promise<{
    products: Product[];
    snapshotId: string;
    hasNext: boolean;
  }>;

  shutdown(): void;  // Called on server shutdown; releases all held connections
}
```

Custom errors:
- `SnapshotExpiredError` → HTTP 410
- `SnapshotNotFoundError` → HTTP 410
- `SnapshotCapacityError` → HTTP 503

Internal state: `Map<snapshotId, { client, snapshotId, createdAt, expiresAt }>`

### `buildProductQuery()` (`src/services/productService.ts`)

Builds parameterized SQL dynamically based on:
- `limit` (always)
- `category` (optional WHERE clause)
- `cursor` (optional keyset WHERE clause)

### `encodeCursor()` / `decodeCursor()` (`src/services/cursor.ts`)

```typescript
// Encode: { updated_at: "2025-06-01T08:00:00.000Z", id: "uuid" } → base64url string
// Decode: base64url string → { updated_at, id }
```

### `registerProductRoutes()` (`src/routes/products.ts`)

HTTP handler for `GET /api/products`:
1. Parse and validate query params
2. Decode cursor if present
3. Call `snapshotManager.listProducts()`
4. Map errors to HTTP status codes
5. Return `{ data, page_info }`

---

## 11. Request flow diagram

```
Client                    Fastify (routes/products.ts)       SnapshotManager              PostgreSQL
  |                                |                              |                          |
  |-- GET /api/products ---------->|                              |                          |
  |   (no snapshot)                |-- listProducts() ----------->|                          |
  |                                |                              |-- BEGIN RR READ ONLY --->|
  |                                |                              |-- pg_export_snapshot() ->|
  |                                |                              |-- SELECT ... LIMIT 21 -->|
  |                                |                              |   (txn stays open)       |
  |<-- { data, page_info } --------|<-- products + snapshotId ----|                          |
  |                                |                              |                          |
  |-- GET /api/products ---------->|                              |                          |
  |   ?snapshot=X&cursor=Y         |-- listProducts() ----------->|                          |
  |                                |                              |-- SET TRANSACTION SNAPSHOT
  |                                |                              |-- SELECT ... keyset ---->|
  |                                |                              |-- COMMIT                 |
  |<-- { data, page_info } --------|<-- products + snapshotId ----|                          |
```

---

## 12. npm scripts

| Script | Command | What it does |
|--------|---------|--------------|
| `dev` | `tsx watch src/index.ts` | Start dev server with hot reload |
| `build` | `tsc` | Compile TypeScript to `dist/` |
| `start` | `node dist/index.js` | Run compiled production build |
| `migrate` | `tsx scripts/migrate.ts` | Apply `migrations/001_products.sql` |
| `seed` | `tsx scripts/seed.ts` | Bulk insert 200k products |

---

## 13. How to extend the project

### Add a new filter (e.g. price range)

1. **`src/routes/products.ts`** — add `min_price` / `max_price` to querystring interface and pass to service
2. **`src/services/productService.ts`** — add WHERE clauses in `buildProductQuery()`:
   ```sql
   AND price >= $N AND price <= $M
   ```
3. **`migrations/`** — add a new index if the filter is selective:
   ```sql
   CREATE INDEX idx_products_category_price_updated_id
     ON products (category, price, updated_at DESC, id DESC);
   ```
   Rule: leading index columns must match your WHERE clause filters.

### Add a write API (e.g. create product)

Not in scope for the assignment, but if added:
- New rows won't appear in active snapshot sessions (by design)
- New browse sessions will see them
- Consider whether `updated_at` should be set by DB trigger on update

### Add tests

Suggested integration test (`src/snapshot/SnapshotManager.test.ts`):
1. Seed DB, fetch page 1 + page 2
2. Insert 50 products mid-session
3. Fetch page 3 — assert no ID repeats and no gaps
4. Wait for TTL expiry — assert 410 response

---

## 14. Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| `docker.sock: no such file` | Docker Desktop not running | Open Docker Desktop, wait until running |
| `port 5432: address already in use` | Local Postgres on 5432 | Project uses port **5433** — ensure `docker-compose.yml` has `5433:5432` |
| `password authentication failed for user "products"` | App connecting to wrong Postgres | Check `DATABASE_URL` points to port **5433** with `products:products` |
| `snapshot_expired` (410) | Browse session > 15 min old | Click "New browse session" or omit snapshot param |
| `snapshot_capacity` (503) | >100 concurrent browse sessions | Wait for TTL cleanup or restart server |
| Empty product list | DB not seeded | Run `npm run migrate && npm run seed` |
| UI loads but no products | API error | Check terminal for DB connection errors |

---

## 15. Dependencies

```json
{
  "dependencies": {
    "@fastify/static": "^8.1.0",
    "fastify": "^5.2.1",
    "pg": "^8.13.3"
  },
  "devDependencies": {
    "@types/node": "^22.13.10",
    "@types/pg": "^8.11.11",
    "tsx": "^4.19.3",
    "typescript": "^5.8.2"
  }
}
```

No ORM, no validation library, no test framework (kept minimal for readability).

---

## 16. TypeScript interfaces (for reference)

```typescript
interface Product {
  id: string;
  name: string;
  category: string;
  price: string;           // numeric returned as string from pg
  created_at: Date;
  updated_at: Date;
}

interface PaginationCursor {
  updated_at: string;      // ISO-8601
  id: string;              // UUID
}

interface PageInfo {
  snapshot: string;        // pg_export_snapshot() ID
  next_cursor: string | null;
  has_next: boolean;
}

interface ProductListResponse {
  data: Product[];
  page_info: PageInfo;
}

interface ProductQueryOptions {
  limit: number;
  category?: string;
  snapshot?: string;
  cursor?: PaginationCursor;
}
```

---

## 17. Seed SQL (exact content)

```sql
INSERT INTO products (name, category, price, created_at, updated_at)
SELECT
  'Product ' || g.i,
  (ARRAY[
    'electronics', 'books', 'clothing', 'home', 'sports',
    'toys', 'garden', 'automotive', 'health', 'food'
  ])[1 + (g.i % 10)],
  (random() * 500 + 0.99)::numeric(10, 2),
  now() - (random() * interval '365 days'),
  now() - (random() * interval '30 days')
FROM generate_series(1, 200000) AS g(i);
```

`scripts/seed.ts` skips seeding if the table already has rows. To re-seed: `TRUNCATE products;` then `npm run seed`.

---

## 18. Interview talking points

If explaining this project:

1. **The hard problem isn't CRUD — it's consistent pagination under concurrent writes.**
2. **Offset pagination fails** because inserted rows shift positions.
3. **Cursor-only pagination fails** because updated rows can jump past your cursor.
4. **Snapshot + keyset solves it** by freezing a consistent DB view for the browse session.
5. **PostgreSQL's `pg_export_snapshot()`** is the mechanism — we hold the exporting transaction open so subsequent pages can import the same snapshot.
6. **`id` as tie-breaker** ensures stable ordering when `updated_at` values collide.
7. **Trade-off:** point-in-time view, not a live feed. New data requires a new session.
8. **Indexes match query shape:** `(category, updated_at DESC, id DESC)` for filtered queries.

---

## 19. Current runtime state (when fully set up)

- Docker container `codevector-postgres-1` running Postgres 16
- Database `products` with user/password `products`/`products` on `localhost:5433`
- Table `products` with 200,000 rows and 2 indexes
- Fastify server on `localhost:3000` serving API + static UI
- Browse sessions held in memory with 15-minute TTL, max 100 concurrent
# Arkin-CodeVector
