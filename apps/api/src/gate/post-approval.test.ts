import { describe, expect, it } from 'vitest';
import {
  CLOCK,
  context,
  IN_PACK,
  inPackWith,
  request,
  sampleParams,
  UNREGISTERED,
} from '../../test/fixtures/gate';
import { decide, type GateDecision, type ProposeRequest, resolveStepUp } from './index';

// docs/GATE.md "After step_up" and clarification 9. The clock is used only here.
const HOUR_MS = 3_600_000;
const NOW = CLOCK.nowMs();
const at = (hours: number) => new Date(NOW + hours * HOUR_MS).toISOString();

function stepUp(req: ProposeRequest, ctx = context(), pack = IN_PACK): GateDecision {
  const d = decide(req, ctx, pack, CLOCK);
  expect(d.outcome).toBe('step_up');
  return d;
}

const smallNewPayee = () =>
  request('transfer.new_payee', { params: sampleParams('transfer.new_payee', 'INR', 500000) });

describe('resolveStepUp', () => {
  it('declined → deny C_DECLINED', () => {
    expect(resolveStepUp(stepUp(smallNewPayee()), 'declined', IN_PACK, CLOCK)).toEqual({
      final_outcome: 'deny',
      reasons: ['C_DECLINED'],
      execute_at: null,
    });
  });

  it('timeout → deny C_TIMEOUT', () => {
    expect(resolveStepUp(stepUp(smallNewPayee()), 'timeout', IN_PACK, CLOCK)).toEqual({
      final_outcome: 'deny',
      reasons: ['C_TIMEOUT'],
      execute_at: null,
    });
  });

  it('approved below tier 4 → allow C_APPROVED, executed now', () => {
    const overLimit = request('fee.waive', { params: sampleParams('fee.waive', 'INR', 100001) });
    expect(resolveStepUp(stepUp(overLimit), 'approved', IN_PACK, CLOCK)).toEqual({
      final_outcome: 'allow',
      reasons: ['C_APPROVED'],
      execute_at: null,
    });
  });

  it('approved new payee within the first-24 h cap → allow (tier 3)', () => {
    expect(resolveStepUp(stepUp(smallNewPayee()), 'approved', IN_PACK, CLOCK).final_outcome).toBe('allow');
  });

  it('clarification 9: approved new payee above cap_first_24h_minor → hold', () => {
    const big = request('transfer.new_payee', { params: sampleParams('transfer.new_payee', 'INR', 1000001) });
    expect(resolveStepUp(stepUp(big), 'approved', IN_PACK, CLOCK)).toEqual({
      final_outcome: 'hold',
      reasons: ['C_APPROVED', 'P_OVER_LIMIT', 'H_SPECIALIST'],
      execute_at: null,
    });
  });

  it('the cap is checked before the tier-4 delay (scenario 3 approved: tier 4, ₹45,000)', () => {
    const req = request('transfer.new_payee', {
      params: sampleParams('transfer.new_payee', 'INR', 4500000),
      caller: { from_number: UNREGISTERED, kind: 'human' },
    });
    const d = stepUp(req, context({ proof: 'none', signals: { unregistered_number: true } }));
    expect(d.tier).toBe(4);
    expect(resolveStepUp(d, 'approved', IN_PACK, CLOCK).final_outcome).toBe('hold');
  });

  it('approved at tier ≥ 4 → allow with P_TIER4_HOLD_24H, executed after 24 h (computed tier 4)', () => {
    const req = request('transfer.new_payee', {
      params: sampleParams('transfer.new_payee', 'INR', 500000),
      caller: { from_number: UNREGISTERED, kind: 'human' },
    });
    const d = stepUp(req, context({ proof: 'none', signals: { unregistered_number: true } }));
    expect(resolveStepUp(d, 'approved', IN_PACK, CLOCK)).toEqual({
      final_outcome: 'allow',
      reasons: ['C_APPROVED', 'P_TIER4_HOLD_24H'],
      execute_at: at(24),
    });
  });

  it("uses the pack's hold_hours for a base tier-4 action", () => {
    const pack = inPackWith(
      (p) => void (p.actions['profile.change_mobile'] = { tier: 4, hold_hours: 48, pass_eligible: false }),
    );
    const d = stepUp(request('profile.change_mobile'), context(), pack);
    expect(resolveStepUp(d, 'approved', pack, CLOCK).execute_at).toBe(at(48));
  });

  it('fails closed when the decision was not a step_up', () => {
    const allowed = decide(request('card.freeze'), context(), IN_PACK, CLOCK);
    expect(resolveStepUp(allowed, 'approved', IN_PACK, CLOCK)).toEqual({
      final_outcome: 'deny',
      reasons: ['E_FAIL_CLOSED'],
      execute_at: null,
    });
  });

  it('fails closed on an unknown answer', () => {
    const answer = 'maybe' as unknown as 'approved';
    expect(resolveStepUp(stepUp(smallNewPayee()), answer, IN_PACK, CLOCK).reasons).toEqual(['E_FAIL_CLOSED']);
  });

  it('fails closed when the pack no longer offers the action', () => {
    const d = stepUp(smallNewPayee());
    const pack = inPackWith((p) => void delete p.actions['transfer.new_payee']);
    expect(resolveStepUp(d, 'approved', pack, CLOCK).final_outcome).toBe('deny');
  });

  it('fails closed when the action became human-only', () => {
    const d = stepUp(smallNewPayee());
    const pack = inPackWith((p) => void (p.actions['transfer.new_payee'] = { perimeter: 'human_only' }));
    expect(resolveStepUp(d, 'approved', pack, CLOCK).reasons).toEqual(['E_FAIL_CLOSED']);
  });

  it('fails closed when the clock throws', () => {
    const d = stepUp(request('profile.change_mobile'));
    const broken = {
      nowMs(): number {
        throw new Error('clock unavailable');
      },
    };
    expect(resolveStepUp(d, 'approved', IN_PACK, broken).reasons).toEqual(['E_FAIL_CLOSED']);
  });
});
