# DB Doctor — System Design

---

## 1. High-level architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Browser (Client)                           │
│                                                                     │
│   ┌─────────────────────────────────────────────────────────────┐  │
│   │                     app/page.tsx                            │  │
│   │                                                             │  │
│   │  [Question Input]  →  [Agent Steps Trace]                   │  │
│   │                        [Diagnosis Panel]                    │  │
│   │  [Approve Modal]   →  [Before/After Results]                │  │
│   │                        [Export Report ↓]                    │  │
│   └──────────┬──────────────────────┬───────────────────────────┘  │
│              │  POST /api/diagnose  │  POST /api/apply-fix         │
└──────────────┼──────────────────────┼──────────────────────────────┘
               │                      │
               ▼                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       Next.js Server (Node.js)                      │
│                                                                     │
│  ┌──────────────────────────┐   ┌──────────────────────────────┐   │
│  │  /api/diagnose           │   │  /api/apply-fix              │   │
│  │                          │   │                              │   │
│  │  1. getSchemaWithMeta()  │   │  1. Validate SQL (allowlist) │   │
│  │  2. runExplain()         │   │  2. db.exec(CREATE INDEX)    │   │
│  │  3. timeQuery()          │   │  3. timeQuery() — after      │   │
│  │  4. buildSteps[]         │   │  4. runExplain() — after     │   │
│  │  5. → Anthropic API      │   │  5. return speedup ratio     │   │
│  │  6. return diagnosis     │   │                              │   │
│  └──────────┬───────────────┘   └──────────────────────────────┘   │
│             │                                                        │
│  ┌──────────▼───────────────┐                                       │
│  │      lib/db.ts           │                                       │
│  │  (process singleton)     │                                       │
│  │  WAL mode, better-sqlite3│                                       │
│  └──────────┬───────────────┘                                       │
└─────────────┼───────────────────────────────────────────────────────┘
              │                          │
              ▼                          ▼
  ┌─────────────────────┐    ┌──────────────────────────┐
  │   data/app.db       │    │    Anthropic API          │
  │   (SQLite)          │    │    claude-opus-4-8        │
  │                     │    │    adaptive thinking      │
  │   customers (500)   │    │    streaming response     │
  │   products  (100)   │    └──────────────────────────┘
  │   orders  (50,000)  │
  │                     │
  │   ← no index on     │
  │     customer_id     │
  │     (demo bug)      │
  └─────────────────────┘
```

---

## 2. Request flow — Diagnose

```
Browser                 Next.js API              SQLite            Anthropic
   │                        │                       │                  │
   │  POST /api/diagnose    │                       │                  │
   │  { question: "..." }   │                       │                  │
   │───────────────────────►│                       │                  │
   │                        │                       │                  │
   │                        │  sqlite_master query  │                  │
   │                        │──────────────────────►│                  │
   │                        │  ← schema (3 tables)  │                  │
   │                        │◄──────────────────────│                  │
   │                        │                       │                  │
   │                        │  EXPLAIN QUERY PLAN   │                  │
   │                        │──────────────────────►│                  │
   │                        │  ← "SCAN o"           │                  │
   │                        │◄──────────────────────│                  │
   │                        │                       │                  │
   │                        │  SELECT (timed)       │                  │
   │                        │──────────────────────►│                  │
   │                        │  ← rows + elapsed ms  │                  │
   │                        │◄──────────────────────│                  │
   │                        │                       │                  │
   │                        │  messages.stream()                       │
   │                        │  model: claude-opus-4-8                  │
   │                        │  context: schema+EXPLAIN+time            │
   │                        │─────────────────────────────────────────►│
   │                        │  ← stream (thinking + text)              │
   │                        │◄─────────────────────────────────────────│
   │                        │                       │                  │
   │                        │  finalMessage()       │                  │
   │                        │  parse JSON from text │                  │
   │                        │                       │                  │
   │  { diagnosis,          │                       │                  │
   │    root_cause,         │                       │                  │
   │    fix_sql,            │                       │                  │
   │    steps[],            │                       │                  │
   │    query_time_ms }     │                       │                  │
   │◄───────────────────────│                       │                  │
