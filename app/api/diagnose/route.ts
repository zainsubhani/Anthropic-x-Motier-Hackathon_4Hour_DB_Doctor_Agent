import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getDb } from '@/lib/db';

const SLOW_QUERY = 'SELECT o.*, c.name, c.email FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.customer_id = ?';

function getSchema(): string {
  const db = getDb();
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all() as Array<{ name: string }>;

  return tables
    .map(({ name }) => {
      const info = db.prepare(`PRAGMA table_info(${name})`).all() as Array<{
        name: string;
        type: string;
        notnull: number;
        pk: number;
      }>;
      const cols = info.map((c) => `  ${c.name} ${c.type}${c.pk ? ' PRIMARY KEY' : ''}${c.notnull ? ' NOT NULL' : ''}`).join(',\n');
      return `CREATE TABLE ${name} (\n${cols}\n);`;
    })
    .join('\n\n');
}

function runExplain(): string {
  const db = getDb();
  const plan = db
    .prepare(`EXPLAIN QUERY PLAN ${SLOW_QUERY}`)
    .all(42) as Array<{ detail: string }>;
  return plan.map((r) => r.detail).join('\n');
}

function timeQuery(): number {
  const db = getDb();
  const start = performance.now();
  db.prepare(SLOW_QUERY).all(42);
  return performance.now() - start;
}

export async function POST(req: NextRequest) {
  const { question } = await req.json();
  if (!question) return NextResponse.json({ error: 'question required' }, { status: 400 });

  const schema = getSchema();
  const explainOutput = runExplain();
  const queryTimeMs = timeQuery();

  const client = new Anthropic();

  const stream = await client.messages.stream({
    model: 'claude-opus-4-8',
    max_tokens: 2048,
    thinking: { type: 'adaptive' },
    system: `You are a database performance expert. Diagnose slow SQLite queries and suggest fixes.
Return a JSON object with exactly these fields (no markdown, no explanation outside JSON):
{
  "diagnosis": "short 1-2 sentence explanation of what is wrong",
  "root_cause": "the specific technical reason (e.g. full table scan, missing index)",
  "fix_sql": "a single CREATE INDEX statement that will fix the problem",
  "explanation": "2-3 sentences explaining why this index helps",
  "expected_improvement": "estimated speedup like '10-50x faster'"
}`,
    messages: [
      {
        role: 'user',
        content: `User question: ${question}

Schema:
${schema}

Slow query being executed:
${SLOW_QUERY}

EXPLAIN QUERY PLAN output:
${explainOutput}

Current query execution time: ${queryTimeMs.toFixed(1)}ms

Diagnose the problem and suggest the best fix.`,
      },
    ],
  });

  const response = await stream.finalMessage();
  const textBlock = response.content.find((b) => b.type === 'text');
  const raw = textBlock?.text ?? '{}';

  let parsed: Record<string, string>;
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch?.[0] ?? raw);
  } catch {
    parsed = { diagnosis: raw, root_cause: '', fix_sql: '', explanation: '', expected_improvement: '' };
  }

  return NextResponse.json({
    ...parsed,
    query: SLOW_QUERY,
    explain_plan: explainOutput,
    query_time_ms: queryTimeMs,
  });
}
