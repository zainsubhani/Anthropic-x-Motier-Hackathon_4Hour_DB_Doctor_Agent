'use client';

import { useState, useEffect, useRef } from 'react';

/* ── Design tokens (mirrors globals.css) ──────────────────────────── */
const C = {
  bg:        '#0F172A',
  surface:   '#1E293B',
  border:    '#334155',
  borderHov: '#475569',
  primary:   '#2563EB',
  primaryHov:'#1D4ED8',
  secondary: '#7C3AED',
  success:   '#10B981',
  warning:   '#F59E0B',
  error:     '#EF4444',
  textPri:   '#F8FAFC',
  textSec:   '#94A3B8',
  textMuted: '#64748B',
} as const;

/* ── Types ────────────────────────────────────────────────────────── */
interface AgentStep   { label: string; detail: string; status: 'ok' | 'warn'; }
interface DiagnoseResult {
  diagnosis: string; root_cause: string; fix_sql: string;
  explanation: string; expected_improvement: string;
  query: string; explain_plan: string; query_time_ms: number;
  steps: AgentStep[];
}
interface FixResult {
  success: boolean; before_ms: number; after_ms: number;
  speedup: string; explain_after: string;
}

/* ── Export ───────────────────────────────────────────────────────── */
function exportReport(question: string, d: DiagnoseResult, fix: FixResult | null) {
  const ts = new Date().toISOString();
  const lines = [
    '# DB Doctor — Outcome Report',
    `**Generated:** ${ts}`, `**Question:** ${question}`, '',
    '## Agent Steps',
    ...d.steps.map((s, i) => `${i + 1}. **${s.label}** ${s.status === 'warn' ? '⚠️' : '✅'}\n   > ${s.detail}`),
    '', '## Diagnosis', `**Root cause:** ${d.root_cause}`, '', d.diagnosis, '',
    '## EXPLAIN QUERY PLAN (before)', '```', d.explain_plan, '```', '',
    `**Before:** ${d.query_time_ms.toFixed(2)}ms`, '',
    '## Recommended Fix', '```sql', d.fix_sql, '```', '', d.explanation,
    `**Expected:** ${d.expected_improvement}`,
  ];
  if (fix) {
    lines.push('', '## Outcome',
      '| Metric | Value |', '|--------|-------|',
      `| Before | ${fix.before_ms.toFixed(2)}ms |`,
      `| After  | ${fix.after_ms.toFixed(2)}ms |`,
      `| Speedup | **${fix.speedup}x faster** |`,
      '', '```', fix.explain_after, '```');
  }
  lines.push('', '---', '*Powered by Claude (claude-opus-4-8) · DB Doctor*');
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `db-doctor-report-${Date.now()}.md`; a.click();
  URL.revokeObjectURL(url);
}