```

---

## 3. Request flow — Apply Fix (with permission gate)

```
Browser (UI)                        Next.js API              SQLite
     │                                    │                      │
     │  User clicks "Apply Fix"           │                      │
     │                                    │                      │
     │  ┌──────────────────────────────┐  │                      │
     │  │  ApproveModal appears        │  │                      │
     │  │  shows exact CREATE INDEX SQL│  │                      │
     │  │  badge: always_ask           │  │                      │
     │  └──────────────────────────────┘  │                      │
     │                                    │                      │
     │  User clicks "Approve"             │                      │
     │                                    │                      │
     │  POST /api/apply-fix               │                      │
     │  { fix_sql, before_ms }            │                      │
     │───────────────────────────────────►│                      │
     │                                    │                      │
     │                                    │  Validate SQL        │
     │                                    │  (must start with    │
     │                                    │  CREATE INDEX)       │
     │                                    │                      │
     │                                    │  db.exec(fix_sql)    │
     │                                    │─────────────────────►│
     │                                    │  ← index created     │
     │                                    │◄─────────────────────│
     │                                    │                      │
     │                                    │  SELECT (re-timed)   │
     │                                    │─────────────────────►│
     │                                    │  ← rows + elapsed ms │
     │                                    │◄─────────────────────│
     │                                    │                      │
     │                                    │  EXPLAIN QUERY PLAN  │
     │                                    │─────────────────────►│
     │                                    │  ← "SEARCH o USING   │
     │                                    │     INDEX ..."       │
     │                                    │◄─────────────────────│
     │                                    │                      │
     │  { before_ms, after_ms,            │                      │
     │    speedup: "37.7",                │                      │
     │    explain_after }                 │                      │
     │◄───────────────────────────────────│                      │
     │                                    │                      │
     │  Results panel: 37.7x faster       │                      │
     │  Export Report button appears      │                      │
```

---

## 4. Component breakdown

### Frontend — `app/page.tsx`

```
page.tsx
│
├── State
│   ├── question        string          — current input text
│   ├── loading         bool            — diagnose in flight
│   ├── diagnose        DiagnoseResult  — API response
│   ├── fixing          bool            — apply-fix in flight
│   ├── fixResult       FixResult       — before/after numbers
│   ├── error           string          — surface API errors
│   ├── showApproval    bool            — controls modal visibility
│   └── resetting       bool            — reset in flight
│
├── Components
│   ├── <AgentTrace steps={...} />
│   │     Collapsible numbered timeline
│   │     Each step: label + detail + ok/warn status
│   │     warn steps highlighted yellow (SCAN detected)
│   │
│   ├── <ApproveModal sql onApprove onDeny />
│   │     Fixed overlay, z-50
│   │     Shows SQL in monospace, always_ask badge
│   │     Approve → executeApplyFix()
│   │     Deny → closes modal, no action
│   │
│   └── exportReport(question, diagnose, fixResult)
│         Pure function — no API call
│         Builds Markdown string
│         Triggers browser download via Blob + <a>
│
└── Handlers
    ├── handleDiagnose(e)   — POST /api/diagnose
    ├── executeApplyFix()   — POST /api/apply-fix (called after Approve)
    ├── handleApprove()     — closes modal + calls executeApplyFix
    ├── handleDeny()        — closes modal, no action
    └── handleReset()       — POST /api/reset
```

### Backend — API routes

```
/api/diagnose/route.ts
│
├── getSchemaWithMeta()
│   ├── SELECT name FROM sqlite_master WHERE type='table'
│   ├── PRAGMA table_info({table}) for each table
│   └── returns: schema SQL string + table names + column counts
│
├── runExplain()
│   └── EXPLAIN QUERY PLAN {SLOW_QUERY} bound to param 42
│
├── timeQuery()
│   └── performance.now() around .all(42) execution
│
├── getIndexes()
│   └── SELECT name, tbl_name FROM sqlite_master WHERE type='index'
│
├── buildSteps[]
│   ├── step 1: schema — always ok
│   ├── step 2: query — always ok
│   ├── step 3: EXPLAIN — warn if "SCAN" found
│   ├── step 4: timing — warn if scan detected
│   └── step 5: Claude summary — always ok (added after API call)
│
└── client.messages.stream()
    ├── model: claude-opus-4-8
    ├── thinking: { type: 'adaptive' }
    ├── system: database performance expert, return JSON only
    └── user: schema + EXPLAIN + query + timing


