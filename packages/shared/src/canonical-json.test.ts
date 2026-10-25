import { describe, expect, it } from 'vitest';
import { canonicalJson } from './canonical-json';
import { HalynError } from './errors';

describe('canonicalJson', () => {
  it('sorts keys at every depth and drops whitespace', () => {
    expect(canonicalJson({ b: 1, a: [true, null, 'x'], c: { z: 1, y: { q: 2, p: 1 } } })).toBe(
      '{"a":[true,null,"x"],"b":1,"c":{"y":{"p":1,"q":2},"z":1}}',
    );
  });

  it('serialises numbers the ECMAScript way', () => {
    expect(canonicalJson([0, -0, 1, -1.5, 0.1, 1e21, 1e-7, 123456789012345])).toBe(
      '[0,0,1,-1.5,0.1,1e+21,1e-7,123456789012345]',
    );
  });

  it('escapes strings like JSON and sorts keys by UTF-16 code units', () => {
    expect(canonicalJson({ '€': 1, '\r': 2, דּ: 3, '1': 4, é: 5, '😀': 6, z: 7 })).toBe(
      '{"\\r":2,"1":4,"z":7,"\u00e9":5,"\u20ac":1,"\ud83d\ude00":6,"\ufb33":3}',
    );
    expect(canonicalJson('line\n"quote"\\')).toBe('"line\\n\\"quote\\"\\\\"');
  });

  it('omits undefined object properties and accepts null-prototype objects', () => {
    const bare = Object.create(null) as Record<string, unknown>;
    bare.k = 'v';
    expect(canonicalJson({ a: undefined, b: 1, bare })).toBe('{"b":1,"bare":{"k":"v"}}');
  });

  it('allows shared (non-cyclic) references', () => {
    const shared = { x: 1 };
    expect(canonicalJson({ a: shared, b: [shared] })).toBe('{"a":{"x":1},"b":[{"x":1}]}');
  });

  class Account {
    id = 'acc_1';
  }
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const sparse: unknown[] = [];
  sparse[1] = 1;

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['bigint', 1n],
    ['function', () => 1],
    ['symbol', Symbol('s')],
    ['Date', new Date(0)],
    ['Map', new Map()],
    ['class instance', new Account()],
    ['undefined in array', [1, undefined]],
    ['sparse array', sparse],
    ['top-level undefined', undefined],
    ['cycle', cyclic],
  ])('fails closed on %s', (_, value) => {
    try {
      canonicalJson(value);
    } catch (err) {
      expect(err).toBeInstanceOf(HalynError);
      expect((err as HalynError).code).toBe('E_FAIL_CLOSED');
      return;
    }
    throw new Error('expected a HalynError');
  });

  it('names the offending path', () => {
    expect(() => canonicalJson({ a: [{ b: Number.NaN }] })).toThrow('$.a[0].b');
  });
});
