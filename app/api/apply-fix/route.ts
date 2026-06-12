import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

const SLOW_QUERY = 'SELECT o.*, c.name, c.email FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.customer_id = ?';

function timeQuery(): number {
  const db = getDb();
  const start = performance.now();
  db.prepare(SLOW_QUERY).all(42);
  return performance.now() - start;
}

function runExplain(): string {
  const db = getDb();
  const plan = db
    .prepare(`EXPLAIN QUERY PLAN ${SLOW_QUERY}`)
    .all(42) as Array<{ detail: string }>;
  return plan.map((r) => r.detail).join('\n');
}

export async function POST(req: NextRequest) {
  const { fix_sql, before_ms } = await req.json();
  if (!fix_sql) return NextResponse.json({ error: 'fix_sql required' }, { status: 400 });

  const sqlUpper = (fix_sql as string).trim().toUpperCase();
  if (!sqlUpper.startsWith('CREATE INDEX') && !sqlUpper.startsWith('CREATE UNIQUE INDEX')) {
    return NextResponse.json({ error: 'Only CREATE INDEX statements are allowed' }, { status: 400 });
  }

  const db = getDb();

  try {
    db.exec(fix_sql);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes('already exists')) {
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  const after_ms = timeQuery();
  const explain_after = runExplain();
  const speedup = before_ms ? (before_ms / after_ms).toFixed(1) : null;

  return NextResponse.json({
    success: true,
    before_ms,
    after_ms,
    speedup,
    explain_after,
  });
}
