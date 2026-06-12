# DB Doctor

AI-powered database performance diagnostics. Ask a natural language question about a slow query, get a Claude-powered diagnosis with a recommended index, approve the fix with one click, and watch the query go 10–50x faster — all live.

Built for the Anthropic x Motier 4-Hour Hackathon.

---

## What it does

1. You describe a slow query in plain English
2. The agent inspects your schema, runs `EXPLAIN QUERY PLAN`, and times the query
3. Claude (`claude-opus-4-8`) diagnoses the root cause and recommends a `CREATE INDEX` fix
4. A permission gate (always_ask) shows you the exact SQL before anything runs
5. You approve — the index is applied, the query is re-timed, and you see the before/after speedup
6. Export the full outcome as a structured Markdown report

---

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) |
| Database | SQLite via `better-sqlite3` |
| AI | Anthropic SDK — `claude-opus-4-8`, adaptive thinking |
| Styling | Tailwind CSS v4 |
| Language | TypeScript |

---

## Local setup — step by step

### Prerequisites

- Node.js 18+
- An Anthropic API key — get one at console.anthropic.com

### 1. Clone the repo

```bash
git clone https://github.com/zainsubhani/Anthropic-x-Motier-Hackathon_4Hour_DB_Doctor_Agent.git
cd Anthropic-x-Motier-Hackathon_4Hour_DB_Doctor_Agent
```

### 2. Install dependencies

```bash
npm install
```

### 3. Add your API key

Create a `.env.local` file in the project root:

```bash
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env.local
```

This file is gitignored — it will never be committed.

### 4. Seed the database

This creates the SQLite database at `data/app.db` with 500 customers, 100 products, and **50,000 orders**. It deliberately omits the index on `orders.customer_id` — that's the demo bug.

```bash
npm run seed
```

Expected output:
```
Creating tables...
Seeding customers...
Seeding products...
Seeding 50,000 orders (this guarantees a slow full table scan)...

Verifying full table scan with EXPLAIN QUERY PLAN...

Query plan for: SELECT * FROM orders WHERE customer_id = 1
  SCAN orders

✅ SCAN confirmed — full table scan on orders. Demo is ready!

DB stats: 50000 orders, 500 customers, 100 products
```

### 5. Start the dev server

```bash
npm run dev
```

Open `http://localhost:3000`.

### 6. Run the demo

1. Click one of the example questions or type your own
2. Click **Diagnose** — the agent will inspect schema, run EXPLAIN, and call Claude (~5–10s)
3. Expand **Agent steps** to see the investigation trail
4. Click **Apply Fix** — a permission modal appears showing the exact SQL
5. Click **Approve** — the index is applied and before/after timings appear
6. Click **↓ Export Report** to download the Markdown outcome artifact

### 7. Reset for a second run

Click **Reset demo** (top-right corner) to drop the index and restore the full table scan. The demo is fully replayable without re-seeding.

---

## Project structure

```
db-doctor/
├── app/
│   ├── page.tsx                  # Main UI — all client state and components
│   ├── layout.tsx                # Root layout
│   └── api/
│       ├── diagnose/route.ts     # POST /api/diagnose — agent + Claude call
│       ├── apply-fix/route.ts    # POST /api/apply-fix — index creation + timing
│       └── reset/route.ts        # POST /api/reset — drop indexes for demo replay
├── lib/
│   └── db.ts                     # SQLite singleton (better-sqlite3, WAL mode)
├── scripts/
│   └── seed.ts                   # One-time DB seed — creates tables + 50K rows
├── data/                         # Generated — gitignored
│   └── app.db                    # SQLite database
├── .env.local                    # Gitignored — put ANTHROPIC_API_KEY here
└── next.config.ts                # serverExternalPackages: ['better-sqlite3']
```

---

## API reference

### `POST /api/diagnose`

**Request**
```json
{ "question": "Why is fetching orders for a customer so slow?" }
```

