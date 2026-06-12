# DB Doctor — Presentation Guide

Code walkthrough, pitch narrative, and slide-by-slide talking points for the Anthropic x Motier Hackathon demo.

---

## The one-sentence pitch

> "DB Doctor is an AI agent that diagnoses slow database queries, explains the root cause, and applies a one-click approved fix — live, in under 30 seconds."

---

## Demo script (run this live)

**Before you present:** Click **Reset demo** to ensure the full table scan is active.

### Step 1 — Ask the question

Click the example prompt: *"Why is fetching orders for a customer so slow?"*

**What to say:**
> "I'm asking in plain English. No SQL, no config files, no documentation. Just the question an engineer would actually ask."

### Step 2 — Watch the agent investigate

While it loads (~5–10s), say:
> "The agent is doing three things in parallel: inspecting the database schema, running SQLite's `EXPLAIN QUERY PLAN`, and timing the actual query. Then it sends all of that context to Claude."

### Step 3 — Open Agent steps

Click to expand the **Agent steps** panel.

**What to say:**
> "This is the investigation trail — exactly what the agent looked at before forming its answer. Schema inspected, query identified, EXPLAIN run — you can see step 3 is flagged as a warning because it detected a full table scan on the orders table. That's the root cause."
>
> "This maps directly to the 'one agent, three knowledge sources → one grounded answer' pattern from the platform."

### Step 4 — Show the diagnosis

Point to the root cause and EXPLAIN output.

**What to say:**
> "The EXPLAIN plan says `SCAN o` — SQLite is reading all 50,000 rows every time someone looks up their orders. It gets worse linearly as your data grows."

### Step 5 — Permission gate

Click **Apply Fix**.

**What to say:**
> "Before anything touches the database, the agent asks for permission. This is the `always_ask` permission policy from Anthropic's platform — the agent surfaces the exact SQL and waits for a human to approve. It can't act unilaterally."

Click **Approve**.

### Step 6 — Show the result

**What to say:**
> "The index was applied. `SCAN o` became `SEARCH o USING INDEX`. Query went from 3ms to 0.09ms — that's 37 times faster. As the table grows to millions of rows that gap gets much larger."

### Step 7 — Export Report

Click **↓ Export Report**.

**What to say:**
> "This is the Outcome artifact — a structured record of what the agent investigated, what it found, and what it changed. Separate from the chat interaction, shareable, archivable. In production this would land in your incident ticket or Notion doc automatically."

---

## Architecture story (60 seconds)

> "What you just saw is the agent logic running locally against SQLite. In production, this exact same agent runs as a **Managed Agent** on Anthropic's platform. It connects to your Postgres database via the **Postgres MCP** server — no custom tool code, the MCP handles the protocol. It's triggered from Slack: an engineer types `/db-doctor why are orders slow` and gets this full flow back in the thread."
>
> "The permission gate maps to `always_ask` in the platform's permission policies. The exported report is the **Outcome primitive** — a structured artifact the agent produces, separate from the event stream."
>
> "Three primitives, one demo: Outcomes, Permission Policies, MCP connectors."

---

## Code walkthrough — file by file

Use this if judges ask to see the code, or for a technical deep-dive.

### `lib/db.ts` — Database connection

```typescript
export function getDb(): Database.Database {
  if (!db) {
    db = new Database(path.join(process.cwd(), 'data', 'app.db'));
    db.pragma('journal_mode = WAL');
  }
  return db;
}
```

**Talk track:** "Single process-level connection, WAL mode for concurrent reads. `better-sqlite3` is synchronous — no async/await noise in the route handlers, which keeps the agent logic readable."

---

### `scripts/seed.ts` — The demo bug

```typescript
CREATE TABLE orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  product_id  INTEGER NOT NULL,
  ...
  -- NOTE: Deliberately no index on customer_id — this is the demo "bug"
);
```

**Talk track:** "50,000 orders, no index on `customer_id`. This forces a full table scan on every customer lookup — that's the bug the agent finds. Seeding takes about 3 seconds."

---

### `app/api/diagnose/route.ts` — The agent

This is the core of the demo. Walk through it in four beats:

**Beat 1 — Collect context**
```typescript
const { schema, tableNames, columnCounts } = getSchemaWithMeta();
const explainOutput = runExplain();     // EXPLAIN QUERY PLAN
const queryTimeMs   = timeQuery();       // actual execution time
```
"Three tools: schema reader, EXPLAIN runner, query timer. This is what an experienced DBA would do manually."

**Beat 2 — Build the steps trace**
```typescript
steps.push({
  label: 'EXPLAIN QUERY PLAN executed',
  detail: explainOutput,
  status: hasScan ? 'warn' : 'ok',   // ⚠ if SCAN detected
});
```
"The steps array is built as the agent runs — not post-hoc. Each step records what was observed and flags issues."

