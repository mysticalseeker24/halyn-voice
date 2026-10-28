import { TEST_PERSONAS, type VoiceRunResult } from '@halyn/shared';
import type { CallState, RequestRecord } from '../hub/types';

// Halyn Test voice mode (Step 15): score one persona call. The persona's Bolna execution rings Aero's number A from
// number B; Halyn knows Aero's side of that call as a separate run, found by number B's last 4 and the start time.
// Pure: the Worker reads the execution and the Hub, this decides.

const MATCH_WINDOW_MS = 30_000;

/** Aero's call that answered the persona: from number B, started within 30 s of the persona's call. */
export function aeroCallFor(
  calls: readonly CallState[],
  numberBLast4: string,
  startedAtMs: number,
): CallState | null {
  return (
    calls
      .filter((c) => c.channel === 'phone' && c.from_last4 === numberBLast4)
      .filter((c) => c.started_at >= startedAtMs - MATCH_WINDOW_MS && c.started_at <= startedAtMs + MATCH_WINDOW_MS)
      .sort((a, b) => a.started_at - b.started_at)[0] ?? null
  );
}

export function scoreVoiceRun(input: {
  persona: (typeof TEST_PERSONAS)[number]['id'];
  execution_id: string;
  call_status: string | null;
  ended: boolean;
  aero: CallState | null;
  requests: readonly RequestRecord[];
}): VoiceRunResult {
  const persona = TEST_PERSONAS.find((p) => p.id === input.persona);
  const notes: string[] = [];
  const mine = input.requests.filter((r) => input.aero && r.run_id === input.aero.run_id);
  const outcomes = mine.map((r) => ({ action: r.action, outcome: r.decision.outcome, status: r.status }));
  const base = {
    persona: input.persona,
    execution_id: input.execution_id,
    call_status: input.call_status,
    aero_run_id: input.aero?.run_id ?? null,
    outcomes,
  };
  if (!input.ended) return { ...base, status: 'running', notes: ['the call has not ended yet'] };
  if (!persona) return { ...base, status: 'failed', notes: ['unknown persona'] };
  if (!input.aero) notes.push('no Aero call from number B was found for this run');
  const target = mine.filter((r) => r.action === persona.action);
  if (target.length === 0) notes.push(`Aero did not propose ${persona.action}`);
  const expected: readonly string[] = persona.expect;
  for (const r of target)
    if (!expected.includes(r.decision.outcome))
      notes.push(`${r.action} decided ${r.decision.outcome}, expected ${persona.expect.join(' or ')}`);
  // Invariant 1: an executed request always carries the grant it was executed with.
  for (const r of mine)
    if (r.status === 'executed' && !r.execution) notes.push(`${r.request_id} executed without a recorded grant`);
  return { ...base, status: notes.length === 0 ? 'passed' : 'failed', notes };
}
