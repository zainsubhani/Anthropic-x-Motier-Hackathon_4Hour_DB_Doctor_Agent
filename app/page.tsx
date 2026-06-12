'use client';

import { useState, useEffect, useRef } from 'react';

/* ── Types ────────────────────────────────────────────────────────── */

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

/* ── Export ───────────────────────────────────────────────────────── */

function exportReport(question: string, diagnose: DiagnoseResult, fixResult: FixResult | null) {
  const ts = new Date().toISOString();
  const lines = [
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
    '```', diagnose.explain_plan, '```',
    '',
    `**Query time before fix:** ${diagnose.query_time_ms.toFixed(2)}ms`,
    '',
    '## Recommended Fix',
    '```sql', diagnose.fix_sql, '```',
    '',
    diagnose.explanation,
    `**Expected improvement:** ${diagnose.expected_improvement}`,
  ];
  if (fixResult) {
    lines.push('', '## Outcome',
      '| Metric | Value |', '|--------|-------|',
      `| Before | ${fixResult.before_ms.toFixed(2)}ms |`,
      `| After  | ${fixResult.after_ms.toFixed(2)}ms |`,
      `| Speedup | **${fixResult.speedup}x faster** |`,
      '', '**EXPLAIN QUERY PLAN (after)**', '```', fixResult.explain_after, '```');
  }
  lines.push('', '---', '*Powered by Claude (claude-opus-4-8) · DB Doctor*');
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `db-doctor-report-${Date.now()}.md`; a.click();
  URL.revokeObjectURL(url);
}

/* ── Animated counter ─────────────────────────────────────────────── */

function AnimatedNumber({ value }: { value: string }) {
  const [display, setDisplay] = useState('0');
  const target = parseFloat(value);

  useEffect(() => {
    if (isNaN(target)) { setDisplay(value); return; }
    const duration = 1000;
    const steps = 40;
    const increment = target / steps;
    let current = 0;
    let step = 0;
    const timer = setInterval(() => {
      step++;
      current = Math.min(current + increment, target);
      setDisplay(current.toFixed(1));
      if (step >= steps) { setDisplay(value); clearInterval(timer); }
    }, duration / steps);
    return () => clearInterval(timer);
  }, [value, target]);

  return <span>{display}</span>;
}

/* ── Thinking indicator ───────────────────────────────────────────── */

const THINKING_STEPS = [
  'Inspecting schema…',
  'Running EXPLAIN QUERY PLAN…',
  'Timing query execution…',
  'Calling Claude…',
  'Forming diagnosis…',
];

function ThinkingIndicator() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setStep(s => Math.min(s + 1, THINKING_STEPS.length - 1)), 1800);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="animate-fade-in flex flex-col items-center gap-6 py-10">
      {/* Orbiting ring */}
      <div className="relative w-14 h-14">
        <div className="absolute inset-0 rounded-full border-2 border-[#2a2a2a]" />
        <div
          className="absolute inset-0 rounded-full border-2 border-transparent border-t-[#c96442]"
          style={{ animation: 'spin-slow 1s linear infinite' }}
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-2.5 h-2.5 rounded-full bg-[#c96442] opacity-80" />
        </div>
      </div>

      {/* Step label */}
      <div className="text-center">
        <p key={step} className="animate-fade-in-down text-[#f0ede8] text-sm font-medium">
          {THINKING_STEPS[step]}
        </p>
        <div className="flex items-center justify-center gap-1.5 mt-3">
          <span className="w-1.5 h-1.5 rounded-full bg-[#c96442] dot-1" />
          <span className="w-1.5 h-1.5 rounded-full bg-[#c96442] dot-2" />
          <span className="w-1.5 h-1.5 rounded-full bg-[#c96442] dot-3" />
        </div>
      </div>
    </div>
  );
}

/* ── Permission modal ─────────────────────────────────────────────── */

