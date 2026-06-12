import { NextRequest, NextResponse } from 'next/server';

interface NotifyPayload {
  question: string;
  diagnosis: string;
  root_cause: string;
  fix_sql: string;
  explanation: string;
  expected_improvement: string;
  explain_plan: string;
  query_time_ms: number;
  before_ms?: number;
  after_ms?: number;
  speedup?: string;
  explain_after?: string;
}

function buildBlocks(p: NotifyPayload) {
  const fixed = p.speedup != null;

  // Header
  const blocks: object[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: '🩺 DB Doctor — Diagnosis Report', emoji: true },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Question asked:*\n${p.question}` },
    },
    { type: 'divider' },
    // Status row
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Status*\n${fixed ? '✅ Fixed' : '🔴 Issue found'}` },
        { type: 'mrkdwn', text: `*Query time*\n\`${p.query_time_ms.toFixed(1)}ms\` — full scan` },
      ],
    },
    // Diagnosis
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Diagnosis*\n${p.diagnosis}` },
    },
    // Root cause
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Root cause*\n> ${p.root_cause}` },
    },
    // EXPLAIN
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*EXPLAIN QUERY PLAN (before)*\n\`\`\`${p.explain_plan}\`\`\`` },
    },
    { type: 'divider' },
    // Fix SQL
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Recommended fix*\n\`\`\`${p.fix_sql}\`\`\`` },
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `📈 ${p.expected_improvement}  •  ${p.explanation}` }],
    },
  ];

  // Before/after section if fix was applied
  if (fixed) {
    blocks.push(
      { type: 'divider' },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: '*Outcome — fix applied* ✅' },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Before*\n\`${p.before_ms!.toFixed(1)}ms\` (full scan)` },
          { type: 'mrkdwn', text: `*After*\n\`${p.after_ms!.toFixed(2)}ms\` (indexed)` },
          { type: 'mrkdwn', text: `*Speedup*\n*${p.speedup}× faster* 🚀` },
        ],
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*New EXPLAIN QUERY PLAN*\n\`\`\`${p.explain_after}\`\`\``,
        },
      },
    );
  }

  blocks.push(
    { type: 'divider' },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Powered by *Claude claude-opus-4-8* · DB Doctor · ${new Date().toUTCString()}`,
        },
      ],
    },
  );

  return blocks;
}

export async function POST(req: NextRequest) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    return NextResponse.json({ error: 'SLACK_WEBHOOK_URL not configured' }, { status: 503 });
  }

  const payload: NotifyPayload = await req.json();

  const body = {
    text: `DB Doctor: ${payload.question}`,
    blocks: buildBlocks(payload),
  };

  const slackRes = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!slackRes.ok) {
    const text = await slackRes.text();
    return NextResponse.json({ error: `Slack error: ${text}` }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
