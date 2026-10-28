/// <reference types="vite/client" />
import {
  BolnaCallResponseSchema,
  BolnaEventAcceptedSchema,
  BolnaEventRefusedSchema,
  BolnaExecutionSchema,
  BolnaStopResponseSchema,
  type BolnaTool,
  BolnaToolSchema,
  CheckDecisionRequestSchema,
  ConfirmResultRequestSchema,
  GetPassCodeRequestSchema,
  LookupCustomerRequestSchema,
  normalizeToolBody,
  ProposeActionRequestSchema,
  VerifyPassRequestSchema,
} from '@halyn/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import { appHarness } from '../fixtures/app';

// Bolna's payloads (tests/fixtures/bolna, README there) against our schemas, table-driven by file name: dropping a
// real recording into the folder adds a case. Synthetic fixtures (`_source: synthetic-from-docs`) stand in until the
// Day-0 calls are recorded.

const files = import.meta.glob('../../../../tests/fixtures/bolna/*.json', { eager: true, import: 'default' });
const fixtures = Object.entries(files).map(([path, body]) => ({
  name: path.split('/').at(-1) ?? path,
  body: body as Record<string, unknown>,
}));

/** Drop `_` metadata and turn masked numbers (••••0003) back into test numbers. */
function payload(body: Record<string, unknown>): Record<string, unknown> {
  const text = JSON.stringify(Object.fromEntries(Object.entries(body).filter(([k]) => !k.startsWith('_'))));
  return JSON.parse(text.replace(/••••(\d{4})/g, '+91900000$1')) as Record<string, unknown>;
}

const TOOL_SCHEMAS: Record<BolnaTool, z.ZodType> = {
  lookup_customer: LookupCustomerRequestSchema,
  verify_pass: VerifyPassRequestSchema,
  propose_action: ProposeActionRequestSchema,
  get_pass_code: GetPassCodeRequestSchema,
  confirm_result: ConfirmResultRequestSchema,
  check_decision: CheckDecisionRequestSchema,
};

function toolOf(name: string): BolnaTool {
  return BolnaToolSchema.parse(/^tool-([a-z_]+?)(?:-[a-z0-9-]+)?\.json$/.exec(name)?.[1]);
}

afterEach(() => vi.restoreAllMocks());

describe('recorded Bolna payloads (tests/fixtures/bolna)', () => {
  it('has fixtures, and every file has a known prefix', () => {
    expect(fixtures.length).toBeGreaterThan(0);
    for (const { name } of fixtures) expect(name, name).toMatch(/^(tool|webhook|execution|call|event|stop)-/);
  });

  it.each(fixtures.map((f) => [f.name, f.body] as const))('%s matches its schema', (name, body) => {
    const data = payload(body);
    if (name.startsWith('tool-')) {
      const tool = toolOf(name);
      const normalized = normalizeToolBody(tool, data) as Record<string, unknown>;
      // The API's fallback when %(execution_id)s did not substitute (tools/common.ts).
      if (normalized.run_id === undefined && typeof normalized.call_sid === 'string')
        normalized.run_id = `sid:${normalized.call_sid}`;
      expect(TOOL_SCHEMAS[tool].safeParse(normalized).success, `${name}: ${JSON.stringify(normalized)}`).toBe(
        true,
      );
    } else if (name.startsWith('webhook-') || name.startsWith('execution-')) {
      expect(BolnaExecutionSchema.safeParse(data).success, name).toBe(true);
    } else if (name.startsWith('call-')) {
      expect(BolnaCallResponseSchema.safeParse(data).success, name).toBe(true);
    } else if (name.startsWith('event-')) {
      const schema = body._http === 404 ? BolnaEventRefusedSchema : BolnaEventAcceptedSchema;
      expect(schema.safeParse(data).success, name).toBe(true);
    } else {
      expect(BolnaStopResponseSchema.safeParse(data).success, name).toBe(true);
    }
  });

  it('the real API answers every recorded lookup, verify and propose body (200)', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const h = await appHarness();
    for (const { name, body } of fixtures.filter((f) =>
      /^tool-(lookup_customer|verify_pass|propose_action)/.test(f.name),
    )) {
      const res = await h.tool(toolOf(name), payload(body));
      expect(res.status, `${name}: ${await res.clone().text()}`).toBe(200);
    }
    await h.settle();
  });

  it('the real API accepts every recorded execution record on the webhook', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const h = await appHarness();
    for (const { name, body } of fixtures.filter((f) => /^(webhook|execution)-/.test(f.name))) {
      const res = await h.fetch('/webhooks/bolna', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-halyn-secret': 'test-tool-secret-0123456789abcdef0123456789',
          'cf-connecting-ip': '13.203.39.153',
        },
        body: JSON.stringify(payload(body)),
      });
      expect(await res.json(), name).toEqual({ ok: true });
    }
  });
});