/* ── Animated counter ─────────────────────────────────────────────── */
function AnimatedNumber({ value }: { value: string }) {
  const [display, setDisplay] = useState('0');
  const target = parseFloat(value);
  useEffect(() => {
    if (isNaN(target)) { setDisplay(value); return; }
    const steps = 40; let current = 0; let step = 0;
    const timer = setInterval(() => {
      step++; current = Math.min(current + target / steps, target);
      setDisplay(current.toFixed(1));
      if (step >= steps) { setDisplay(value); clearInterval(timer); }
    }, 1000 / steps);
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
    <div className="animate-fade-in flex flex-col items-center gap-6 py-12">
      {/* Dual-ring spinner */}
      <div className="relative w-14 h-14">
        <div className="absolute inset-0 rounded-full border-2"
          style={{ borderColor: C.border }} />
        <div className="absolute inset-0 rounded-full border-2 border-transparent"
          style={{ borderTopColor: C.primary, animation: 'spin-slow 1s linear infinite' }} />
        <div className="absolute inset-2 rounded-full border-2 border-transparent"
          style={{ borderTopColor: C.secondary, animation: 'spin-slow 1.5s linear infinite reverse' }} />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: C.primary }} />
        </div>
      </div>
      <div className="text-center">
        <p key={step} className="animate-fade-in-down text-sm font-medium" style={{ color: C.textPri }}>
          {THINKING_STEPS[step]}
        </p>
        <div className="flex items-center justify-center gap-1.5 mt-3">
          <span className="w-1.5 h-1.5 rounded-full dot-1" style={{ backgroundColor: C.primary }} />
          <span className="w-1.5 h-1.5 rounded-full dot-2" style={{ backgroundColor: C.secondary }} />
          <span className="w-1.5 h-1.5 rounded-full dot-3" style={{ backgroundColor: C.primary }} />
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
      style={{ backdropFilter: 'blur(8px)', backgroundColor: 'rgba(15,23,42,0.85)' }}>
      <div className="animate-scale-in w-full max-w-lg rounded-2xl p-6 shadow-2xl"
        style={{ background: C.surface, border: `1px solid ${C.border}` }}>
        {/* Header */}
        <div className="flex items-start gap-3 mb-5">
          <div className="mt-0.5 w-8 h-8 rounded-full flex items-center justify-center shrink-0"
            style={{ background: `${C.warning}18`, border: `1px solid ${C.warning}40` }}>
            <svg className="w-4 h-4" style={{ color: C.warning }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold" style={{ color: C.textPri }}>Permission required</h3>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                style={{ background: `${C.warning}18`, color: C.warning, border: `1px solid ${C.warning}40` }}>
                always_ask
              </span>
            </div>
            <p className="text-sm" style={{ color: C.textSec }}>
              Claude wants to execute the following statement against your database.
            </p>
          </div>
        </div>

        {/* SQL block */}
        <div className="rounded-xl p-4 mb-5" style={{ background: C.bg, border: `1px solid ${C.border}` }}>
          <div className="flex items-center gap-2 mb-2.5">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: C.primary }} />
            <span className="text-[11px] font-mono uppercase tracking-wider" style={{ color: C.textMuted }}>
              SQL to execute
            </span>
          </div>
          <pre className="text-sm font-mono leading-relaxed whitespace-pre-wrap break-all"
            style={{ color: C.success }}>{sql}</pre>
        </div>

        <p className="text-xs mb-5 leading-relaxed" style={{ color: C.textMuted }}>
          This creates a B-tree index on{' '}
          <span className="font-mono" style={{ color: C.textSec }}>orders.customer_id</span>.
          Non-destructive — rollback with{' '}
          <span className="font-mono" style={{ color: C.textSec }}>DROP INDEX</span>.
        </p>

        <div className="flex gap-3 justify-end">
          <button onClick={onDeny}
            className="px-4 py-2 rounded-xl text-sm transition-all hover:opacity-80"
            style={{ border: `1px solid ${C.border}`, color: C.textSec }}>
            Deny
          </button>
          <button onClick={onApprove}
            className="px-5 py-2 rounded-xl text-white font-medium text-sm transition-all hover:opacity-90"
            style={{ background: C.primary, boxShadow: `0 4px 16px ${C.primary}40` }}>
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
    <div className="animate-fade-in-up rounded-2xl overflow-hidden"
      style={{ border: `1px solid ${C.border}`, background: C.surface }}>
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 transition-colors hover:opacity-80">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 rounded-full flex items-center justify-center"
            style={{ background: `${C.secondary}18`, border: `1px solid ${C.secondary}40` }}>
            <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: C.secondary }} />
          </div>
          <span className="text-sm font-medium" style={{ color: C.textPri }}>Agent investigation trail</span>
          <span className="text-xs px-2 py-0.5 rounded-full"
            style={{ color: C.textMuted, background: C.bg, border: `1px solid ${C.border}` }}>
            {steps.length} steps
          </span>
          {steps.some(s => s.status === 'warn') && (
            <span className="text-xs px-2 py-0.5 rounded-full"
              style={{ color: C.warning, background: `${C.warning}18`, border: `1px solid ${C.warning}40` }}>
              issues found
            </span>
          )}
        </div>
        <svg className={`w-4 h-4 transition-transform duration-300 ${open ? 'rotate-180' : ''}`}
          style={{ color: C.textMuted }}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="px-5 pt-4 pb-5 stagger-children"
          style={{ borderTop: `1px solid ${C.border}` }}>
          {steps.map((step, i) => (
            <div key={i} className="animate-fade-in-up flex gap-4 mb-4 last:mb-0">
              <div className="flex flex-col items-center pt-1">
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-mono shrink-0 border"
                  style={step.status === 'warn'
                    ? { background: `${C.warning}18`, borderColor: `${C.warning}40`, color: C.warning }
                    : { background: `${C.primary}18`, borderColor: `${C.primary}40`, color: C.primary }}>
                  {i + 1}
                </div>
                {i < steps.length - 1 && (
                  <div className="w-px flex-1 mt-2 bg-linear-to-b"
                    style={{ background: `linear-gradient(to bottom, ${C.border}, transparent)` }} />
                )}
              </div>
              <div className="flex-1 pb-1 min-w-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-sm font-medium" style={{ color: C.textPri }}>{step.label}</span>
                  {step.status === 'warn'
                    ? <span className="text-xs" style={{ color: C.warning }}>⚠ detected</span>
                    : <span className="text-xs" style={{ color: C.primary }}>✓</span>}
                </div>
                <pre className="text-xs font-mono leading-relaxed whitespace-pre-wrap wrap-break-word"
                  style={{ color: C.textMuted }}>
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

/* ── Stat card ────────────────────────────────────────────────────── */
function StatCard({ label, value, unit, sub, accent }: {
  label: string; value: string; unit: string; sub: string; accent: string;
}) {
  return (
    <div className="rounded-xl p-4 text-center" style={{ background: C.bg, border: `1px solid ${C.border}` }}>
      <p className="text-[10px] uppercase tracking-wider mb-2" style={{ color: C.textMuted }}>{label}</p>
      <p className="text-2xl font-mono font-bold" style={{ color: accent }}>
        {value}<span className="text-sm font-normal" style={{ color: C.textMuted }}>{unit}</span>
      </p>
      <p className="text-[10px] mt-1" style={{ color: C.textMuted }}>{sub}</p>
    </div>
  );
}

/* ── Main page ────────────────────────────────────────────────────── */
const EXAMPLES = [
  'Why is fetching orders for a customer so slow?',
  'Customer order lookups are timing out — what\'s wrong?',
  'The orders query takes forever. How do I fix it?',
];

export default function Home() {
  const [question, setQuestion]     = useState('');
  const [loading,  setLoading]      = useState(false);
  const [diagnose, setDiagnose]     = useState<DiagnoseResult | null>(null);
  const [fixing,   setFixing]       = useState(false);
  const [fixResult,setFixResult]    = useState<FixResult | null>(null);
  const [error,    setError]        = useState('');
  const [showApproval, setShowApproval] = useState(false);
  const [resetting,setResetting]    = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (diagnose && !loading)
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
  }, [diagnose, loading]);

  async function handleDiagnose(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    setLoading(true); setDiagnose(null); setFixResult(null); setError('');
    try {
      const res  = await fetch('/api/diagnose', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Diagnosis failed');
      setDiagnose(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally { setLoading(false); }
  }

  async function executeApplyFix() {
    if (!diagnose) return;
    setFixing(true); setError('');
    try {
      const res  = await fetch('/api/apply-fix', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fix_sql: diagnose.fix_sql, before_ms: diagnose.query_time_ms }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Fix failed');
      setFixResult(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally { setFixing(false); }
  }

  async function handleReset() {
    setResetting(true); setDiagnose(null); setFixResult(null); setError('');
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

      <main className="min-h-screen" style={{ background: C.bg, color: C.textPri }}>

        {/* ── Header ── */}
        <header className="sticky top-0 z-40" style={{
          borderBottom: `1px solid ${C.border}`,
          background: `${C.bg}e6`,
          backdropFilter: 'blur(12px)',
        }}>
          <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              {/* Logo */}
              <div className="w-7 h-7 rounded-lg flex items-center justify-center"
                style={{ background: `${C.primary}18`, border: `1px solid ${C.primary}40` }}>
                <span className="text-xs font-bold" style={{ color: C.primary }}>DB</span>
              </div>
              <span className="font-semibold text-sm" style={{ color: C.textPri }}>DB Doctor</span>
              {/* Model badge — violet */}
              <span className="hidden sm:block text-xs px-2 py-0.5 rounded-full"
                style={{ color: C.secondary, background: `${C.secondary}18`, border: `1px solid ${C.secondary}30` }}>
                claude-opus-4-8
              </span>
            </div>
            <button onClick={handleReset} disabled={resetting}
              className="flex items-center gap-1.5 text-xs transition-colors disabled:opacity-40 hover:opacity-70"
              style={{ color: C.textMuted }}>
              <svg className={`w-3 h-3 ${resetting ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {resetting ? 'Resetting…' : 'Reset demo'}
            </button>
          </div>
        </header>

        <div className="max-w-2xl mx-auto px-4 pb-24">

          {/* ── Hero ── */}
          {!diagnose && !loading && (
            <div className="animate-fade-in pt-20 pb-12 text-center">
              {/* Live badge */}
              <div className="inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-full mb-6"
                style={{ color: C.textMuted, border: `1px solid ${C.border}` }}>
                <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: C.success }} />
                AI database diagnostics
              </div>
              <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-4 leading-tight"
                style={{ color: C.textPri }}>
                What&apos;s slowing down{' '}
                <span className="text-shimmer">your database?</span>
              </h1>
              <p className="text-lg max-w-md mx-auto leading-relaxed" style={{ color: C.textSec }}>
                Describe the problem in plain English. The agent investigates, diagnoses, and fixes it.
              </p>
            </div>
          )}

          {/* ── Compact heading ── */}
          {(diagnose || loading) && (
            <div className="animate-fade-in-down pt-8 pb-6">
              <h2 className="text-xl font-semibold" style={{ color: C.textPri }}>
                {loading ? 'Investigating…' : 'Diagnosis complete'}
              </h2>
              {diagnose && !loading && (
                <p className="text-sm mt-1" style={{ color: C.textMuted }}>{question}</p>
              )}
            </div>
          )}

          {/* ── Input ── */}
          <form onSubmit={handleDiagnose} className={diagnose || loading ? 'mb-8' : 'mb-6'}>
            <div className="input-glow rounded-2xl transition-all duration-300"
              style={{ border: `1px solid ${C.border}`, background: C.surface }}>
              <div className="flex items-end gap-3 p-3">
                <textarea rows={2} value={question}
                  onChange={e => setQuestion(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      if (question.trim() && !loading) handleDiagnose(e as unknown as React.FormEvent);
                    }
                  }}
                  placeholder="Why are my customer order queries so slow?"
                  className="flex-1 bg-transparent resize-none text-sm leading-relaxed focus:outline-none py-1 px-1"
                  style={{ color: C.textPri }}
                />
                <button type="submit" disabled={loading || !question.trim()}
                  className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-200 disabled:opacity-30"
                  style={{ background: question.trim() && !loading ? C.primary : C.border, color: '#fff', boxShadow: question.trim() && !loading ? `0 4px 12px ${C.primary}40` : 'none' }}>
                  {loading
                    ? <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
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
                    className="text-xs px-3 py-1.5 rounded-full transition-all hover:opacity-80"
                    style={{ color: C.textSec, border: `1px solid ${C.border}`, background: C.surface }}>
                    {q}
                  </button>
                ))}
              </div>
            )}
          </form>

          {/* ── Error ── */}
          {error && (
            <div className="animate-fade-in-up mb-6 rounded-2xl p-4 flex gap-3"
              style={{ border: `1px solid ${C.error}40`, background: `${C.error}10` }}>
              <svg className="w-4 h-4 mt-0.5 shrink-0" style={{ color: C.error }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm" style={{ color: C.error }}>{error}</p>
            </div>
          )}

          {/* ── Thinking ── */}
          {loading && <ThinkingIndicator />}

          {/* ── Results ── */}
          {diagnose && !loading && (
            <div ref={resultsRef} className="space-y-4">

              {/* Agent trace */}
              <AgentTrace steps={diagnose.steps} />

              {/* Diagnosis card */}
              <div className="animate-fade-in-up delay-100 rounded-2xl p-5"
                style={{ border: `1px solid ${C.border}`, background: C.surface }}>
                <div className="flex items-start justify-between gap-4 mb-4">
                  <h3 className="font-semibold" style={{ color: C.textPri }}>Diagnosis</h3>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: C.error }} />
                    <span className="text-xs font-mono" style={{ color: C.error }}>
                      {diagnose.query_time_ms.toFixed(1)}ms
                    </span>
                  </div>
                </div>
                <p className="text-sm leading-relaxed mb-4" style={{ color: C.textSec }}>
                  {diagnose.diagnosis}
                </p>
                <div className="rounded-xl p-3.5" style={{ background: C.bg, border: `1px solid ${C.border}` }}>
                  <p className="text-[10px] font-mono uppercase tracking-wider mb-1.5" style={{ color: C.textMuted }}>
                    Root cause
                  </p>
                  <p className="text-sm" style={{ color: C.warning }}>{diagnose.root_cause}</p>
                </div>
              </div>

              {/* EXPLAIN card */}
              <div className="animate-fade-in-up delay-200 rounded-2xl p-5"
                style={{ border: `1px solid ${C.border}`, background: C.surface }}>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: C.textMuted }}>
                    EXPLAIN QUERY PLAN
                  </span>
                  <div className="h-px flex-1" style={{ background: C.border }} />
                  <span className="text-xs px-2 py-0.5 rounded-full"
                    style={{ color: C.error, background: `${C.error}15`, border: `1px solid ${C.error}30` }}>
                    full scan
                  </span>
                </div>
                <pre className="text-sm font-mono leading-relaxed rounded-xl p-3.5 overflow-x-auto"
                  style={{ color: C.error, background: C.bg, border: `1px solid ${C.border}` }}>
                  {diagnose.explain_plan}
                </pre>
              </div>

              {/* Fix card — primary blue border accent */}
              <div className="animate-fade-in-up delay-300 rounded-2xl p-5 animate-border-glow"
                style={{ border: `1px solid ${C.primary}50`, background: C.surface }}>
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: C.primary }} />
                  <h3 className="font-semibold" style={{ color: C.textPri }}>Recommended fix</h3>
                </div>
                <p className="text-sm leading-relaxed mb-4 ml-3.5" style={{ color: C.textSec }}>
                  {diagnose.explanation}
                </p>
                <div className="rounded-xl p-3.5 mb-4" style={{ background: C.bg, border: `1px solid ${C.border}` }}>
                  <pre className="text-sm font-mono leading-relaxed whitespace-pre-wrap overflow-x-auto"
                    style={{ color: C.success }}>
                    {diagnose.fix_sql}
                  </pre>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <svg className="w-3.5 h-3.5" style={{ color: C.success }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                    </svg>
                    <span className="text-xs" style={{ color: C.textMuted }}>
                      Expected:{' '}
                      <span style={{ color: C.success, fontWeight: 500 }}>
                        {diagnose.expected_improvement}
                      </span>
                    </span>
                  </div>
                  {!fixResult && (
                    <button onClick={() => setShowApproval(true)} disabled={fixing}
                      className="animate-glow flex items-center gap-2 px-4 py-2 rounded-xl text-white text-sm font-medium transition-all disabled:opacity-40"
                      style={{ background: C.primary, boxShadow: `0 4px 16px ${C.primary}40` }}>
                      {fixing
                        ? <><svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                            Applying…</>
                        : <><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                            Apply fix</>
                      }
                    </button>
                  )}
                </div>
              </div>

              {/* Outcome card */}
              {fixResult && (
                <div className="animate-fade-in-up rounded-2xl p-5"
                  style={{ border: `1px solid ${C.success}40`, background: `${C.success}08` }}>
                  <div className="flex items-center justify-between mb-5">
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-full flex items-center justify-center"
                        style={{ background: `${C.success}20`, border: `1px solid ${C.success}40` }}>
                        <svg className="w-3 h-3" style={{ color: C.success }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                      <h3 className="font-semibold" style={{ color: C.textPri }}>Outcome</h3>
                    </div>
                    <button onClick={() => exportReport(question, diagnose, fixResult)}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full transition-all hover:opacity-80"
                      style={{ color: C.textSec, border: `1px solid ${C.border}`, background: C.surface }}>
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      Export report
                    </button>
                  </div>

                  {/* Before / Speedup / After */}
                  <div className="grid grid-cols-3 gap-3 mb-5">
                    <StatCard label="Before" value={fixResult.before_ms.toFixed(1)} unit="ms" sub="full scan" accent={C.error} />
                    {/* Speedup — centrepiece */}
                    <div className="rounded-xl p-4 text-center flex flex-col items-center justify-center"
                      style={{ background: `${C.success}12`, border: `1px solid ${C.success}40` }}>
                      <p className="animate-count-up text-4xl font-black" style={{ color: C.success }}>
                        <AnimatedNumber value={fixResult.speedup} /><span className="text-2xl">×</span>
                      </p>
                      <p className="text-[10px] font-medium mt-1" style={{ color: C.success }}>faster</p>
                    </div>
                    <StatCard label="After" value={fixResult.after_ms.toFixed(2)} unit="ms" sub="indexed" accent={C.success} />
                  </div>

                  {/* New EXPLAIN */}
                  <div className="rounded-xl p-3.5"
                    style={{ background: C.bg, border: `1px solid ${C.success}25` }}>
                    <p className="text-[10px] font-mono uppercase tracking-wider mb-2" style={{ color: `${C.success}80` }}>
                      New EXPLAIN QUERY PLAN
                    </p>
                    <pre className="text-xs font-mono leading-relaxed overflow-x-auto" style={{ color: C.success }}>
                      {fixResult.explain_after}
                    </pre>
                  </div>
                </div>
              )}

              {/* Export before fix */}
              {!fixResult && (
                <div className="animate-fade-in flex justify-end">
                  <button onClick={() => exportReport(question, diagnose, null)}
                    className="flex items-center gap-1.5 text-xs transition-colors hover:opacity-70"
                    style={{ color: C.textMuted }}>
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

        {/* ── Footer ── */}
        <footer className="fixed bottom-0 inset-x-0 py-3"
          style={{ borderTop: `1px solid ${C.border}`, background: `${C.bg}e6`, backdropFilter: 'blur(12px)' }}>
          <p className="text-center text-[10px]" style={{ color: C.border }}>
            Powered by Claude · Anthropic x Motier Hackathon ·{' '}
            <span style={{ color: C.textMuted }}>In production: Managed Agent + Postgres MCP</span>
          </p>
        </footer>

      </main>
    </>
  );
}
