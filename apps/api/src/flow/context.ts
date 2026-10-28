import { type Clock, importSigningKey, type Rng, type Signer } from '@halyn/shared';
import { type BolnaClient, createBolnaClient, type FetchLike } from '../bolna/client';
import type { CoreTransport } from '../core-client/client';
import { BolnaEnvSchema, CoreEnvSchema, requireEnv, SarvamEnvSchema, SigningEnvSchema } from '../env';
import { type HubClient, hubFor } from '../hub/client';
import { cryptoRng } from '../platform/crypto-rng';
import { systemClock } from '../platform/clock';
import { type CoachingLlm, sarvamCoaching } from '../signals/coaching-llm';

// What the outcome flows need (docs/ARCHITECTURE.md "Main flow" steps 6–8): the tenant's Hub, Bolna, Aero Core,
// Halyn's signing key, a clock and an rng. Built per request from the Worker env and the app's injected dependencies,
// so tests swap only Bolna (a recorder) and the clock — never the Gate, Pass, ledger or grant code.

export interface AppDeps {
  clock: Clock;
  rng: Rng;
  /** How the API reaches Bolna's REST API. */
  bolnaFetch: FetchLike;
  /** How the API reaches Aero Core; default: the AERO_CORE service binding, else AERO_CORE_URL. */
  coreTransport?: (env: Env) => CoreTransport | null;
  /** How the API reaches Sarvam (coaching layer 2); default: the global fetch. Tests mock it. */
  sarvamFetch?: FetchLike;
}

export const defaultDeps: AppDeps = {
  clock: systemClock,
  rng: cryptoRng,
  bolnaFetch: (request) => fetch(request),
};

export interface FlowContext {
  env: Env;
  tenant: string;
  hub: HubClient;
  clock: Clock;
  rng: Rng;
  /** Null when BOLNA_API_KEY is missing: events are logged and skipped, the decision stands. */
  bolna: BolnaClient | null;
  /** Null when Aero Core is not configured: an allowed action fails closed. */
  core: CoreTransport | null;
  /** Coaching layer 2 (ADR-024); null without SARVAM_API_KEY: layer 1 alone. */
  coachingLlm: CoachingLlm | null;
  signer(): Promise<Signer>;
}

const signers = new Map<string, Promise<Signer>>();

/** Halyn's signing key from the env, imported once per isolate (the Worker's flows and the Hub's sweep). */
export function signerFor(env: unknown): Promise<Signer> {
  const { HALYN_SIGNING_KEY } = requireEnv(env, SigningEnvSchema.pick({ HALYN_SIGNING_KEY: true }));
  let signer = signers.get(HALYN_SIGNING_KEY);
  if (!signer) {
    signer = importSigningKey(HALYN_SIGNING_KEY);
    signer.catch(() => signers.delete(HALYN_SIGNING_KEY));
    signers.set(HALYN_SIGNING_KEY, signer);
  }
  return signer;
}

/** Aero Core over the service binding (production) or its URL (dev). */
export function defaultCoreTransport(env: Env): CoreTransport | null {
  const binding = (env as unknown as { AERO_CORE?: Fetcher }).AERO_CORE;
  if (binding) return (request) => binding.fetch(request);
  const parsed = CoreEnvSchema.safeParse(env);
  const base = parsed.success ? parsed.data.AERO_CORE_URL : undefined;
  if (!base) return null;
  return (request) => {
    const url = new URL(request.url);
    return fetch(new Request(`${base.replace(/\/+$/, '')}${url.pathname}${url.search}`, request));
  };
}

export function flowContext(env: Env, tenant: string, deps: AppDeps): FlowContext {
  const bolnaEnv = BolnaEnvSchema.safeParse(env);
  const sarvam = SarvamEnvSchema.safeParse(env);
  return {
    env,
    tenant,
    hub: hubFor(env, tenant),
    clock: deps.clock,
    rng: deps.rng,
    bolna: bolnaEnv.success
      ? createBolnaClient({
          apiKey: bolnaEnv.data.BOLNA_API_KEY,
          baseUrl: bolnaEnv.data.BOLNA_API_BASE,
          fetch: deps.bolnaFetch,
        })
      : null,
    core: (deps.coreTransport ?? defaultCoreTransport)(env),
    coachingLlm: sarvam.success
      ? sarvamCoaching({
          apiKey: sarvam.data.SARVAM_API_KEY,
          fetch: deps.sarvamFetch ?? ((request) => fetch(request)),
        })
      : null,
    signer: () => signerFor(env),
  };
}
