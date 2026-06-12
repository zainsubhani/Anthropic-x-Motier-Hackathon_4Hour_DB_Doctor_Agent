# DB Doctor — Agent Skills

This document defines the skills (tools) available to the DB Doctor agent — both in their current hackathon implementation and as they would be registered on Anthropic's Managed Agents platform for production.

---

## Overview

The DB Doctor agent has **5 skills** across two categories:

| Category | Skill | Mutates DB? | Requires Approval? |
|----------|-------|-------------|-------------------|
| Read | `inspect_schema` | No | No |
| Read | `explain_query` | No | No |
| Read | `time_query` | No | No |
| Read | `list_indexes` | No | No |
| Write | `create_index` | **Yes** | **Yes — always_ask** |

---

## Skill definitions

### 1. `inspect_schema`

Reads the full database schema — tables, columns, types, and constraints.

**Hackathon implementation** (`app/api/diagnose/route.ts`):
```typescript
function getSchemaWithMeta() {
  const db = getDb();
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all() as Array<{ name: string }>;

  const tableNames = tables.map(t => t.name);
  const columnCounts: Record<string, number> = {};

  const schema = tables.map(({ name }) => {
    const info = db.prepare(`PRAGMA table_info(${name})`).all();
    columnCounts[name] = info.length;
    // returns CREATE TABLE DDL string
  }).join('\n\n');

  return { schema, tableNames, columnCounts };
}
```

**Production MCP tool definition** (YAML):
```yaml
name: inspect_schema
description: >
  Returns the full DDL schema for all tables in the database, including
  column names, types, nullability, and primary key constraints.
  Also returns row counts and existing indexes per table.
input_schema:
  type: object
  properties:
    table_filter:
      type: array
      items:
        type: string
      description: Optional list of table names to inspect. Omit to return all tables.
  required: []
output_schema:
  type: object
  properties:
    schema_ddl:
      type: string
    tables:
      type: array
      items:
        type: object
        properties:
          name: { type: string }
          column_count: { type: integer }
          row_count: { type: integer }
    indexes:
      type: array
      items:
        type: object
        properties:
          name: { type: string }
          table: { type: string }
          columns: { type: array, items: { type: string } }
permission: read_only
```

---

### 2. `explain_query`

Runs `EXPLAIN QUERY PLAN` on a SQL statement and returns the execution plan. Detects full table scans, index usage, and join strategies.

**Hackathon implementation**:
```typescript
function runExplain(): string {
  const db = getDb();
  const plan = db
    .prepare(`EXPLAIN QUERY PLAN ${SLOW_QUERY}`)
    .all(42) as Array<{ detail: string }>;
  return plan.map(r => r.detail).join('\n');
}
```

**Production MCP tool definition**:
```yaml
name: explain_query
description: >
  Runs EXPLAIN QUERY PLAN (SQLite) or EXPLAIN ANALYZE (Postgres) on the
  provided SQL statement and returns the parsed execution plan.
  Automatically flags full table scans, sequential scans, and missing indexes.
input_schema:
  type: object
  properties:
    sql:
      type: string
      description: The SQL query to explain. May contain $1/$2 or ? placeholders.
    params:
      type: array
      description: Optional bound parameter values for the query placeholders.
      items: {}
  required: [sql]
output_schema:
  type: object
  properties:
    plan_text:
      type: string
      description: Raw EXPLAIN output
    has_full_scan:
      type: boolean
      description: True if any SCAN (SQLite) or Seq Scan (Postgres) was detected
    scan_tables:
      type: array
      items: { type: string }
      description: Names of tables being fully scanned
permission: read_only
```

---

### 3. `time_query`

Executes a query and measures wall-clock execution time in milliseconds. Runs the query three times and returns the median to reduce noise.

**Hackathon implementation**:
```typescript
function timeQuery(): number {
  const db = getDb();
  const start = performance.now();
  db.prepare(SLOW_QUERY).all(42);
  return performance.now() - start;
}
```

**Production MCP tool definition**:
```yaml
name: time_query
description: >
  Executes the provided SQL query and measures execution time in milliseconds.
  Runs the query multiple times and returns median, min, and max to account
  for caching effects. Uses a representative sample parameter value.
input_schema:
  type: object
  properties:
    sql:
      type: string
      description: The SQL query to time.
    params:
      type: array
      description: Bound parameter values.
      items: {}
    runs:
      type: integer
      default: 3
      description: Number of timed executions. Returns the median.
  required: [sql]
output_schema:
  type: object
  properties:
    median_ms: { type: number }
    min_ms: { type: number }
    max_ms: { type: number }
    row_count: { type: integer }
permission: read_only
```

---

### 4. `list_indexes`

Returns all existing indexes on the database — names, target tables, and indexed columns. Used to check whether a fix has already been applied.

**Hackathon implementation**:
```typescript
function getIndexes(): string[] {
  const db = getDb();
  const indexes = db
    .prepare("SELECT name, tbl_name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'")
    .all() as Array<{ name: string; tbl_name: string }>;
  return indexes.map(i => `${i.name} on ${i.tbl_name}`);
}
```

**Production MCP tool definition**:
```yaml
name: list_indexes
description: >
  Returns all user-defined indexes in the database — names, target tables,
  indexed columns, and whether each is unique. Used to determine whether
  a recommended index already exists before suggesting it.
input_schema:
  type: object
  properties:
    table:
      type: string
      description: Optional. Filter to indexes on a specific table.
  required: []
output_schema:
  type: object
  properties:
    indexes:
      type: array
      items:
        type: object
        properties:
          name: { type: string }
          table: { type: string }
          columns: { type: array, items: { type: string } }
          unique: { type: boolean }
          size_bytes: { type: integer }
permission: read_only
```

