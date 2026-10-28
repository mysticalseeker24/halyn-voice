import { describe, expect, it } from 'vitest';
import { eventForOutcome, OUTCOME_EVENT_NAMES, OutcomeEventSchema } from './events';

const REQ = 'req_01J9Z8X7W6V5T4S3R2Q1P0N9M8';

describe('outcome events sent into calls', () => {
  it.each([
    { event: 'allow', properties: { request_id: REQ } },
    { event: 'done', properties: { reference: 'AERO-FRZ-0001', summary: 'Card ending 8812 is frozen.' } },
    { event: 'step_up', properties: { request_id: REQ, channels: ['passkey', 'callback'] } },
    { event: 'approved', properties: { request_id: REQ } },
    { event: 'denied', properties: { request_id: REQ, reason: 'C_DECLINED' } },
    { event: 'timeout', properties: { request_id: REQ, reason: 'C_TIMEOUT' } },
    { event: 'hold', properties: { request_id: REQ, reason: 'S_COACHING' } },
    { event: 'deny', properties: { request_id: REQ, reason: 'I_NO_PROOF' } },
    { event: 'recorded', properties: { request_id: REQ } },
  ])('accepts $event', (body) => {
    expect(OutcomeEventSchema.parse(body)).toEqual(body);
  });

  it('covers exactly the events in docs/API.md', () => {
    expect(OUTCOME_EVENT_NAMES).toEqual([
      'allow',
      'done',
      'step_up',
      'approved',
      'denied',
      'timeout',
      'hold',
      'deny',
      'recorded',
    ]);
  });

  it.each([
    ['an unknown event', { event: 'transfer', properties: { request_id: REQ } }],
    ['a step-up without channels', { event: 'step_up', properties: { request_id: REQ, channels: [] } }],
    ['a deny without a reason', { event: 'deny', properties: { request_id: REQ } }],
    ['a deny with an unknown reason', { event: 'deny', properties: { request_id: REQ, reason: 'BECAUSE' } }],
    ['extra properties', { event: 'allow', properties: { request_id: REQ, amount: 1 } }],
    ['an over-long summary', { event: 'done', properties: { reference: 'r', summary: 'x'.repeat(301) } }],
  ])('rejects %s', (_, body) => {
    expect(OutcomeEventSchema.safeParse(body).success).toBe(false);
  });

  it('maps a Gate outcome to the first event of its path', () => {
    expect(eventForOutcome('allow')).toBe('allow');
    expect(eventForOutcome('step_up')).toBe('step_up');
    expect(eventForOutcome('hold')).toBe('hold');
    expect(eventForOutcome('deny')).toBe('deny');
  });
});