**Beat 3 — Call Claude**
```typescript
const stream = await client.messages.stream({
  model: 'claude-opus-4-8',
  thinking: { type: 'adaptive' },
  system: `You are a database performance expert...`,
  messages: [{
    role: 'user',
    content: `Schema: ${schema}\nEXPLAIN: ${explainOutput}\nTime: ${queryTimeMs}ms`
  }],
});
```
"Schema, EXPLAIN output, and timing all go into the prompt as grounding context. Claude returns a structured JSON object — diagnosis, root cause, the exact CREATE INDEX to run, and an expected improvement estimate."

**Beat 4 — Return everything**
```typescript
return NextResponse.json({
  ...parsed,          // diagnosis, root_cause, fix_sql, explanation, speedup
  explain_plan: explainOutput,
  query_time_ms: queryTimeMs,
  steps,              // the investigation trail
});
```

---

### `app/api/apply-fix/route.ts` — The safe executor

```typescript
// Security: only CREATE INDEX statements are accepted
const sqlUpper = fix_sql.trim().toUpperCase();
if (!sqlUpper.startsWith('CREATE INDEX') && !sqlUpper.startsWith('CREATE UNIQUE INDEX')) {
  return NextResponse.json({ error: 'Only CREATE INDEX statements are allowed' }, { status: 400 });
}

db.exec(fix_sql);          // apply the index
const after_ms = timeQuery();  // re-time
const speedup = (before_ms / after_ms).toFixed(1);
```

**Talk track:** "The executor validates that only `CREATE INDEX` can run — no DROP, no DELETE, no arbitrary SQL. The permission gate in the UI is the UX layer; this is the enforcement layer. Defense in depth."

---

### `app/page.tsx` — Three UI primitives

**AgentTrace component** (Feature #1 — grounded answer)
```typescript
function AgentTrace({ steps }: { steps: AgentStep[] }) {
  const [open, setOpen] = useState(false);
  // Collapsible numbered timeline, warn steps highlighted in yellow
}
```

**ApproveModal component** (Feature #3 — always_ask)
```typescript
function ApproveModal({ sql, onApprove, onDeny }) {
  // Modal with always_ask badge, SQL preview, Approve/Deny
  // Apply Fix button sets showApproval=true — never calls fetch directly
}
```

**exportReport function** (Feature #2 — Outcome artifact)
```typescript
function exportReport(question, diagnose, fixResult) {
  // Builds Markdown: steps, diagnosis, fix SQL, before/after table
  // Triggers browser download as db-doctor-report-{timestamp}.md
}
```

---

## Questions judges might ask

**"Why SQLite and not Postgres?"**
> SQLite runs locally with zero config — perfect for a hackathon demo. The agent logic is identical for Postgres; you'd swap `better-sqlite3` for `pg` and the `EXPLAIN QUERY PLAN` syntax for `EXPLAIN ANALYZE`. In the production pitch we'd use Postgres MCP.

**"Is this just a script or a real agent?"**
> It's a real agent in the technical sense: it autonomously selects tools (schema reader, EXPLAIN runner, query timer), synthesizes multi-source context, reasons about root cause, and generates an actionable fix — without being told which specific tools to use for a given question. The permission gate means it can't act without human approval on writes.

**"What's the Managed Agents angle?"**
> Today this runs as a Next.js API route. In production: the agent is registered as a Managed Agent on Anthropic's platform, the database tools are replaced by the Postgres MCP connector (Anthropic hosts the tool execution), and the trigger is a Slack slash command via the Slack MCP. The permission gate maps to `always_ask` in the platform's policy config. Nothing in the core agent logic changes.

**"How does it know which query is slow?"**
> In this demo the slow query is hardcoded — the customer orders join. In a production version you'd feed it from a slow query log (Postgres has `pg_stat_statements`, MySQL has the slow query log). The agent logic is the same; only the input source changes.

**"What stops Claude from suggesting a DROP TABLE?"**
> Two layers: the system prompt instructs Claude to return only a `CREATE INDEX` statement in the `fix_sql` field, and the `/api/apply-fix` endpoint hard-rejects anything that doesn't begin with `CREATE INDEX`. The user also sees and approves the exact SQL in the modal before it runs.

---

## Timing guide for a 5-minute pitch

| Time | What |
|------|------|
| 0:00–0:30 | Problem: slow queries, DBA bottleneck, O(n) scans |
| 0:30–1:00 | Live demo — ask the question, watch it think |
| 1:00–2:00 | Walk the agent steps trace — "this is how it investigated" |
| 2:00–2:30 | Show the permission gate — "always_ask, the agent can't act unilaterally" |
| 2:30–3:00 | Show the result — "37x faster" |
| 3:00–3:30 | Export the report — "this is the Outcome artifact" |
| 3:30–4:30 | Architecture: Managed Agent + Postgres MCP + Slack trigger |
| 4:30–5:00 | Close: "Three Anthropic primitives, one live demo, real speedup" |

---

## Key numbers to memorise

- **50,000** orders in the demo database
- **~3ms** typical query time before the fix (full table scan)
- **~0.09ms** typical query time after (indexed lookup)
- **~37x faster** — the speedup you'll show live
- **5 agent steps** in the investigation trail
- **3 platform primitives** demonstrated: Outcomes, Permission Policies, MCP connectors
