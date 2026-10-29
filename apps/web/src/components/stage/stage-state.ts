import type { LedgerVerifyResponseSchema, Money, WsMessage } from '@halyn/shared';
import type { z } from 'zod';
import type { TimelineItem } from '@/components/event-timeline';
import type { ChainStatus, LedgerLine } from '@/components/ledger-lines';
import { ACTION_LABELS } from '@/lib/format';
import { OUTCOME_LABEL } from '@/components/outcome-badge';

type Msg<T extends WsMessage['type']> = Extract<WsMessage, { type: T }>;

export interface TranscriptLine {
  id: string;
  at: string;
  agent: Msg<'call_update'>['agent'];
  speaker: Msg<'call_update'>['speaker'];
  text: string;
}

export interface StageState {
  transcript: TranscriptLine[];
  decision: Msg<'decision'> | null;
  confirmRequest: Msg<'confirm_request'> | null;
  confirmResolved: Msg<'confirm_resolved'> | null;
  handoff: Msg<'handoff'> | null;
  ledger: LedgerLine[];
  chain: ChainStatus;
  timeline: TimelineItem[];
  balance: Money | null;
  activity: { reference: string; summary: string; amount: Money | null; at: string }[];
  progress: Msg<'test_progress'> | null;
}

export const initialStageState: StageState = {
  transcript: [],
  decision: null,
  confirmRequest: null,
  confirmResolved: null,
  handoff: null,
  ledger: [],
  chain: { state: 'unchecked' },
  timeline: [],
  balance: null,
  activity: [],
  progress: null,
};

export type StageAction =
  | { type: 'ws'; message: WsMessage }
  | { type: 'run_started' }
  | { type: 'ledger_loaded'; lines: LedgerLine[] }
  | { type: 'chain_checked'; result: z.infer<typeof LedgerVerifyResponseSchema> };

const KEEP = 50;
const tail = <T>(list: T[], item: T): T[] => [...list, item].slice(-KEEP);

type CallMsg = Msg<'call_update'>;

/**
 * Bolna's end-of-call transcript arrives as one system message ("assistant: … user: …"). Split it into agent and
 * caller lines so the Live call panel reads as a conversation, not one block of text. Anything else stays one line.
 */
function callLines(message: CallMsg): { speaker: CallMsg['speaker']; text: string }[] {
  if (message.speaker !== 'system') return [{ speaker: message.speaker, text: message.text }];
  const parts = message.text
    .split(/(?:^|\s)(?=(?:assistant|user)\s*:)/i)
    .map((p) => /^(assistant|user)\s*:\s*([\s\S]+)$/i.exec(p.trim()))
    .filter((m): m is RegExpExecArray => m !== null && Boolean(m[2]?.trim()));
  if (parts.length === 0) return [{ speaker: 'system', text: message.text }];
  return parts.map((m) => ({
    speaker: m[1]?.toLowerCase() === 'user' ? 'caller' : 'agent',
    text: (m[2] ?? '').trim(),
  }));
}

function timelineItem(message: WsMessage, index: number): TimelineItem {
  const id = `${message.type}-${message.at}-${index}`;
  switch (message.type) {
    case 'decision':
      return {
        id,
        at: message.at,
        kind: 'Decision',
        label: `${ACTION_LABELS[message.action]}: ${OUTCOME_LABEL[message.decision.outcome]}`,
        tone: { allow: 'good', step_up: 'warn', hold: 'hold', deny: 'bad' }[
          message.decision.outcome
        ] as TimelineItem['tone'],
      };
    case 'confirm_request':
      return { id, at: message.at, kind: 'Confirm asked', label: message.channels.join(' + '), tone: 'warn' };
    case 'confirm_resolved':
      return {
        id,
        at: message.at,
        kind: `Confirm ${message.status}`,
        label: message.channel ?? 'no answer',
        tone: message.status === 'approved' ? 'good' : 'bad',
      };
    case 'core_update':
      return {
        id,
        at: message.at,
        kind: 'Aero Core',
        label: message.activity?.summary ?? 'balance updated',
        tone: 'good',
      };
    case 'handoff':
      return { id, at: message.at, kind: 'Handoff', label: `specialist ${message.status}`, tone: 'hold' };
    case 'ledger_append':
      return { id, at: message.at, kind: 'Ledger', label: `#${message.seq} ${message.entry_type}` };
    case 'call_update':
      return { id, at: message.at, kind: `Call · ${message.agent}`, label: message.text };
    case 'test_progress':
      return {
        id,
        at: message.at,
        kind: 'Scenario',
        label: `${message.scenario_id} ${message.status} (${message.completed}/${message.total})`,
        tone: message.status === 'failed' ? 'bad' : message.status === 'passed' ? 'good' : 'neutral',
      };
  }
}

export function stageReducer(state: StageState, action: StageAction): StageState {
  switch (action.type) {
    case 'run_started':
      return {
        ...initialStageState,
        ledger: state.ledger,
        chain: state.chain,
        balance: state.balance,
        activity: state.activity,
      };
    case 'ledger_loaded':
      return { ...state, ledger: action.lines.slice(-KEEP) };
    case 'chain_checked':
      return {
        ...state,
        chain: action.result.ok
          ? { state: 'verified', entries: action.result.entries }
          : { state: 'broken', firstBadSeq: action.result.first_bad_seq },
      };
    case 'ws': {
      const message = action.message;
      const next: StageState = {
        ...state,
        timeline: tail(state.timeline, timelineItem(message, state.timeline.length)),
      };
      switch (message.type) {
        case 'decision':
          return { ...next, decision: message };
        case 'confirm_request':
          return { ...next, confirmRequest: message, confirmResolved: null };
        case 'confirm_resolved':
          return { ...next, confirmResolved: message };
        case 'handoff':
          return { ...next, handoff: message };
        case 'call_update':
          return {
            ...next,
            transcript: callLines(message).reduce(
              (list, line, i) =>
                tail(list, {
                  id: `${message.run_id}-${state.transcript.length + i}`,
                  at: message.at,
                  agent: message.agent,
                  speaker: line.speaker,
                  text: line.text,
                }),
              state.transcript,
            ),
          };
        case 'core_update':
          return {
            ...next,
            balance: message.balance,
            activity: message.activity
              ? tail(state.activity, { ...message.activity, at: message.at })
              : state.activity,
          };
        case 'ledger_append': {
          if (state.ledger.some((l) => l.seq === message.seq)) return next;
          const line: LedgerLine = {
            seq: message.seq,
            entry_type: message.entry_type,
            ref_id: message.ref_id,
            hash: message.hash,
            prev_hash: message.prev_hash,
            chain_ok: message.chain_ok,
          };
          return {
            ...next,
            ledger: tail(state.ledger, line),
            chain: !message.chain_ok
              ? { state: 'broken', firstBadSeq: message.seq }
              : state.chain.state === 'verified'
                ? { state: 'verified', entries: state.chain.entries + 1 }
                : state.chain,
          };
        }
        case 'test_progress':
          return { ...next, progress: message };
      }
    }
  }
}
