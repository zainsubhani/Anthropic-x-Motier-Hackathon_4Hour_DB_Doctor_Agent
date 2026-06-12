'use client';

import { useState } from 'react';

interface DiagnoseResult {
  diagnosis: string;
  root_cause: string;
  fix_sql: string;
  explanation: string;
  expected_improvement: string;
  query: string;
  explain_plan: string;
  query_time_ms: number;
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

export default function Home() {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [diagnose, setDiagnose] = useState<DiagnoseResult | null>(null);
  const [fixing, setFixing] = useState(false);
  const [fixResult, setFixResult] = useState<FixResult | null>(null);
  const [error, setError] = useState('');

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

  async function handleApplyFix() {
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

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-bold text-white mb-2">
            <span className="text-red-400">DB</span> Doctor
          </h1>
          <p className="text-gray-400 text-lg">AI-powered database performance diagnostics</p>
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
            <div className="text-blue-400 text-lg">Analyzing your database...</div>
            <div className="text-gray-500 text-sm mt-2">Running EXPLAIN QUERY PLAN and diagnosing with Claude</div>
          </div>
        )}

        {/* Diagnosis result */}
        {diagnose && !loading && (
          <div className="space-y-4">
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

            {/* Fix */}
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
                    onClick={handleApplyFix}
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
                <h2 className="text-xl font-bold text-white mb-4 text-center">Results</h2>
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
          </div>
        )}

        {/* Footer pitch */}
        <div className="mt-10 border-t border-gray-800 pt-6 text-center text-gray-600 text-xs">
          Powered by Claude &middot; In production: Managed Agent + Postgres MCP, triggered from Slack
        </div>
      </div>
    </main>
  );
}
