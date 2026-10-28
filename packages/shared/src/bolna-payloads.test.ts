import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CheckDecisionRequestSchema,
  ConfirmResultRequestSchema,
  GetPassCodeRequestSchema,
  LookupCustomerRequestSchema,
  ProposeActionRequestSchema,
  VerifyPassRequestSchema,
} from './api';
import {
  BolnaCallResponseSchema,
  BolnaEventAcceptedSchema,
  BolnaEventRefusedSchema,
  BolnaExecutionSchema,
  BolnaStopResponseSchema,
  bolnaAnswer,
  bolnaBoolean,
  bolnaParams,
  bolnaPhone,
  bolnaQuotes,
  bolnaValue,
  isTerminalExecution,
  normalizeToolBody,
} from './bolna-payloads';

const RUN = 'b1f6c8e2-7d3a-4c1e-9f00-123456789abc';

describe('bolnaValue', () => {
  it.each([
    [undefined, undefined],
    [null, undefined],
    ['', undefined],
    ['   ', undefined],
    ['%(execution_id)s', undefined],
    ['None', undefined],
    ['null', undefined],
    ['undefined', undefined],
    ['NaN', undefined],
    [' 8812 ', '8812'],
    [42, 42],
    [true, true],
  ])('%j → %j', (input, expected) => expect(bolnaValue(input)).toEqual(expected));

  it('caps very long strings', () => {
    expect((bolnaValue('x'.repeat(5000)) as string).length).toBe(4000);
  });
});

describe('bolnaBoolean', () => {
  it.each([
    ['true', true],
    ['TRUE', true],
    ['yes', true],
    ['1', true],
    ['false', false],
    ['No', false],
    ['0', false],
    [true, true],
    [false, false],
    ['maybe', 'maybe'],
    ['%(readback_confirmed)s', undefined],
  ])('%j → %j', (input, expected) => expect(bolnaBoolean(input)).toEqual(expected));
});

describe('bolnaPhone', () => {
  it.each([
    ['+918065356344', '+918065356344'],
    ['+91 80653 56344', '+918065356344'],
    ['919000000002', '+919000000002'],
    ['09000000003', '+919000000003'],
    ['9000000001', '+919000000001'],
    ['(080) 6535-6344', '+918065356344'],
    ['12-34', '12-34'],
    ['19000000006', '+19000000006'],
    ['abc', 'abc'],
    [12345, 12345],
    ['%(from_number)s', undefined],
  ])('%j → %j', (input, expected) => expect(bolnaPhone(input)).toEqual(expected));
});

describe('bolnaQuotes', () => {
  it.each([
    [undefined, []],
    ['%(caller_quotes)s', []],
    [
      ['a', '', 'b', null, 3],
      ['a', 'b'],
    ],
    ['["one","two"]', ['one', 'two']],
    ['[not json', ['[not json']],
    ['first line\n\nsecond line', ['first line', 'second line']],
    [{ x: 1 }, { x: 1 }],
  ])('%j → %j', (input, expected) => expect(bolnaQuotes(input)).toEqual(expected));
});

describe('bolnaAnswer', () => {
  it.each([
    ['approve', 'approve'],
    ['Yes', 'approve'],
    ['haan', 'approve'],
    ['decline', 'decline'],
    ['NO', 'decline'],
    ['nahi', 'decline'],
    ['later', 'later'],
    [7, 7],
  ])('%j → %j', (input, expected) => expect(bolnaAnswer(input)).toEqual(expected));
});