---

### 5. `create_index`

Creates an index on the specified table and column(s). This is the **only write skill** — it requires explicit human approval before execution (`always_ask`).

**Hackathon implementation** (`app/api/apply-fix/route.ts`):
```typescript
// Allowlist: only CREATE INDEX is accepted
const sqlUpper = fix_sql.trim().toUpperCase();
if (!sqlUpper.startsWith('CREATE INDEX') && !sqlUpper.startsWith('CREATE UNIQUE INDEX')) {
  return NextResponse.json({ error: 'Only CREATE INDEX statements are allowed' }, { status: 400 });
}
db.exec(fix_sql);
```

**UI permission gate** (`app/page.tsx`):
```typescript
// Apply Fix button → opens ApproveModal (never calls API directly)
// Only onApprove() triggers the fetch to /api/apply-fix
<button onClick={() => setShowApproval(true)}>Apply fix</button>
```

**Production MCP tool definition**:
```yaml
name: create_index
description: >
  Creates a database index on the specified table and column(s).
  WRITE OPERATION — requires explicit human approval before execution.
  After creation, automatically re-runs explain_query and time_query on
  the original slow query to measure the improvement.
input_schema:
  type: object
  properties:
    index_name:
      type: string
      description: Name for the new index (e.g. idx_orders_customer_id)
    table:
      type: string
      description: Table to index
    columns:
      type: array
      items: { type: string }
      description: Columns to include in the index, in order
    unique:
      type: boolean
      default: false
      description: Whether to create a UNIQUE index
    if_not_exists:
      type: boolean
      default: true
  required: [index_name, table, columns]
output_schema:
  type: object
  properties:
    success: { type: boolean }
    index_name: { type: string }
    before_ms: { type: number }
    after_ms: { type: number }
    speedup_factor: { type: number }
    new_explain_plan: { type: string }
permission: always_ask          # ← platform permission policy
audit_log: true                 # ← all executions logged
rollback_hint: "DROP INDEX {index_name}"
```

---

## Agent system prompt

The system prompt sent to `claude-opus-4-8` on every `/api/diagnose` call:

```
You are a database performance expert. Diagnose slow SQLite queries and suggest fixes.
Return a JSON object with exactly these fields (no markdown, no explanation outside JSON):
{
  "diagnosis": "short 1-2 sentence explanation of what is wrong",
  "root_cause": "the specific technical reason (e.g. full table scan, missing index)",
  "fix_sql": "a single CREATE INDEX statement that will fix the problem",
  "explanation": "2-3 sentences explaining why this index helps",
  "expected_improvement": "estimated speedup like '10-50x faster'"
}
```

**Context injected per request:**
- Full schema DDL (output of `inspect_schema`)
- The slow query SQL
- EXPLAIN QUERY PLAN output (output of `explain_query`)
- Query execution time in ms (output of `time_query`)
- List of existing indexes (output of `list_indexes`)

---

## Skill execution order

```
User question (natural language)
        │
        ▼
  inspect_schema ──────────────────────────────┐
        │                                       │
        ▼                                       │
  explain_query  ──── detects SCAN? ──► flag   │
        │                                       │ all context
        ▼                                       │ sent to Claude
   time_query    ──── slow? ──────────► flag   │
        │                                       │
        ▼                                       │
  list_indexes   ──── already indexed? ──► note │
        │                                       │
        └───────────────────────────────────────┘
                        │
                        ▼
              claude-opus-4-8
              (adaptive thinking)
                        │
                        ▼
              diagnosis + fix_sql
                        │
                        ▼
              [human reviews + approves]
                        │
                        ▼
              create_index ──► measure improvement
                        │
                        ▼
              Outcome artifact (exported report)
```

---

## Adding a new skill

### Step 1 — Implement the function in the route

Add a new function to `app/api/diagnose/route.ts` (for read skills) or `app/api/apply-fix/route.ts` (for write skills):

```typescript
function myNewSkill(param: string): string {
  const db = getDb();
  // synchronous DB call
  return result;
}
```

### Step 2 — Add it as an agent step

```typescript
const myResult = myNewSkill(param);
steps.push({
  label: 'My new skill ran',
  detail: myResult,
  status: myResult.includes('problem') ? 'warn' : 'ok',
});
```

### Step 3 — Inject the result into the Claude prompt

```typescript
messages: [{
  role: 'user',
  content: `...existing context...
  
My new skill output:
${myResult}

Diagnose the problem...`
}]
```

### Step 4 — If it's a write skill, add an allowlist check

In `app/api/apply-fix/route.ts`:
```typescript
const ALLOWED_PREFIXES = ['CREATE INDEX', 'CREATE UNIQUE INDEX', 'MY NEW WRITE COMMAND'];
const isAllowed = ALLOWED_PREFIXES.some(p => sqlUpper.startsWith(p));
if (!isAllowed) return NextResponse.json({ error: 'Not allowed' }, { status: 400 });
```

### Step 5 — Update this file

Add the new skill to the overview table and write its full definition following the YAML template above.

---

## Production deployment checklist

To deploy DB Doctor as a Managed Agent on Anthropic's platform:

```
[ ] Register agent in Anthropic Console with the system prompt above
[ ] Connect Postgres MCP server to your production database
[ ] Configure permission policy: create_index = always_ask
[ ] Enable audit logging on all write skills
[ ] Set up Slack MCP connector for /db-doctor trigger
[ ] Replace inspect_schema / explain_query / time_query / list_indexes
    with their Postgres MCP equivalents (same skill names, Postgres syntax)
[ ] Test with a staging database before connecting production
[ ] Set up Outcome artifact delivery (to Jira / Notion / Slack thread)
```
