// Node's typings declare CryptoKey only as a value. The API modules that scripts/seed.ts imports (and @halyn/shared's
// types) use it as a type, so give the root (Node) program the matching type.
import type { webcrypto } from 'node:crypto';

declare global {
  type CryptoKey = webcrypto.CryptoKey;
}