describe('bolnaParams', () => {
  it('takes a params object, drops unfilled values and reads integer params written as digits', () => {
    expect(
      bolnaParams('transfer.new_payee', {
        params: {
          amount_minor: '4500000',
          currency: 'INR',
          payee_account_last4: '4471',
          payee_ifsc: 'AERO0000001',
          payee_name: '%(payee_name)s',
        },
      }),
    ).toEqual({
      amount_minor: 4500000,
      currency: 'INR',
      payee_account_last4: '4471',
      payee_ifsc: 'AERO0000001',
    });
  });

  it('keeps last-4 digits as strings (only integer params become numbers)', () => {
    expect(bolnaParams('card.freeze', { params: { card_last4: '0042' } })).toEqual({ card_last4: '0042' });
  });

  it('parses a params JSON string, and passes a non-JSON string through for the schema to refuse', () => {
    expect(bolnaParams('card.freeze', { params: '{"card_last4":"8812"}' })).toEqual({ card_last4: '8812' });
    expect(bolnaParams('card.freeze', { params: 'card 8812' })).toBe('card 8812');
  });

  it("collects flat params (the Day-0 agent's shape) by the action's param names", () => {
    expect(
      bolnaParams('card.freeze', {
        card_last4: '8812',
        call_sid: 'CA1',
        to_number: '+918065356344',
      }),
    ).toEqual({ card_last4: '8812' });
  });

  it('collects nothing for an unknown action, and passes arrays and numbers through', () => {
    expect(bolnaParams('bank.rob', { card_last4: '8812' })).toEqual({});
    expect(bolnaParams('card.freeze', { params: [1] })).toEqual([1]);
    expect(bolnaParams('card.freeze', { params: 7 })).toBe(7);
  });

  it('keeps an own "__proto__" key so the strict schema refuses it instead of losing it', () => {
    const out = bolnaParams(
      'card.freeze',
      JSON.parse('{"params":{"card_last4":"8812","__proto__":{"x":1}}}'),
    );
    expect(Object.hasOwn(out as object, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
  });

  it('never turns a non-digit or over-long string into a number', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 20 }), (s) => {
        const out = bolnaParams('fee.waive', { params: { amount_minor: s } }) as Record<string, unknown>;
        const v = out.amount_minor;
        if (typeof v === 'number') expect(/^\d{1,15}$/.test(s.trim())).toBe(true);
      }),
      { seed: 7, numRuns: 300 },
    );
  });
});

describe('normalizeToolBody → strict tool schemas', () => {
  it('propose_action with flat, stringly params (Bolna substitution) parses', () => {
    const body = normalizeToolBody('propose_action', {
      run_id: RUN,
      call_sid: 'CAx',
      from_number: '919000000003',
      to_number: '+918065356344',
      action: 'card.freeze',
      card_last4: '8812',
      readback_confirmed: 'true',
      caller_quotes: 'Mera card kho gaya hai',
    });
    const parsed = ProposeActionRequestSchema.parse(body);
    expect(parsed).toMatchObject({
      run_id: RUN,
      call_sid: 'CAx',
      from_number: '+919000000003',
      channel: 'phone',
      action: 'card.freeze',
      params: { card_last4: '8812' },
      readback_confirmed: true,
      caller_quotes: ['Mera card kho gaya hai'],
    });
  });

  it('leaves run_id undefined when Bolna sent its placeholder (the API falls back to call_sid)', () => {
    const body = normalizeToolBody('propose_action', {
      run_id: '%(execution_id)s',
      call_sid: 'CAx',
      action: 'card.freeze',
      params: { card_last4: '8812' },
      readback_confirmed: true,
    }) as Record<string, unknown>;
    expect(body.run_id).toBeUndefined();
    expect(ProposeActionRequestSchema.safeParse(body).success).toBe(false);
    expect(ProposeActionRequestSchema.safeParse({ ...body, run_id: 'sid:CAx' }).success).toBe(true);
  });

  it('accepts execution_id as the run id', () => {
    const body = normalizeToolBody('check_decision', { execution_id: RUN, request_id: 'req_1' });
    expect(CheckDecisionRequestSchema.parse(body)).toEqual({ run_id: RUN, request_id: 'req_1' });
  });

  it('accepts halyn_run_id, the name agents send (Bolna refuses a tool param named run_id)', () => {
    const body = normalizeToolBody('check_decision', { halyn_run_id: RUN, request_id: 'req_1' });
    expect(CheckDecisionRequestSchema.parse(body)).toEqual({ run_id: RUN, request_id: 'req_1' });
  });

  it('lookup_customer, verify_pass, get_pass_code and confirm_result', () => {
    expect(
      LookupCustomerRequestSchema.parse(
        normalizeToolBody('lookup_customer', { run_id: RUN, from_number: '9000000001', claimed_name: '' }),
      ),
    ).toEqual({ run_id: RUN, from_number: '+919000000001' });
    expect(
      VerifyPassRequestSchema.parse(
        normalizeToolBody('verify_pass', { run_id: RUN, from_number: '+918065356379', code: '4 7 2 9 1 5' }),
      ).code,
    ).toBe('472915');
    expect(
      VerifyPassRequestSchema.parse(
        normalizeToolBody('verify_pass', { run_id: RUN, from_number: '+918065356379', code: 4729 }),
      ).code,
    ).toBe('004729');
    expect(
      GetPassCodeRequestSchema.parse(
        normalizeToolBody('get_pass_code', { run_id: RUN, pass_token: 'a.b.c', from_number: 'None' }),
      ),
    ).toEqual({ run_id: RUN, pass_token: 'a.b.c' });
    expect(
      ConfirmResultRequestSchema.parse(
        normalizeToolBody('confirm_result', { run_id: RUN, request_id: 'req_1', answer: 'Yes', method: '' }),
      ),
    ).toEqual({ run_id: RUN, request_id: 'req_1', answer: 'approve', method: 'speech' });
    // Agents send answer_method: Bolna refuses a tool param named `method` (its HTTP method keyword; Day-0 call 2).
    expect(
      ConfirmResultRequestSchema.parse(
        normalizeToolBody('confirm_result', {
          run_id: RUN,
          request_id: 'req_1',
          answer: 'no',
          answer_method: 'keypad',
        }),
      ),
    ).toMatchObject({ request_id: 'req_1', answer: 'decline', method: 'keypad' });
  });

  it('passes non-objects through for the schema to refuse', () => {
    expect(normalizeToolBody('propose_action', 'x')).toBe('x');
    expect(normalizeToolBody('propose_action', null)).toBeNull();
    expect(normalizeToolBody('propose_action', [1])).toEqual([1]);
  });

  it('never throws, whatever the body', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          'lookup_customer',
          'verify_pass',
          'propose_action',
          'get_pass_code',
          'confirm_result',
          'check_decision',
        ) as fc.Arbitrary<Parameters<typeof normalizeToolBody>[0]>,
        fc.jsonValue(),
        (tool, body) => {
          expect(() => normalizeToolBody(tool, body)).not.toThrow();
        },
      ),
      { seed: 11, numRuns: 300 },
    );
  });
});