function ApproveModal({ sql, onApprove, onDeny }: {
  sql: string; onApprove: () => void; onDeny: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backdropFilter: 'blur(8px)', backgroundColor: 'rgba(0,0,0,0.7)' }}>
      <div className="animate-scale-in w-full max-w-lg rounded-2xl border border-[#2e2e2e] bg-[#141414] p-6 shadow-2xl">
        {/* Header */}
        <div className="flex items-start gap-3 mb-5">
          <div className="mt-0.5 w-8 h-8 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
            <svg className="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-white font-semibold">Permission required</h3>
              <span className="text-[10px] font-mono bg-amber-500/10 text-amber-400 border border-amber-500/20 px-1.5 py-0.5 rounded">
                always_ask
              </span>
            </div>
            <p className="text-[#888] text-sm">
              Claude wants to execute the following statement against your database.
            </p>
          </div>
        </div>

        {/* SQL preview */}
        <div className="rounded-xl border border-[#2a2a2a] bg-[#0d0d0d] p-4 mb-5">
          <div className="flex items-center gap-2 mb-2.5">
            <div className="w-2 h-2 rounded-full bg-[#c96442]" />
            <span className="text-[11px] text-[#555] font-mono uppercase tracking-wider">SQL to execute</span>
          </div>
          <pre className="text-emerald-400 text-sm font-mono leading-relaxed whitespace-pre-wrap break-all">{sql}</pre>
        </div>

        <p className="text-[#555] text-xs mb-5 leading-relaxed">
          This creates a B-tree index on <span className="text-[#888] font-mono">orders.customer_id</span>. Non-destructive — can be rolled back with <span className="text-[#888] font-mono">DROP INDEX</span>.
        </p>

        <div className="flex gap-3 justify-end">
          <button onClick={onDeny}
            className="px-4 py-2 rounded-xl border border-[#2a2a2a] text-[#888] hover:text-white hover:border-[#3a3a3a] transition-all text-sm">
            Deny
          </button>
          <button onClick={onApprove}
            className="px-5 py-2 rounded-xl bg-[#c96442] hover:bg-[#b8573a] text-white font-medium transition-all text-sm shadow-lg shadow-[#c96442]/20">
            Approve & run
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Agent trace ──────────────────────────────────────────────────── */

