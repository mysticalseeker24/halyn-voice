import { HalynError, importVerifyKeys, PASS_TYP, verifyCompactJws } from '@halyn/shared';
import { describe, expect, it } from 'vitest';
import { testKeys } from '../../test/fixtures/crypto';
import { IN_PACK, US_PACK } from '../../test/fixtures/gate';
import { registeredNumberHash } from './numbers';
import { ASSISTANT_NUMBER, buildSeed, SEED_TENANT, SEED_TIME_MS } from './seed-data';

const PEPPER = 'p'.repeat(32);

describe('buildSeed', async () => {
  const { signer, jwks } = await testKeys('seed-test');
  const input = {
    customerPhone: '+919000000003',
    phoneHashPepper: PEPPER,
    signer,
    packs: [IN_PACK, US_PACK],
  };

  it('is deterministic: the same inputs give identical rows', async () => {
    expect(JSON.stringify(await buildSeed(input))).toBe(JSON.stringify(await buildSeed(input)));
  });

  it('builds the demo tenant, both customers by hashed number, both packs and pass_demo', async () => {
    const rows = await buildSeed(input);
    expect(rows.tenant).toMatchObject({ id: SEED_TENANT, default_region: 'IN', signing_key_id: 'seed-test' });
    // Both demo customers speak English (the demo switched from Hindi on 2026-10-29).
    expect(rows.customers.map((c) => [c.id, c.region, c.language])).toEqual([
      ['cus_saksham', 'IN', 'en'],
      ['cus_saksham_us', 'US', 'en'],
    ]);
    const hash = await registeredNumberHash(PEPPER, '+919000000003');
    for (const c of rows.customers) {
      expect(c.registered_number_hash).toBe(hash);
      expect(c.registered_number_last4).toBe('0003');
      expect(JSON.stringify(c)).not.toContain('9000000003');
      expect(c.created_at).toEqual(new Date(SEED_TIME_MS));
    }
    expect(rows.policyPacks.map((p) => p.id)).toEqual(['aero-in-v1', 'aero-us-v1']);
    expect(rows.pass).toMatchObject({
      id: 'pass_demo',
      customer_id: 'cus_saksham',
      assistant_numbers: [ASSISTANT_NUMBER],
      status: 'active',
      failures: 0,
    });
    expect(rows.pass.scopes).toEqual([
      { action: 'statement.view' },
      { action: 'card.freeze' },
      { action: 'emi.move_date', max_uses: 1 },
    ]);
  });

  it("signs pass_demo with Halyn's key (verifiable with the JWKS)", async () => {
    const rows = await buildSeed(input);
    const result = await verifyCompactJws(rows.passToken, await importVerifyKeys(jwks), PASS_TYP);
    expect(result.ok).toBe(true);
    expect(rows.pass.issuer_sig).toBe(rows.passToken.split('.')[2]);
  });

  it('refuses a number that is not E.164 or is the assistant’s own number', async () => {
    await expect(buildSeed({ ...input, customerPhone: '9000000003' })).rejects.toBeInstanceOf(HalynError);
    await expect(buildSeed({ ...input, customerPhone: ASSISTANT_NUMBER })).rejects.toBeInstanceOf(HalynError);
  });
});
