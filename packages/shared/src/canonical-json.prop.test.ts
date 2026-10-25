import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from './canonical-json';

const options = { seed: 20261026, numRuns: 300 };

// Deterministic Fisher–Yates driven by a small LCG, so a counterexample replays from its seed.
function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let s = seed >>> 0;
  for (let i = out.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

// Rebuild every object with its keys in a different insertion order (fromEntries keeps "__proto__" as data).
function reorder(value: unknown, seed: number): unknown {
  if (Array.isArray(value)) return value.map((v, i) => reorder(v, seed + i + 1));
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value);
    return Object.fromEntries(shuffled(entries, seed).map(([k, v], i) => [k, reorder(v, seed * 31 + i)]));
  }
  return value;
}

function withoutStrings(json: string): string {
  return json.replace(/"(?:[^"\\]|\\.)*"/g, '');
}

describe('canonical JSON properties', () => {
  it('is independent of key insertion order', () => {
    fc.assert(
      fc.property(fc.jsonValue(), fc.nat(), (value, seed) => {
        expect(canonicalJson(reorder(value, seed))).toBe(canonicalJson(value));
      }),
      options,
    );
  });

  it('is stable: canonicalising its own output changes nothing', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const once = canonicalJson(value);
        expect(canonicalJson(JSON.parse(once))).toBe(once);
      }),
      options,
    );
  });

  it('round-trips to the same data as JSON', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        expect(JSON.parse(canonicalJson(value))).toEqual(JSON.parse(JSON.stringify(value)));
      }),
      options,
    );
  });

  it('has no whitespace outside strings', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        expect(withoutStrings(canonicalJson(value))).not.toMatch(/\s/);
      }),
      options,
    );
  });
});