/api/apply-fix/route.ts
│
├── SQL allowlist check
│   └── must begin with CREATE INDEX or CREATE UNIQUE INDEX
│
├── db.exec(fix_sql)         — synchronous DDL
├── timeQuery()              — post-index timing
├── runExplain()             — post-index plan
└── return { before_ms, after_ms, speedup, explain_after }


/api/reset/route.ts
│
├── SELECT all non-system indexes on orders table
├── DROP INDEX for each
└── return { dropped[], explain_plan (confirms SCAN is back) }
```

---

## 5. Data model

```
┌──────────────┐         ┌───────────────────────────────────────┐
│  customers   │         │  orders                               │
│──────────────│         │───────────────────────────────────────│
│  id    PK    │◄────┐   │  id          PK                       │
│  name        │     │   │  customer_id          ← NO INDEX HERE │
│  email       │     └───│  product_id           (the demo bug)  │
│  created_at  │         │  quantity                             │
└──────────────┘         │  total                                │
                         │  status                               │
┌──────────────┐         │  created_at                           │
│  products    │         └───────────────────────────────────────┘
│──────────────│               │
│  id    PK    │◄──────────────┘ (product_id FK, no index needed
│  name        │                  for this demo)
│  price       │
│  category    │
└──────────────┘

Row counts: customers=500, products=100, orders=50,000

Without index on customer_id:
  EXPLAIN → SCAN orders (reads all 50,000 rows)
  Complexity: O(n)

After CREATE INDEX idx_orders_customer_id ON orders(customer_id):
  EXPLAIN → SEARCH orders USING INDEX (B-tree lookup)
  Complexity: O(log n)
  Observed speedup: ~37x on 50K rows
```

---

## 6. Security model

```
Threat                       Mitigation
─────────────────────────────────────────────────────────────────
Arbitrary SQL execution      /api/apply-fix rejects anything that
via fix_sql param            does not begin with CREATE INDEX.
                             Claude is also prompted to return only
                             CREATE INDEX in the fix_sql field.

API key exposure             ANTHROPIC_API_KEY is an env var only.
                             .env.local is gitignored via .env* rule.
                             Key never touches client bundle.

Prompt injection via         question param is user-controlled but
user question                only used as context in Claude's prompt,
                             never executed as code or SQL.

Database destruction         apply-fix only calls db.exec() after
                             allowlist check. No DROP, DELETE, UPDATE
                             paths exist in any route.

Human-in-the-loop            UI never calls /api/apply-fix without
(always_ask)                 explicit modal Approve. Deny closes
                             modal with no side effects.
```

---

## 7. Production architecture (Managed Agents)

The hackathon demo uses local SQLite. The production version replaces the inline DB calls with Anthropic's Managed Agents platform and MCP connectors — the agent reasoning logic is unchanged.

```
                        ┌──────────────────────────────────────────┐
   Engineer types       │         Anthropic Platform               │
   /db-doctor in Slack  │                                          │
         │              │  ┌────────────────────────────────────┐  │
         ▼              │  │        Managed Agent               │  │
  ┌─────────────┐       │  │  (registered, versioned config)    │  │
  │  Slack MCP  │──────►│  │                                    │  │
  │  connector  │       │  │  system prompt: DB expert          │  │
  └─────────────┘       │  │  permission policy: always_ask     │  │
                        │  │  tools: postgres MCP, slack MCP    │  │
                        │  └──────────────┬─────────────────────┘  │
                        │                 │                         │
                        │    ┌────────────▼──────────────────────┐  │
                        │    │        Tool execution             │  │
                        │    │  (Anthropic-hosted container)     │  │
                        │    │                                   │  │
                        │    │  ┌─────────────────────────────┐  │  │
                        │    │  │     Postgres MCP server     │  │  │
                        │    │  │                             │  │  │
                        │    │  │  get_schema()               │  │  │
                        │    │  │  explain_query()            │  │  │
                        │    │  │  time_query()               │  │  │
                        │    │  │  create_index()  ← gated    │  │  │
                        │    │  └──────────┬──────────────────┘  │  │
                        │    └────────────┬┼──────────────────────┘  │
                        └────────────────┬┼───────────────────────────┘
                                         ││
                              ┌──────────▼▼──────────┐
                              │   Production Postgres │
                              │   (your database)     │
                              └──────────────────────┘

