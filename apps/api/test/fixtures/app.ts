// The whole API in Miniflare for integration and scenario tests: the real app (tools, flows, web routes), the real
// tenant Hub (Durable Object), the real Aero Core in-process on a Miniflare D1, compiled packs in KV and a seeded
// directory. Only Bolna (a recorder) and time (one movable clock shared by the Worker, the Hub and Aero Core) are
// simulated (docs/TESTING.md "Rules"). Every harness gets its own tenant, so Hubs and D1 rows never mix.
import {
  type AuthenticationCredentialJson,
  CompiledPolicyPackSchema,
  importSigningKey,
  type LedgerEntry,
  PASS_VERSION,
  PassClaimsSchema,
  type RegistrationCredentialJson,
  type Rng,
  type WsMessage,
  WsMessageSchema,
  WsTicketResponseSchema,
} from '@halyn/shared';
import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { registeredNumberHash } from '../../src/db/numbers';
import type { FetchLike } from '../../src/bolna/client';
import type { CoreTransport } from '../../src/core-client/client';
import { type HubClient, hubFor } from '../../src/hub/client';
import type { HubDO } from '../../src/hub/hub-do';
import type { DirectorySource, MirrorSink } from '../../src/hub/ports';
import type { DirectorySnapshot, MirrorItem } from '../../src/hub/types';
import { createApp } from '../../src/index';
import { packKey } from '../../src/packs/load';
import { passRow, signPass } from '../../src/pass';
import { bolnaRecorder } from '../../src/test-runner/live';
import { aeroCore, type AeroCoreHarness } from './aero-core';
import { BOLNA_IP, sessionToken, TOOL_SECRET } from './api';
import { seededRng } from './crypto';
import { IN_PACK, US_PACK } from './gate';
import { movableClock, recordingSink } from './hub';
import { softPasskey, type SoftPasskey } from './webauthn';

export const REGISTERED = '+919000000003';
export const UNREGISTERED = '+919000000001';
export const UNKNOWN_AI = '+919000000002';
export const ASSISTANT = '+918065356379';
export const WEB_ORIGIN = 'http://localhost:3000';
export const SPOKEN = 'सक्षम';

const bindings = env as unknown as {
  PHONE_HASH_PEPPER: string;
  HALYN_SIGNING_KEY: string;
  SESSION_SECRET: string;
};

let counter = 0;
function tenantId(): string {
  counter += 1;
  return `ten_h${Date.now().toString(36)}${counter}`;
}

/** 10:30 in India two days from now: daytime (no S_UNUSUAL_HOUR), inside the calling window, alarms in the future. */
export function scenarioStart(): number {
  const day = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  return Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 5, 0, 0);
}

/** The demo customers and Pass for a tenant (as `pnpm seed` writes them for ten_aero). */
export async function demoDirectory(
  tenant: string,
  nowMs: number,
): Promise<{ snapshot: DirectorySnapshot; passToken: string }> {
  const number_hash = await registeredNumberHash(bindings.PHONE_HASH_PEPPER, REGISTERED);
  const customer = (id: string, region: 'IN' | 'US', language: 'hi' | 'en') => ({
    id,
    name: 'Saksham Mishra',
    spoken_name: SPOKEN,
    region,
    language,
    number_hash,
    last4: REGISTERED.slice(-4),
  });
  const iat = Math.floor(nowMs / 1000) - 3600;
  const claims = PassClaimsSchema.parse({
    v: PASS_VERSION,
    pid: 'pass_demo',
    tenant,
    sub: 'cus_saksham',
    assistant: { name: "Saksham's Assistant", numbers: [ASSISTANT] },
    scopes: [
      { action: 'statement.view' },
      { action: 'card.freeze' },
      { action: 'emi.move_date', max_uses: 1 },
    ],
    iat,
    exp: iat + 7 * 24 * 3600,
    cnf: { customer_passkey_sig: 'test_unsigned' },
  });
  const passToken = await signPass(claims, await importSigningKey(bindings.HALYN_SIGNING_KEY));
  return {
    snapshot: {
      customers: [customer('cus_saksham', 'IN', 'hi'), customer('cus_saksham_us', 'US', 'en')],
      passes: [passRow(claims, passToken)],
      codes: [],
      credentials: [],
    },
    passToken,
  };
}

