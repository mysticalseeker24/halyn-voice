import { DurableObject } from 'cloudflare:workers';

/**
 * One Hub per tenant (SQLite storage): WebSocket fan-out with the Hibernation API, confirmation alarms,
 * strictly ordered ledger appends and the idempotency cache. Built in PROMPTS.md Step 5.
 */
export class HubDO extends DurableObject<Env> {
  override fetch(): Response {
    return new Response('Hub not implemented yet', { status: 501 });
  }
}
