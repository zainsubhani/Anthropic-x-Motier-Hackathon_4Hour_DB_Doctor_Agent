import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function POST() {
  const db = getDb();

  const indexes = db
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='orders' AND name NOT LIKE 'sqlite_%'")
    .all() as Array<{ name: string }>;

  for (const { name } of indexes) {
    db.exec(`DROP INDEX IF EXISTS ${name}`);
  }

  const plan = db
    .prepare('EXPLAIN QUERY PLAN SELECT o.*, c.name, c.email FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.customer_id = ?')
    .all(42) as Array<{ detail: string }>;

  return NextResponse.json({
    dropped: indexes.map((i) => i.name),
    explain_plan: plan.map((r) => r.detail).join('\n'),
  });
}