/** A mirror sink that records what the Hub would write to TiDB. */
export function recordingMirror(): MirrorSink & { items: MirrorItem[]; calls: number } {
  const sink = {
    items: [] as MirrorItem[],
    calls: 0,
    async persist(_tenant: string, items: readonly MirrorItem[]) {
      sink.calls += 1;
      sink.items.push(...items);
    },
  };
  return sink;
}

class Background {
  readonly pending: Promise<unknown>[] = [];
  waitUntil(promise: Promise<unknown>): void {
    this.pending.push(promise.catch(() => undefined));
  }
  passThroughOnException(): void {}
  async drain(): Promise<void> {
    while (this.pending.length > 0) await Promise.all(this.pending.splice(0));
  }
}

export interface AppHarness {
  tenant: string;
  env: Env;
  clock: ReturnType<typeof movableClock>;
  rng: Rng;
  hub: HubClient;
  raw: DurableObjectStub;
  aero: AeroCoreHarness;
  bolna: ReturnType<typeof bolnaRecorder>;
  source: DirectorySource & { loads: number };
  mirror: ReturnType<typeof recordingMirror>;
  ledgerSink: ReturnType<typeof recordingSink>;
  passToken: string;
  /** A request through the real app; background work is collected for settle(). */
  fetch(path: string, init?: RequestInit): Promise<Response>;
  tool(name: string, body: Record<string, unknown>, headers?: Record<string, string>): Promise<Response>;
  web(path: string, body?: unknown, token?: string, method?: string): Promise<Response>;
  customerToken(customer_id?: string): Promise<string>;
  consoleToken(): Promise<string>;
  settle(): Promise<void>;
  fireAlarm(): Promise<void>;
  /** A passkey registered for cus_saksham through the real routes. */
  registerPasskey(alg?: -7 | -8): Promise<SoftPasskey>;
  approve(request_id: string, passkey: SoftPasskey): Promise<Response>;
  listen(role: 'aero' | 'stage' | 'console'): Promise<WsMessage[]>;
  ledger(): Promise<LedgerEntry[]>;
}

/** Fault injection for adversarial tests: wrap only the two outside systems (Bolna's HTTP, the Aero Core transport). */
export interface AppHarnessOptions {
  start?: number;
  seed?: number;
  wrapBolna?: (inner: FetchLike) => FetchLike;
  wrapCore?: (inner: CoreTransport) => CoreTransport;
}

