'use client';

import { useState } from 'react';

interface AgentStep {
  label: string;
  detail: string;
  status: 'ok' | 'warn';
}

interface DiagnoseResult {
  diagnosis: string;
  root_cause: string;
  fix_sql: string;
  explanation: string;
  expected_improvement: string;
  query: string;
  explain_plan: string;
  query_time_ms: number;
  steps: AgentStep[];
}

interface FixResult {
  success: boolean;
  before_ms: number;
  after_ms: number;
  speedup: string;
  explain_after: string;
}

const EXAMPLE_QUESTIONS = [
  "Why is fetching orders for a customer so slow?",
  "Our customer order lookup is timing out. What's wrong?",
  "The orders query is taking forever. How do I fix it?",
];

function exportReport(question: string, diagnose: DiagnoseResult, fixResult: FixResult | null): void {
  const ts = new Date().toISOString();
  const lines: string[] = [
    '# DB Doctor — Outcome Report',
    `**Generated:** ${ts}`,
    `**Question:** ${question}`,
    '',
    '## Agent Steps',
    ...diagnose.steps.map((s, i) => `${i + 1}. **${s.label}** ${s.status === 'warn' ? '⚠️' : '✅'}\n   > ${s.detail}`),
    '',
    '## Diagnosis',
    `**Root cause:** ${diagnose.root_cause}`,
    '',
    diagnose.diagnosis,
    '',
    '## EXPLAIN QUERY PLAN (before)',
    '```',
    diagnose.explain_plan,
    '```',
    '',
    `**Query time before fix:** ${diagnose.query_time_ms.toFixed(2)}ms`,
    '',
    '## Recommended Fix',
    '```sql',
    diagnose.fix_sql,
    '```',
    '',
    diagnose.explanation,
    '',
    `**Expected improvement:** ${diagnose.expected_improvement}`,
  ];

  if (fixResult) {
    lines.push(
      '',
      '## Outcome',
      `| Metric | Value |`,
      `|--------|-------|`,
      `| Before | ${fixResult.before_ms.toFixed(2)}ms (full table scan) |`,
      `| After  | ${fixResult.after_ms.toFixed(2)}ms (indexed lookup) |`,
      `| Speedup | **${fixResult.speedup}x faster** |`,
      '',
      '**EXPLAIN QUERY PLAN (after)**',
      '```',
      fixResult.explain_after,
      '```',
    );
  }

  lines.push('', '---', '*Powered by Claude (claude-opus-4-8) · DB Doctor*');

  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `db-doctor-report-${Date.now()}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

function ApproveModal({
  sql,
  onApprove,
  onDeny,
}: {
  sql: string;
  onApprove: () => void;
  onDeny: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-yellow-700 rounded-xl max-w-lg w-full p-6 shadow-2xl">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-yellow-400 text-xl">🔐</span>
          <h2 className="text-white font-bold text-lg">Permission Required</h2>
          <span className="ml-auto text-xs bg-yellow-900/60 text-yellow-300 px-2 py-0.5 rounded font-mono">always_ask</span>
        </div>
        <p className="text-gray-400 text-sm mb-3">
          Claude wants to execute the following statement against your database:
        </p>
        <pre className="bg-gray-800 text-green-300 text-sm font-mono p-3 rounded overflow-x-auto mb-5">
          {sql}
        </pre>
        <p className="text-gray-500 text-xs mb-5">
          This will create a new index on <span className="text-gray-300 font-mono">orders.customer_id</span>. The operation is non-destructive and can be rolled back by dropping the index.
        </p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onDeny}
            className="px-4 py-2 rounded-lg border border-gray-600 text-gray-300 hover:bg-gray-800 transition-colors text-sm"
          >
            Deny
          </button>
          <button
            onClick={onApprove}
            className="px-5 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white font-semibold transition-colors text-sm"
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}

function AgentTrace({ steps }: { steps: AgentStep[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-3 text-sm font-semibold text-gray-300 hover:bg-gray-750 transition-colors"
      >
        <span className="flex items-center gap-2">
          <span className="text-blue-400">◈</span>
          Agent steps
          <span className="text-xs font-normal text-gray-500">({steps.length} steps)</span>
        </span>
        <span className="text-gray-500 text-xs">{open ? '▲ collapse' : '▼ expand'}</span>
      </button>
      {open && (
        <div className="px-5 pb-4 space-y-3 border-t border-gray-700 pt-4">
          {steps.map((step, i) => (
            <div key={i} className="flex gap-3">
              <div className="flex flex-col items-center">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs shrink-0 mt-0.5 ${step.status === 'warn' ? 'bg-yellow-900/60 text-yellow-300' : 'bg-blue-900/60 text-blue-300'}`}>
                  {i + 1}
                </div>
                {i < steps.length - 1 && <div className="w-px flex-1 bg-gray-700 mt-1" />}
              </div>
              <div className="pb-3 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-white text-sm font-medium">{step.label}</span>
                  {step.status === 'warn' && <span className="text-xs text-yellow-400">⚠ issue detected</span>}
                  {step.status === 'ok' && <span className="text-xs text-blue-400">✓</span>}
                </div>
                <pre className="text-gray-400 text-xs font-mono whitespace-pre-wrap break-all leading-relaxed">
                  {step.detail}
                </pre>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [diagnose, setDiagnose] = useState<DiagnoseResult | null>(null);
  const [fixing, setFixing] = useState(false);
  const [fixResult, setFixResult] = useState<FixResult | null>(null);
  const [error, setError] = useState('');
  const [showApproval, setShowApproval] = useState(false);
  const [resetting, setResetting] = useState(false);

  async function handleReset() {
    setResetting(true);
    setDiagnose(null);
    setFixResult(null);
    setError('');
    try {
      await fetch('/api/reset', { method: 'POST' });
    } finally {
      setResetting(false);
    }
  }

  async function handleDiagnose(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    setLoading(true);
    setDiagnose(null);
    setFixResult(null);
    setError('');
    try {
      const res = await fetch('/api/diagnose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Diagnosis failed');
      setDiagnose(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  async function executeApplyFix() {
    if (!diagnose) return;
    setFixing(true);
    setError('');
    try {
      const res = await fetch('/api/apply-fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fix_sql: diagnose.fix_sql, before_ms: diagnose.query_time_ms }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Fix failed');
      setFixResult(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setFixing(false);
    }
  }

  function handleApprove() {
    setShowApproval(false);
    executeApplyFix();
  }

  function handleDeny() {
    setShowApproval(false);
  }

  return (
    <>
      {showApproval && diagnose && (
        <ApproveModal
          sql={diagnose.fix_sql}
          onApprove={handleApprove}
          onDeny={handleDeny}
        />
      )}

      <main className="min-h-screen bg-gray-950 text-gray-100 p-6">
        <div className="max-w-3xl mx-auto">
          {/* Header */}
          <div className="mb-8 text-center relative">
            <h1 className="text-4xl font-bold text-white mb-2">
              <span className="text-red-400">DB</span> Doctor
            </h1>
            <p className="text-gray-400 text-lg">AI-powered database performance diagnostics</p>
            <button
              onClick={handleReset}
              disabled={resetting}
              className="absolute right-0 top-1 text-xs text-gray-600 hover:text-gray-400 bg-gray-800 hover:bg-gray-700 px-2 py-1 rounded transition-colors disabled:opacity-50"
            >
              {resetting ? 'Resetting...' : 'Reset demo'}
            </button>
          </div>

          {/* Question input */}
          <form onSubmit={handleDiagnose} className="mb-6">
            <div className="flex gap-3">
              <input
                type="text"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Why are my customer order queries so slow?"
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
              <button
                type="submit"
                disabled={loading || !question.trim()}
                className="bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-semibold px-6 py-3 rounded-lg transition-colors"
              >
                {loading ? 'Diagnosing...' : 'Diagnose'}
              </button>
            </div>
            <div className="flex gap-2 mt-2 flex-wrap">
              {EXAMPLE_QUESTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setQuestion(q)}
                  className="text-xs text-gray-500 hover:text-gray-300 bg-gray-800 hover:bg-gray-700 px-2 py-1 rounded transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </form>

          {/* Error */}
          {error && (
            <div className="bg-red-900/30 border border-red-700 text-red-300 rounded-lg p-4 mb-6">
              {error}
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="bg-gray-800 rounded-lg p-6 text-center">
              <div className="text-blue-400 text-lg">Agent investigating...</div>
              <div className="text-gray-500 text-sm mt-2">Inspecting schema · Running EXPLAIN · Calling Claude</div>
            </div>
          )}

          {/* Diagnosis result */}
          {diagnose && !loading && (
            <div className="space-y-4">

              {/* Agent trace — Feature #1 */}
              <AgentTrace steps={diagnose.steps} />

              {/* Diagnosis card */}
              <div className="bg-gray-800 rounded-lg p-5 border border-gray-700">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-lg font-semibold text-white">Diagnosis</h2>
                  <span className="text-xs bg-red-900/60 text-red-300 px-2 py-1 rounded font-mono">
                    {diagnose.query_time_ms.toFixed(1)}ms
                  </span>
                </div>
                <p className="text-gray-300 mb-3">{diagnose.diagnosis}</p>
                <div className="bg-gray-900 rounded p-3 text-sm">
                  <div className="text-gray-500 text-xs mb-1">Root Cause</div>
                  <div className="text-orange-300">{diagnose.root_cause}</div>
                </div>
              </div>

              {/* Query plan */}
              <div className="bg-gray-800 rounded-lg p-5 border border-gray-700">
                <h3 className="text-sm font-semibold text-gray-400 mb-2">EXPLAIN QUERY PLAN</h3>
                <pre className="text-red-300 text-sm font-mono bg-gray-900 p-3 rounded overflow-x-auto">
                  {diagnose.explain_plan}
                </pre>
              </div>

              {/* Fix — with permission gate (Feature #3) */}
              <div className="bg-gray-800 rounded-lg p-5 border border-blue-800">
                <h2 className="text-lg font-semibold text-white mb-3">Recommended Fix</h2>
                <p className="text-gray-300 text-sm mb-3">{diagnose.explanation}</p>
                <pre className="bg-gray-900 text-green-300 text-sm font-mono p-3 rounded overflow-x-auto mb-4">
                  {diagnose.fix_sql}
                </pre>
                <div className="flex items-center justify-between">
                  <span className="text-gray-500 text-sm">
                    Expected: <span className="text-green-400 font-semibold">{diagnose.expected_improvement}</span>
                  </span>
                  {!fixResult && (
                    <button
                      onClick={() => setShowApproval(true)}
                      disabled={fixing}
                      className="bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-bold px-6 py-2 rounded-lg transition-colors"
                    >
                      {fixing ? 'Applying...' : 'Apply Fix'}
                    </button>
                  )}
                </div>
              </div>

              {/* Before/After results */}
              {fixResult && (
                <div className="bg-gray-900 rounded-lg p-6 border border-green-700">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-bold text-white">Outcome</h2>
                    {/* Export button — Feature #2 */}
                    <button
                      onClick={() => exportReport(question, diagnose, fixResult)}
                      className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5"
                    >
                      <span>↓</span> Export Report
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-4 text-center mb-6">
                    <div className="bg-gray-800 rounded-lg p-4">
                      <div className="text-gray-400 text-xs mb-1">Before</div>
                      <div className="text-red-400 text-2xl font-mono font-bold">
                        {fixResult.before_ms.toFixed(1)}ms
                      </div>
                      <div className="text-gray-500 text-xs">full table scan</div>
                    </div>
                    <div className="bg-green-900/40 rounded-lg p-4 border border-green-700 flex flex-col items-center justify-center">
                      <div className="text-green-400 text-3xl font-black">
                        {fixResult.speedup}x
                      </div>
                      <div className="text-green-500 text-xs">faster</div>
                    </div>
                    <div className="bg-gray-800 rounded-lg p-4">
                      <div className="text-gray-400 text-xs mb-1">After</div>
                      <div className="text-green-400 text-2xl font-mono font-bold">
                        {fixResult.after_ms.toFixed(1)}ms
                      </div>
                      <div className="text-gray-500 text-xs">indexed lookup</div>
                    </div>
                  </div>
                  <div className="bg-gray-800 rounded p-3">
                    <div className="text-gray-500 text-xs mb-1">New EXPLAIN QUERY PLAN</div>
                    <pre className="text-green-300 text-sm font-mono overflow-x-auto">
                      {fixResult.explain_after}
                    </pre>
                  </div>
                </div>
              )}

              {/* Export before fix too */}
              {!fixResult && (
                <div className="flex justify-end">
                  <button
                    onClick={() => exportReport(question, diagnose, null)}
                    className="text-xs text-gray-500 hover:text-gray-300 bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5"
                  >
                    <span>↓</span> Export Report
                  </button>
                </div>
              )}

            </div>
          )}

          {/* Footer pitch */}
          <div className="mt-10 border-t border-gray-800 pt-6 text-center text-gray-600 text-xs">
            Powered by Claude &middot; In production: Managed Agent + Postgres MCP, triggered from Slack
          </div>
        </div>
      </main>
    </>
  );
}
