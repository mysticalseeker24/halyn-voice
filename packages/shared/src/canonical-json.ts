import { HalynError } from './errors';

/**
 * Canonical JSON (RFC 8785 style) for hashes and signatures: object keys sorted by UTF-16 code units, no
 * whitespace, numbers and strings serialised exactly as `JSON.stringify` does. Only plain JSON data is
 * accepted; anything else fails closed. Undefined object properties are omitted.
 */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export function canonicalJson(value: unknown): string {
  return write(value, '$', new Set<object>());
}

function fail(path: string, what: string): never {
  throw new HalynError('E_FAIL_CLOSED', `canonicalJson: ${what} at ${path}`);
}

function write(value: unknown, path: string, ancestors: Set<object>): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'string':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) fail(path, `non-finite number ${String(value)}`);
      return JSON.stringify(value);
    case 'object':
      return writeObject(value, path, ancestors);
    default:
      return fail(path, `unsupported ${typeof value}`);
  }
}

function writeObject(value: object, path: string, ancestors: Set<object>): string {
  if (ancestors.has(value)) fail(path, 'cycle');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const items: string[] = [];
      for (let i = 0; i < value.length; i++) {
        const item: unknown = value[i];
        if (item === undefined) fail(`${path}[${i}]`, 'undefined array item');
        items.push(write(item, `${path}[${i}]`, ancestors));
      }
      return `[${items.join(',')}]`;
    }
    const proto: unknown = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) fail(path, 'non-plain object');
    const record = value as Record<string, unknown>;
    const members: string[] = [];
    for (const key of Object.keys(record).sort()) {
      const item = record[key];
      if (item === undefined) continue;
      members.push(`${JSON.stringify(key)}:${write(item, `${path}.${key}`, ancestors)}`);
    }
    return `{${members.join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}