export async function appHarness(options: AppHarnessOptions = {}): Promise<AppHarness> {
  const tenant = tenantId();
  const clock = movableClock(options.start ?? scenarioStart());
  const rng = seededRng(options.seed ?? counter * 7919);
  const aero = await aeroCore(tenant, clock, rng);
  const bolna = bolnaRecorder(rng);
  const { snapshot, passToken } = await demoDirectory(tenant, clock.nowMs());
  const source = {
    loads: 0,
    async load() {
      source.loads += 1;
      return snapshot;
    },
  };
  const mirror = recordingMirror();
  const ledgerSink = recordingSink();
  const bolnaFetch = options.wrapBolna ? options.wrapBolna(bolna.fetch) : bolna.fetch;
  const coreTransport = options.wrapCore ? options.wrapCore(aero.transport) : aero.transport;
  const raw = env.HUB.getByName(tenant);
  await runInDurableObject(raw, (instance: HubDO) => {
    instance.clock = clock;
    instance.rng = rng;
    instance.sink = ledgerSink;
    instance.source = source;
    instance.mirrorSink = mirror;
    instance.bolnaFetch = bolnaFetch;
    // The sweep (ADR-020) reaches the same in-process Aero Core as the Worker.
    instance.coreTransport = coreTransport;
  });
  await env.CONFIG.put(packKey(tenant, 'IN'), JSON.stringify(CompiledPolicyPackSchema.parse(IN_PACK)));
  await env.CONFIG.put(packKey(tenant, 'US'), JSON.stringify(CompiledPolicyPackSchema.parse(US_PACK)));
  const testEnv = Object.assign({}, env, { DEFAULT_TENANT_ID: tenant }) as unknown as Env;
  const app = createApp({ clock, rng, bolnaFetch, coreTransport: () => coreTransport });
  const background = new Background();
  const hub = hubFor(env, tenant);

  const fetch = (path: string, init: RequestInit = {}) =>
    Promise.resolve(app.request(path, init, testEnv, background as unknown as ExecutionContext));
  const customerToken = (customer_id = 'cus_saksham') =>
    sessionToken('customer', customer_id, Date.now(), tenant);
  const harness: AppHarness = {
    tenant,
    env: testEnv,
    clock,
    rng,
    hub,
    raw,
    aero,
    bolna,
    source,
    mirror,
    ledgerSink,
    passToken,
    fetch,
    tool: (name, body, headers = {}) =>
      fetch(`/tools/${name}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-halyn-secret': TOOL_SECRET,
          'cf-connecting-ip': BOLNA_IP,
          ...headers,
        },
        body: JSON.stringify(body),
      }),
    web: (path, body, token, method = body === undefined ? 'GET' : 'POST') =>
      fetch(path, {
        method,
        headers: {
          'content-type': 'application/json',
          origin: WEB_ORIGIN,
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    customerToken,
    consoleToken: () => sessionToken('console', null, Date.now(), tenant),
    settle: () => background.drain(),
    async fireAlarm() {
      await runDurableObjectAlarm(raw);
      await background.drain();
    },
    async registerPasskey(alg = -7) {
      const token = await customerToken();
      const passkey = await softPasskey(alg);
      const options = await harness.web('/web/passkeys/register/options', {}, token);
      const { options: creation } = (await options.json()) as {
        options: Parameters<SoftPasskey['register']>[0];
      };
      const credential: RegistrationCredentialJson = await passkey.register(creation, WEB_ORIGIN);
      const res = await harness.web('/web/passkeys/register/verify', { response: credential }, token);
      if (res.status !== 200)
        throw new Error(`passkey registration failed: ${res.status} ${await res.text()}`);
      return passkey;
    },
    async approve(request_id, passkey) {
      const token = await customerToken();
      const res = await harness.web(`/web/approvals/${request_id}/options`, {}, token);
      if (res.status !== 200) return res;
      const { options } = (await res.json()) as { options: Parameters<SoftPasskey['authenticate']>[0] };
      const assertion: AuthenticationCredentialJson = await passkey.authenticate(options, WEB_ORIGIN);
      return harness.web(`/web/approvals/${request_id}/verify`, { response: assertion }, token);
    },
    async listen(role) {
      // As the apps do (ADR-021): trade the session for a one-time ticket, then open the socket with the ticket.
      const token = role === 'aero' || role === 'assistant' ? await customerToken() : await harness.consoleToken();
      const issued = await harness.web('/web/ws-ticket', { role }, token);
      if (issued.status !== 200) throw new Error(`no WebSocket ticket for ${role}: ${issued.status}`);
      const { ticket } = WsTicketResponseSchema.parse(await issued.json());
      const res = await app.request(
        `/ws?ticket=${encodeURIComponent(ticket)}&role=${role}`,
        { headers: { upgrade: 'websocket' } },
        testEnv,
      );
      const socket = res.webSocket;
      if (!socket) throw new Error(`no WebSocket for ${role}: ${res.status}`);
      socket.accept();
      const messages: WsMessage[] = [];
      socket.addEventListener('message', (event) => {
        if (typeof event.data === 'string' && event.data !== 'pong')
          messages.push(WsMessageSchema.parse(JSON.parse(event.data)));
      });
      return messages;
    },
    ledger: () => hub.ledgerEntries(1, 5000),
  };
  return harness;
}

/** Wait for the event loop to deliver queued WebSocket messages. */
export async function tick(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}
