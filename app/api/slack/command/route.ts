import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { getDb } from '@/lib/db';

const SLOW_QUERY =
  'SELECT o.*, c.name, c.email FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.customer_id = ?';

/* ── Slack signature verification ─────────────────────────────────── */
async function verifySlackSignature(req: NextRequest, rawBody: string): Promise<boolean> {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret) return false;

  const timestamp = req.headers.get('x-slack-request-timestamp') ?? '';
  const slackSig  = req.headers.get('x-slack-signature') ?? '';

  // Reject requests older than 5 minutes
  if (Math.abs(Date.now() / 1000 - parseInt(timestamp)) > 300) return false;

  const baseString = `v0:${timestamp}:${rawBody}`;
  const hmac       = crypto.createHmac('sha256', secret).update(baseString).digest('hex');
  const expected   = `v0=${hmac}`;

  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(slackSig));
}

/* ── DB helpers (same as diagnose route) ─────────────────────────── */
function getSchemaText(): string {
  const db = getDb();
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all() as Array<{ name: string }>;
  return tables.map(({ name }) => {
    const info = db.prepare(`PRAGMA table_info(${name})`).all() as Array<{
      name: string; type: string; notnull: number; pk: number;
    }>;
    const cols = info
      .map(c => `  ${c.name} ${c.type}${c.pk ? ' PRIMARY KEY' : ''}${c.notnull ? ' NOT NULL' : ''}`)
      .join(',\n');
    return `CREATE TABLE ${name} (\n${cols}\n);`;
  }).join('\n\n');
}

function runExplain(): string {
  const db   = getDb();
  const plan = db.prepare(`EXPLAIN QUERY PLAN ${SLOW_QUERY}`).all(42) as Array<{ detail: string }>;
  return plan.map(r => r.detail).join('\n');
}

function timeQuery(): number {
  const db    = getDb();
  const start = performance.now();
  db.prepare(SLOW_QUERY).all(42);
  return performance.now() - start;
}

/* ── Slack Block Kit helpers ─────────────────────────────────────── */
function diagnosisBlocks(question: string, diagnosis: string, rootCause: string, fixSql: string, explanation: string, expectedImprovement: string, explainPlan: string, queryTimeMs: number) {
  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: '🩺 DB Doctor — Diagnosis', emoji: true },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Question:* ${question}` },
    },
    { type: 'divider' },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Status*\n🔴 Issue found` },
        { type: 'mrkdwn', text: `*Query time*\n\`${queryTimeMs.toFixed(1)}ms\`` },
      ],
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Root cause*\n> ${rootCause}` },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*EXPLAIN QUERY PLAN*\n\`\`\`${explainPlan}\`\`\`` },
    },
    { type: 'divider' },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Recommended fix*\n\`\`\`${fixSql}\`\`\`` },
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `📈 ${expectedImprovement} · ${explanation}` }],
    },
    { type: 'divider' },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '⏳ *Waiting for approval to apply fix* — open DB Doctor to approve.',
      },
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: 'Powered by *Claude claude-opus-4-8* · DB Doctor' }],
    },
  ];
}

/* ── POST handler ────────────────────────────────────────────────── */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  // Verify signature (skip in dev if secret not set)
  if (process.env.SLACK_SIGNING_SECRET) {
    const valid = await verifySlackSignature(req, rawBody);
    if (!valid) return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const params     = new URLSearchParams(rawBody);
  const question   = (params.get('text') ?? '').trim();
  const responseUrl = params.get('response_url') ?? '';

  // Acknowledge Slack immediately (must respond within 3s)
  const ack = NextResponse.json({
    response_type: 'in_channel',
    text: `🔍 DB Doctor is investigating: _"${question || 'slow query diagnostic'}"_`,
  });

  // Run diagnosis asynchronously and POST back to Slack
  (async () => {
    try {
      const schema       = getSchemaText();
      const explainOutput = runExplain();
      const queryTimeMs  = timeQuery();
      const client       = new Anthropic();

      const stream = await client.messages.stream({
        model: 'claude-opus-4-8',
        max_tokens: 2048,
        thinking: { type: 'adaptive' },
        system: `You are a database performance expert. Diagnose slow SQLite queries and suggest fixes.
Return a JSON object with exactly these fields (no markdown, no explanation outside JSON):
{
  "diagnosis": "short 1-2 sentence explanation of what is wrong",
  "root_cause": "the specific technical reason",
  "fix_sql": "a single CREATE INDEX statement",
  "explanation": "2-3 sentences explaining why this index helps",
  "expected_improvement": "estimated speedup like '10-50x faster'"
}`,
        messages: [{
          role: 'user',
          content: `User question: ${question || 'Why is the customer orders query slow?'}

Schema:
${schema}

Query: ${SLOW_QUERY}

EXPLAIN QUERY PLAN:
${explainOutput}

Query execution time: ${queryTimeMs.toFixed(1)}ms

Diagnose the problem.`,
        }],
      });

      const response  = await stream.finalMessage();
      const textBlock = response.content.find(b => b.type === 'text');
      const raw       = textBlock?.text ?? '{}';

      let parsed: Record<string, string>;
      try {
        const match = raw.match(/\{[\s\S]*\}/);
        parsed = JSON.parse(match?.[0] ?? raw);
      } catch {
        parsed = { diagnosis: raw, root_cause: '', fix_sql: '', explanation: '', expected_improvement: '' };
      }

      // Post diagnosis back to Slack
      if (responseUrl) {
        await fetch(responseUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            replace_original: true,
            blocks: diagnosisBlocks(
              question || 'slow query diagnostic',
              parsed.diagnosis,
              parsed.root_cause,
              parsed.fix_sql,
              parsed.explanation,
              parsed.expected_improvement,
              explainOutput,
              queryTimeMs,
            ),
          }),
        });
      }
    } catch (err) {
      if (responseUrl) {
        await fetch(responseUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: `❌ DB Doctor error: ${err instanceof Error ? err.message : String(err)}` }),
        });
      }
    }
  })();

  return ack;
}