describe('execution and REST response schemas', () => {
  it('reads a minimal and a full execution record, stripping unknown keys', () => {
    expect(BolnaExecutionSchema.parse({ id: RUN })).toEqual({ id: RUN });
    const full = BolnaExecutionSchema.parse({
      id: RUN,
      agent_id: 'a',
      status: 'completed',
      conversation_duration: 28,
      telephony_data: { from_number: null, to_number: '+919000000003', provider_call_id: 'p1', extra: 1 },
      context_details: { recipient_data: { request_id: 'req_1' } },
      cost_breakdown: { total: 1 },
    });
    expect(full.telephony_data).toEqual({
      from_number: null,
      to_number: '+919000000003',
      provider_call_id: 'p1',
    });
    expect('cost_breakdown' in full).toBe(false);
    expect(BolnaExecutionSchema.safeParse({ status: 'completed' }).success).toBe(false);
  });

  it('knows the terminal statuses', () => {
    expect(isTerminalExecution('completed')).toBe(true);
    expect(isTerminalExecution('no-answer')).toBe(true);
    expect(isTerminalExecution('in-progress')).toBe(false);
    expect(isTerminalExecution(null)).toBe(false);
    expect(isTerminalExecution(undefined)).toBe(false);
  });

  it('parses the call, event and stop responses', () => {
    expect(BolnaCallResponseSchema.parse({ execution_id: RUN, status: 'queued' }).execution_id).toBe(RUN);
    expect(BolnaEventAcceptedSchema.safeParse({ status: 'accepted' }).success).toBe(true);
    expect(BolnaEventAcceptedSchema.safeParse({ status: 'queued' }).success).toBe(false);
    expect(BolnaEventRefusedSchema.parse({ detail: 'No active call found for this run_id' }).detail).toMatch(
      /No active call/,
    );
    expect(BolnaStopResponseSchema.parse({ message: 'done', status: 'stopped' }).status).toBe('stopped');
  });
});