When agent wants to run CREATE INDEX:
  → platform pauses execution
  → sends approval request to engineer via Slack MCP
  → engineer approves in thread
  → platform resumes, index created
  → Outcome artifact posted back to Slack thread
```

**What changes between hackathon and production:**

| Hackathon (today) | Production (Managed Agents) |
|-------------------|-----------------------------|
| `lib/db.ts` singleton | Postgres MCP connector |
| `runExplain()` in-process | `explain_query` MCP tool |
| `getSchema()` in-process | `get_schema` MCP tool |
| Modal in browser UI | `always_ask` platform policy |
| Download button | Outcome artifact to Slack/Notion |
| `npm run dev` | Managed Agent registered in platform |
| SQLite `.db` file | Production Postgres (any cloud) |

**Core agent reasoning: identical in both.** The Claude prompt, step collection logic, and JSON output schema are unchanged.

---

## 8. Technology decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Runtime | Next.js App Router | API routes co-located with UI, zero config, TypeScript first-class |
| Database driver | `better-sqlite3` | Synchronous — no async overhead in route handlers. Native Node addon, fast. |
| Database | SQLite | Zero config, file-based, ships in the repo. Structurally identical to Postgres for this demo. |
| AI SDK | `@anthropic-ai/sdk` | Official SDK — streaming, finalMessage(), type-safe |
| Model | `claude-opus-4-8` | Most capable Claude model for reasoning-heavy diagnostic tasks |
| Thinking | `adaptive` | Claude decides depth. For structured JSON output it answers directly; for ambiguous queries it reasons more. |
| Response format | Streaming + finalMessage() | Prevents timeouts on long Claude responses; `finalMessage()` gives complete parsed result |
| SQL safety | Allowlist in apply-fix | Defense-in-depth: UI gate (modal) + server gate (string check). Belt and suspenders. |
| CSS | Tailwind v4 | Rapid dark-theme UI with no custom CSS files |

---

## 9. Performance characteristics

```
Operation              Typical time   Notes
──────────────────────────────────────────────────────────────
Schema query           < 1ms          3 sqlite_master queries
EXPLAIN QUERY PLAN     < 1ms          Synchronous, no execution
Query timing           2–5ms          Full scan on 50K rows
Claude API call        4–8s           Streaming, adaptive thinking
Total /api/diagnose    5–10s          Dominated by Claude latency

After index created:
Query timing           0.05–0.1ms     B-tree lookup
Total /api/apply-fix   < 50ms         No AI call, pure SQL
```

---

## 10. File map

```
db-doctor/
│
├── app/                          Next.js App Router
│   ├── layout.tsx                Root HTML shell, Geist font
│   ├── globals.css               Tailwind v4 import
│   ├── page.tsx                  Entire client UI (single page)
│   │                             AgentTrace, ApproveModal, exportReport
│   └── api/
│       ├── diagnose/
│       │   └── route.ts          POST — schema+EXPLAIN+Claude → diagnosis+steps
│       ├── apply-fix/
│       │   └── route.ts          POST — CREATE INDEX + before/after timing
│       └── reset/
│           └── route.ts          POST — drop orders indexes, restore demo state
│
├── lib/
│   └── db.ts                     Process-level SQLite singleton, WAL mode
│
├── scripts/
│   └── seed.ts                   One-time: creates tables + 50K rows, no index
│
├── data/                         Gitignored — generated by npm run seed
│   ├── app.db
│   ├── app.db-shm
│   └── app.db-wal
│
├── .env.local                    Gitignored — ANTHROPIC_API_KEY goes here
├── next.config.ts                serverExternalPackages: ['better-sqlite3']
├── package.json                  scripts: dev, seed, build, lint
│
├── README.md                     Local setup guide (step by step)
├── PRESENTATION.md               Demo script + code walkthrough + pitch Q&A
└── SYSTEM_DESIGN.md              This file
```