**Response**
```json
{
  "diagnosis": "The query performs a full table scan...",
  "root_cause": "Missing index on orders.customer_id",
  "fix_sql": "CREATE INDEX idx_orders_customer_id ON orders(customer_id);",
  "explanation": "This index lets SQLite jump directly...",
  "expected_improvement": "10-100x faster",
  "query": "SELECT o.*, c.name...",
  "explain_plan": "SCAN o",
  "query_time_ms": 3.67,
  "steps": [
    { "label": "Schema inspected", "detail": "...", "status": "ok" },
    { "label": "Query identified",  "detail": "...", "status": "ok" },
    { "label": "EXPLAIN QUERY PLAN executed", "detail": "SCAN o", "status": "warn" },
    { "label": "Query timed", "detail": "3.67ms — full table scan confirmed", "status": "warn" },
    { "label": "Claude diagnosis formed", "detail": "...", "status": "ok" }
  ]
}
```

### `POST /api/apply-fix`

**Request**
```json
{
  "fix_sql": "CREATE INDEX idx_orders_customer_id ON orders(customer_id);",
  "before_ms": 3.67
}
```

**Response**
```json
{
  "success": true,
  "before_ms": 3.67,
  "after_ms": 0.097,
  "speedup": "37.7",
  "explain_after": "SEARCH o USING INDEX idx_orders_customer_id (customer_id=?)"
}
```

Only `CREATE INDEX` statements are accepted — all other SQL is rejected.

### `POST /api/reset`

No request body. Drops all non-system indexes on the `orders` table and returns the post-reset EXPLAIN plan to confirm `SCAN o` is back.

---

## Key implementation details

### Why `better-sqlite3` and not an ORM

`better-sqlite3` is synchronous and runs `EXPLAIN QUERY PLAN` + timing in the same process as the API route — no round-trip latency, no connection pool to manage. Perfect for a hackathon demo where the DB is local.

### Why the seed deliberately omits the index

```typescript
// scripts/seed.ts
CREATE TABLE orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  -- NOTE: Deliberately no index on customer_id — this is the demo "bug"
  ...
);
```

Without an index on `customer_id`, SQLite scans all 50,000 rows for every customer lookup. Adding the index turns it into a B-tree lookup — O(log n) instead of O(n).

### Why `serverExternalPackages` in next.config.ts

```typescript
serverExternalPackages: ['better-sqlite3']
```

`better-sqlite3` is a native Node.js addon (`.node` binary). Next.js's webpack bundler can't bundle native addons — this tells it to leave `better-sqlite3` as a `require()` at runtime instead.

### Claude call — adaptive thinking

```typescript
const stream = await client.messages.stream({
  model: 'claude-opus-4-8',
  max_tokens: 2048,
  thinking: { type: 'adaptive' },   // Claude decides how much to reason
  system: `You are a database performance expert...`,
  messages: [{ role: 'user', content: `...schema + EXPLAIN + timing...` }],
});
const response = await stream.finalMessage();
```

`thinking: { type: 'adaptive' }` lets Claude decide whether to reason step-by-step or answer directly. For the structured JSON output, it typically answers directly (fast). For ambiguous queries it may think more deeply.

### Permission gate — always_ask pattern

The UI never calls `/api/apply-fix` directly. Clicking "Apply Fix" opens a modal showing the exact SQL. Only `onApprove` triggers the actual fetch. This maps to the `always_ask` permission policy in the Anthropic Managed Agents platform.

---

## Pitch framing

**Problem:** Slow queries kill user experience. DBAs spend hours running EXPLAIN, reading docs, and testing indexes.

**Demo:** Ask in plain English → AI investigates → one-click approved fix → 30x faster.

**Architecture story:** This is the agent logic. In production this runs as a **Managed Agent** connected to your database via the **Postgres MCP**, triggered from Slack. The permission gate maps to `always_ask` in the platform's permission policies. The exported report is the **Outcome artifact**.

---

## Troubleshooting

**"Too few parameter values"** — Make sure you're on the latest commit. An early bug required passing `42` as the bound parameter to `EXPLAIN QUERY PLAN`.

**500 on /api/diagnose** — Check `.env.local` has a valid `ANTHROPIC_API_KEY` (starts with `sk-ant-`).

**Claude says "already indexed"** — Click **Reset demo** to drop the index and restore the full table scan.

**`data/app.db` not found** — Run `npm run seed` first.
