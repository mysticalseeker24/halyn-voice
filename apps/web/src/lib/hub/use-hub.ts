'use client';

import { type HubRole, type WsMessage, WsMessageSchema } from '@halyn/shared';
import { useEffect, useRef, useState } from 'react';
import { wsUrl } from '@/lib/env';

export type HubStatus = 'idle' | 'connecting' | 'open' | 'reconnecting';

export interface UseHubOptions {
  role: HubRole;
  /** Session token. No token, no connection. It never goes into the WebSocket URL. */
  token: string | null;
  /** Fetches a one-time, 30 s ticket for this role (`POST /web/ws-ticket`, ADR-021); called before every (re)connect. */
  getTicket: (role: HubRole) => Promise<string>;
  /** Called for every message that parses as a `WsMessage`. Others are dropped. */
  onMessage: (message: WsMessage) => void;
  /** Called after every reconnect (not the first open): refetch what you may have missed. */
  onReconnect?: () => void;
  url?: string;
  /** Test seams. */
  WebSocketImpl?: typeof WebSocket;
  backoff?: (attempt: number) => number;
}

/** 0.5 s, 1 s, 2 s ... capped at 10 s, with up to 25% jitter. */
export function defaultBackoff(attempt: number): number {
  const base = Math.min(500 * 2 ** attempt, 10_000);
  return base + Math.random() * base * 0.25;
}

/**
 * The only source of live data (docs/UI.md). Connects to the tenant Hub, reconnects with backoff and tells the
 * caller to refetch when it comes back. Browsers cannot set WebSocket headers, so each attempt presents a fresh
 * one-time ticket in the query string instead of the session token (edge logs may keep URLs).
 */
export function useHub(options: UseHubOptions): { status: HubStatus } {
  const [status, setStatus] = useState<HubStatus>('idle');
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  const { token, role, url } = options;

  useEffect(() => {
    if (!token) return;
    let closed = false;
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let opened = false;

    const retry = () => {
      if (closed) return;
      setStatus('reconnecting');
      const delay = (latest.current.backoff ?? defaultBackoff)(attempt++);
      timer = setTimeout(() => void connect(), delay);
    };

    const connect = async () => {
      setStatus(opened ? 'reconnecting' : 'connecting');
      let ticket: string;
      try {
        ticket = await latest.current.getTicket(role);
      } catch {
        retry();
        return;
      }
      if (closed) return;
      const Impl = latest.current.WebSocketImpl ?? WebSocket;
      const ws = new Impl(`${url ?? wsUrl()}?ticket=${encodeURIComponent(ticket)}&role=${role}`);
      socket = ws;
      ws.onopen = () => {
        const wasReconnect = opened;
        opened = true;
        attempt = 0;
        setStatus('open');
        if (wasReconnect) latest.current.onReconnect?.();
      };
      ws.onmessage = (event: MessageEvent) => {
        if (typeof event.data !== 'string') return;
        let json: unknown;
        try {
          json = JSON.parse(event.data);
        } catch {
          return;
        }
        const parsed = WsMessageSchema.safeParse(json);
        if (parsed.success) latest.current.onMessage(parsed.data);
      };
      ws.onclose = retry;
      ws.onerror = () => ws.close();
    };

    void connect();
    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
      setStatus('idle');
    };
  }, [token, role, url]);

  return { status };
}