function AgentTrace({ steps }: { steps: AgentStep[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="animate-fade-in-up rounded-2xl border border-[#1e1e1e] bg-[#111] overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-[#161616] transition-colors group">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 rounded-full bg-[#c96442]/10 border border-[#c96442]/20 flex items-center justify-center">
            <div className="w-1.5 h-1.5 rounded-full bg-[#c96442]" />
          </div>
          <span className="text-sm font-medium text-[#d0cdc8]">Agent investigation trail</span>
          <span className="text-xs text-[#444] bg-[#1a1a1a] border border-[#222] px-2 py-0.5 rounded-full">
            {steps.length} steps
          </span>
          {steps.some(s => s.status === 'warn') && (
            <span className="text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 px-2 py-0.5 rounded-full">
              issues found
            </span>
          )}
        </div>
        <svg
          className={`w-4 h-4 text-[#444] transition-transform duration-300 ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-[#1e1e1e] px-5 pt-4 pb-5 stagger-children">
          {steps.map((step, i) => (
            <div key={i} className="animate-fade-in-up flex gap-4 mb-4 last:mb-0">
              {/* Line + dot */}
              <div className="flex flex-col items-center pt-1">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-mono shrink-0 border
                  ${step.status === 'warn'
                    ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                    : 'bg-[#c96442]/10 border-[#c96442]/20 text-[#c96442]'}`}>
                  {i + 1}
                </div>
                {i < steps.length - 1 && (
                  <div className="w-px flex-1 mt-2 bg-linear-to-b from-[#2a2a2a] to-transparent" />
                )}
              </div>
              {/* Content */}
              <div className="flex-1 pb-1 min-w-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-sm text-[#f0ede8] font-medium">{step.label}</span>
                  {step.status === 'warn'
                    ? <span className="text-xs text-amber-400">⚠ detected</span>
                    : <span className="text-xs text-[#c96442]">✓</span>}
                </div>
                <pre className="text-xs text-[#666] font-mono leading-relaxed whitespace-pre-wrap wrap-break-word">
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

/* ── Main page ────────────────────────────────────────────────────── */

const EXAMPLES = [
  "Why is fetching orders for a customer so slow?",
  "Customer order lookups are timing out — what's wrong?",
  "The orders query takes forever. How do I fix it?",
];

export default function Home() {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [diagnose, setDiagnose] = useState<DiagnoseResult | null>(null);
  const [fixing, setFixing] = useState(false);
  const [fixResult, setFixResult] = useState<FixResult | null>(null);
  const [error, setError] = useState('');
  const [showApproval, setShowApproval] = useState(false);
  const [resetting, setResetting] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (diagnose && !loading) {
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    }
  }, [diagnose, loading]);

  async function handleDiagnose(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    setLoading(true);
    setDiagnose(null);
    setFixResult(null);
    setError('');
    try {
      const res = await fetch('/api/diagnose', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
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
    setFixing(true); setError('');
    try {
      const res = await fetch('/api/apply-fix', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
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

  async function handleReset() {
    setResetting(true);
    setDiagnose(null); setFixResult(null); setError('');
    try { await fetch('/api/reset', { method: 'POST' }); }
    finally { setResetting(false); }
  }

  return (
    <>
      {showApproval && diagnose && (
        <ApproveModal
          sql={diagnose.fix_sql}
          onApprove={() => { setShowApproval(false); executeApplyFix(); }}
          onDeny={() => setShowApproval(false)}
        />
      )}

      <main className="min-h-screen bg-[#0d0d0d] text-[#f0ede8]">
        {/* Top bar */}
        <header className="sticky top-0 z-40 border-b border-[#1a1a1a] bg-[#0d0d0d]/90"
          style={{ backdropFilter: 'blur(12px)' }}>
          <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-[#c96442]/10 border border-[#c96442]/20 flex items-center justify-center">
                <span className="text-[#c96442] text-xs font-bold">DB</span>
              </div>
              <span className="font-semibold text-sm text-[#f0ede8]">DB Doctor</span>
              <span className="hidden sm:block text-xs text-[#444] border border-[#1e1e1e] px-2 py-0.5 rounded-full">
                claude-opus-4-8
              </span>
            </div>
            <button onClick={handleReset} disabled={resetting}
              className="text-xs text-[#555] hover:text-[#888] transition-colors disabled:opacity-40 flex items-center gap-1.5">
              <svg className={`w-3 h-3 ${resetting ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {resetting ? 'Resetting…' : 'Reset demo'}
            </button>
          </div>
        </header>

        <div className="max-w-2xl mx-auto px-4 pb-24">

          {/* Hero */}
          {!diagnose && !loading && (
            <div className="animate-fade-in pt-20 pb-12 text-center">
              <div className="inline-flex items-center gap-2 text-xs text-[#555] border border-[#1e1e1e] px-3 py-1.5 rounded-full mb-6">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                AI database diagnostics
              </div>
              <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-4 leading-tight">
                What's slowing down{' '}
                <span className="text-shimmer">your database?</span>
              </h1>
              <p className="text-[#666] text-lg max-w-md mx-auto leading-relaxed">
                Describe the problem in plain English. The agent investigates, diagnoses, and fixes it.
              </p>
            </div>
          )}

          {/* Compact heading when results are showing */}
          {(diagnose || loading) && (
            <div className="animate-fade-in-down pt-8 pb-6">
              <h2 className="text-xl font-semibold text-[#f0ede8]">
                {loading ? 'Investigating…' : 'Diagnosis complete'}
              </h2>
              {diagnose && !loading && (
                <p className="text-sm text-[#555] mt-1">{question}</p>
              )}
            </div>
          )}

          {/* Input */}
          <form onSubmit={handleDiagnose} className={`${diagnose || loading ? 'mb-8' : 'mb-6'}`}>
            <div className="input-glow rounded-2xl border border-[#1e1e1e] bg-[#111] transition-all duration-300">
              <div className="flex items-end gap-3 p-3">
                <textarea
                  rows={2}
                  value={question}
                  onChange={e => setQuestion(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (question.trim() && !loading) handleDiagnose(e as unknown as React.FormEvent); } }}
                  placeholder="Why are my customer order queries so slow?"
                  className="flex-1 bg-transparent resize-none text-[#f0ede8] placeholder-[#444] text-sm leading-relaxed focus:outline-none py-1 px-1"
                />
                <button type="submit" disabled={loading || !question.trim()}
                  className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-200
                    disabled:bg-[#1a1a1a] disabled:text-[#333]
                    bg-[#c96442] hover:bg-[#b8573a] text-white shadow-lg shadow-[#c96442]/20">
                  {loading
                    ? <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                      </svg>
                    : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.269 20.876L5.999 12zm0 0h7.5" />
                      </svg>
                  }
                </button>
              </div>
            </div>

            {/* Example chips */}
            {!diagnose && !loading && (
              <div className="animate-fade-in flex flex-wrap gap-2 mt-3">
                {EXAMPLES.map(q => (
                  <button key={q} type="button" onClick={() => setQuestion(q)}
                    className="text-xs text-[#555] hover:text-[#999] border border-[#1e1e1e] hover:border-[#2a2a2a] bg-[#111] hover:bg-[#161616] px-3 py-1.5 rounded-full transition-all">
                    {q}
                  </button>
                ))}
              </div>
            )}
          </form>

          {/* Error */}
          {error && (
            <div className="animate-fade-in-up mb-6 rounded-2xl border border-red-900/40 bg-red-950/20 p-4 flex gap-3">
              <svg className="w-4 h-4 text-red-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-red-300 text-sm">{error}</p>
            </div>
          )}

          {/* Thinking state */}
          {loading && <ThinkingIndicator />}

          {/* Results */}
          {diagnose && !loading && (
            <div ref={resultsRef} className="space-y-4">

              {/* Agent trace */}
              <AgentTrace steps={diagnose.steps} />

              {/* Diagnosis */}
              <div className="animate-fade-in-up delay-100 rounded-2xl border border-[#1e1e1e] bg-[#111] p-5">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <h3 className="font-semibold text-[#f0ede8]">Diagnosis</h3>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <div className="w-2 h-2 rounded-full bg-red-500" />
                    <span className="text-xs font-mono text-red-400">{diagnose.query_time_ms.toFixed(1)}ms</span>
                  </div>
                </div>
                <p className="text-[#bbb] text-sm leading-relaxed mb-4">{diagnose.diagnosis}</p>
                <div className="rounded-xl bg-[#0d0d0d] border border-[#1a1a1a] p-3.5">
                  <p className="text-[10px] text-[#444] font-mono uppercase tracking-wider mb-1.5">Root cause</p>
                  <p className="text-amber-300 text-sm">{diagnose.root_cause}</p>
                </div>
              </div>

              {/* EXPLAIN output */}
              <div className="animate-fade-in-up delay-200 rounded-2xl border border-[#1e1e1e] bg-[#111] p-5">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[10px] font-mono text-[#444] uppercase tracking-wider">EXPLAIN QUERY PLAN</span>
                  <div className="h-px flex-1 bg-[#1a1a1a]" />
                  <span className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded-full">
                    full scan
                  </span>
                </div>
                <pre className="text-sm font-mono leading-relaxed text-red-300 bg-[#0d0d0d] border border-[#1a1a1a] rounded-xl p-3.5 overflow-x-auto">
                  {diagnose.explain_plan}
                </pre>
              </div>

              {/* Recommended fix */}
              <div className="animate-fade-in-up delay-300 rounded-2xl border border-[#c96442]/20 bg-[#111] p-5">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#c96442]" />
                  <h3 className="font-semibold text-[#f0ede8]">Recommended fix</h3>
                </div>
                <p className="text-[#888] text-sm leading-relaxed mb-4 ml-3.5">{diagnose.explanation}</p>
                <div className="rounded-xl bg-[#0d0d0d] border border-[#1a1a1a] p-3.5 mb-4">
                  <pre className="text-emerald-400 text-sm font-mono leading-relaxed whitespace-pre-wrap overflow-x-auto">
                    {diagnose.fix_sql}
                  </pre>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <svg className="w-3.5 h-3.5 text-[#c96442]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                    </svg>
                    <span className="text-xs text-[#555]">
                      Expected: <span className="text-[#c96442] font-medium">{diagnose.expected_improvement}</span>
                    </span>
                  </div>
                  {!fixResult && (
                    <button onClick={() => setShowApproval(true)} disabled={fixing}
                      className="animate-glow flex items-center gap-2 px-4 py-2 rounded-xl bg-[#c96442] hover:bg-[#b8573a] disabled:bg-[#1a1a1a] disabled:text-[#444] text-white text-sm font-medium transition-all shadow-lg shadow-[#c96442]/20">
                      {fixing
                        ? <><svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> Applying…</>
                        : <><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg> Apply fix</>
                      }
                    </button>
                  )}
                </div>
              </div>

              {/* Results */}
              {fixResult && (
                <div className="animate-fade-in-up rounded-2xl border border-emerald-900/30 bg-[#0d1a12] p-5">
                  <div className="flex items-center justify-between mb-5">
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
                        <svg className="w-3 h-3 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                      <h3 className="font-semibold text-[#f0ede8]">Outcome</h3>
                    </div>
                    <button onClick={() => exportReport(question, diagnose, fixResult)}
                      className="flex items-center gap-1.5 text-xs text-[#555] hover:text-[#999] border border-[#1e1e1e] hover:border-[#2a2a2a] bg-[#111] hover:bg-[#161616] px-3 py-1.5 rounded-full transition-all">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      Export report
                    </button>
                  </div>

                  {/* Speedup display */}
                  <div className="grid grid-cols-3 gap-3 mb-5">
                    <div className="rounded-xl bg-[#0d0d0d] border border-[#1a1a1a] p-4 text-center">
                      <p className="text-[10px] text-[#444] uppercase tracking-wider mb-2">Before</p>
                      <p className="text-2xl font-mono font-bold text-red-400">{fixResult.before_ms.toFixed(1)}<span className="text-sm font-normal text-[#555]">ms</span></p>
                      <p className="text-[10px] text-[#444] mt-1">full scan</p>
                    </div>

                    <div className="rounded-xl bg-emerald-950/40 border border-emerald-800/30 p-4 text-center flex flex-col items-center justify-center">
                      <p className="animate-count-up text-4xl font-black text-emerald-400">
                        <AnimatedNumber value={fixResult.speedup} />
                        <span className="text-2xl">×</span>
                      </p>
                      <p className="text-[10px] text-emerald-600 mt-1 font-medium">faster</p>
                    </div>

                    <div className="rounded-xl bg-[#0d0d0d] border border-[#1a1a1a] p-4 text-center">
                      <p className="text-[10px] text-[#444] uppercase tracking-wider mb-2">After</p>
                      <p className="text-2xl font-mono font-bold text-emerald-400">{fixResult.after_ms.toFixed(2)}<span className="text-sm font-normal text-[#555]">ms</span></p>
                      <p className="text-[10px] text-[#444] mt-1">indexed</p>
                    </div>
                  </div>

                  {/* New EXPLAIN */}
                  <div className="rounded-xl bg-[#0a110d] border border-emerald-900/20 p-3.5">
                    <p className="text-[10px] font-mono text-[#2a5a3a] uppercase tracking-wider mb-2">New EXPLAIN QUERY PLAN</p>
                    <pre className="text-emerald-400 text-xs font-mono leading-relaxed overflow-x-auto">
                      {fixResult.explain_after}
                    </pre>
                  </div>
                </div>
              )}

              {/* Export before fix */}
              {!fixResult && (
                <div className="animate-fade-in flex justify-end">
                  <button onClick={() => exportReport(question, diagnose, null)}
                    className="flex items-center gap-1.5 text-xs text-[#444] hover:text-[#777] transition-colors">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Export diagnosis report
                  </button>
                </div>
              )}

            </div>
          )}
        </div>

        {/* Footer */}
        <footer className="fixed bottom-0 inset-x-0 border-t border-[#141414] bg-[#0d0d0d]/90 py-3"
          style={{ backdropFilter: 'blur(12px)' }}>
          <p className="text-center text-[10px] text-[#333]">
            Powered by Claude · Anthropic x Motier Hackathon ·{' '}
            <span className="text-[#3a3a3a]">In production: Managed Agent + Postgres MCP</span>
          </p>
        </footer>
      </main>
    </>
  );
}
