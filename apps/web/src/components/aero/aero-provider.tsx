'use client';

import type { Language, WsMessage } from '@halyn/shared';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { ApiError } from '@/lib/api/client';
import type { AeroHome, PendingApproval } from '@halyn/shared';
import { useHub } from '@/lib/hub/use-hub';
import { COPY, type Copy } from '@/lib/i18n';
import { DEMO_CUSTOMER_ID, useDemoSession } from '@/lib/session';
import type { HubStatus } from '@/lib/hub/use-hub';
import { type ApprovalPhase, ApprovalSheet } from './approval-sheet';

type HomeState =
  { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: AeroHome };

interface AeroContextValue {
  lang: Language;
  setLang: (lang: Language) => void;
  copy: Copy;
  home: HomeState;
  reload: () => void;
  hubStatus: HubStatus;
  pending: PendingApproval[];
  openSheet: () => void;
  /** Last outcome of an approval, as a message key, shown once on Home. */
  notice: keyof Copy | null;
  dismissNotice: () => void;
  passkeyPhase: 'idle' | 'working' | 'done' | 'cancelled' | 'error';
  passkeyError: string | null;
  registerPasskey: () => Promise<void>;
  /** Set while the API wants the demo access code; `rejected` after a wrong one. */
  demoCode: { rejected: boolean; submit: (code: string) => void } | null;
}

const AeroContext = createContext<AeroContextValue | null>(null);

export function useAero(): AeroContextValue {
  const value = useContext(AeroContext);
  if (!value) throw new Error('useAero must be used inside <AeroProvider>');
  return value;
}

const LANG_KEY = 'halyn.aero.lang';
const langListeners = new Set<() => void>();

let memoryLang: Language | null = null;

function readLang(): Language {
  try {
    const saved = window.localStorage.getItem(LANG_KEY);
    if (saved === 'hi' || saved === 'en') return saved;
    return memoryLang ?? 'en';
  } catch {
    return memoryLang ?? 'en';
  }
}

/** The chosen language, remembered in localStorage (a per-viewer convenience; English when storage is blocked). */
function useStoredLanguage(): [Language, (next: Language) => void] {
  const lang = useSyncExternalStore(
    (listener) => {
      langListeners.add(listener);
      return () => langListeners.delete(listener);
    },
    readLang,
    () => 'en' as const,
  );
  const setLang = useCallback((next: Language) => {
    memoryLang = next;
    try {
      window.localStorage.setItem(LANG_KEY, next);
    } catch {
      // not remembered
    }
    for (const listener of langListeners) listener();
  }, []);
  return [lang, setLang];
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

/** A browser cancel or timeout of the passkey prompt (NotAllowedError) is not a server failure. */
function isCancelled(error: unknown): boolean {
  return error instanceof Error && (error.name === 'NotAllowedError' || error.name === 'AbortError');
}

export function AeroProvider({ children }: { children: ReactNode }) {
  const { state, api, token, retry, submitCode } = useDemoSession({
    kind: 'customer',
    customerId: DEMO_CUSTOMER_ID,
  });
  const [lang, setLang] = useStoredLanguage();
  const [home, setHome] = useState<HomeState>({ status: 'loading' });
  const [pending, setPending] = useState<PendingApproval[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [phase, setPhase] = useState<ApprovalPhase>('idle');
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [notice, setNotice] = useState<keyof Copy | null>(null);
  const [passkeyPhase, setPasskeyPhase] = useState<AeroContextValue['passkeyPhase']>('idle');
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(() => {
    api.aeroHome().then(
      (data) => {
        if (!alive.current) return;
        setHome({ status: 'ready', data });
        setPending(data.pending_approvals);
        if (data.pending_approvals.length > 0) setSheetOpen(true);
      },
      (error: unknown) => {
        if (alive.current) setHome({ status: 'error', message: describe(error) });
      },
    );
  }, [api]);

  const reload = useCallback(() => {
    setHome({ status: 'loading' });
    if (state.status === 'error') retry();
    else load();
  }, [load, retry, state.status]);

  useEffect(() => {
    if (state.status === 'ready') load();
  }, [state.status, load]);

  const onMessage = useCallback(
    (message: WsMessage) => {
      if (message.type === 'confirm_request') {
        setPending((list) =>
          list.some((p) => p.request_id === message.request_id)
            ? list
            : [
                ...list,
                {
                  request_id: message.request_id,
                  action: message.action,
                  summary: message.summary,
                  amount: message.amount,
                  channels: message.channels,
                  expires_at: message.expires_at,
                },
              ],
        );
        setPhase('idle');
        setSheetError(null);
        setSheetOpen(true);
      } else if (message.type === 'confirm_resolved') {
        setPending((list) => list.filter((p) => p.request_id !== message.request_id));
        setNotice(
          message.status === 'approved'
            ? 'approvedMsg'
            : message.status === 'declined'
              ? 'declinedMsg'
              : 'timeoutMsg',
        );
        setSheetOpen(false);
        setPhase('idle');
      } else if (message.type === 'core_update') {
        load();
      }
    },
    [load],
  );

  const { status: hubStatus } = useHub({
    role: 'aero',
    token,
    getTicket: (role) => api.wsTicket(role).then((r) => r.ticket),
    onMessage,
    onReconnect: load,
  });

  const active = pending[0] ?? null;
  const copy = COPY[lang];

  const approve = useCallback(
    async (approval: PendingApproval) => {
      setPhase('working');
      setSheetError(null);
      try {
        const { options } = await api.approvalOptions(approval.request_id);
        const response = await startAuthentication({
          optionsJSON: options as unknown as PublicKeyCredentialRequestOptionsJSON,
        });
        await api.approvalVerify(approval.request_id, response);
        setPhase('idle');
        // The Hub's confirm_resolved message closes the sheet; do it here too in case the socket is down.
        setPending((list) => list.filter((p) => p.request_id !== approval.request_id));
        setNotice('approvedMsg');
        setSheetOpen(false);
      } catch (error) {
        setPhase('error');
        setSheetError(isCancelled(error) ? copy.passkeyCancelled : describe(error));
      }
    },
    [api, copy.passkeyCancelled],
  );

  const decline = useCallback(
    async (approval: PendingApproval) => {
      setPhase('working');
      setSheetError(null);
      try {
        await api.approvalDecline(approval.request_id);
        setPhase('idle');
        setPending((list) => list.filter((p) => p.request_id !== approval.request_id));
        setNotice('declinedMsg');
        setSheetOpen(false);
      } catch (error) {
        setPhase('error');
        setSheetError(describe(error));
      }
    },
    [api],
  );

  const registerPasskey = useCallback(async () => {
    setPasskeyPhase('working');
    setPasskeyError(null);
    try {
      const { options } = await api.passkeyRegisterOptions();
      const response = await startRegistration({
        optionsJSON: options as unknown as PublicKeyCredentialCreationOptionsJSON,
      });
      await api.passkeyRegisterVerify(response);
      setPasskeyPhase('done');
      setHome((h) =>
        h.status === 'ready' ? { status: 'ready', data: { ...h.data, passkey_registered: true } } : h,
      );
    } catch (error) {
      if (isCancelled(error)) setPasskeyPhase('cancelled');
      else {
        setPasskeyPhase('error');
        setPasskeyError(error instanceof ApiError ? error.message : describe(error));
      }
    }
  }, [api]);

  const value = useMemo<AeroContextValue>(
    () => ({
      lang,
      setLang,
      copy,
      home:
        state.status === 'error'
          ? { status: 'error', message: state.message }
          : state.status === 'loading' || state.status === 'needs_code'
            ? { status: 'loading' }
            : home,
      reload,
      hubStatus,
      pending,
      openSheet: () => setSheetOpen(true),
      notice,
      dismissNotice: () => setNotice(null),
      passkeyPhase,
      passkeyError,
      registerPasskey,
      demoCode: state.status === 'needs_code' ? { rejected: state.rejected, submit: submitCode } : null,
    }),
    [
      lang,
      setLang,
      copy,
      state,
      home,
      reload,
      hubStatus,
      pending,
      notice,
      passkeyPhase,
      passkeyError,
      registerPasskey,
      submitCode,
    ],
  );

  return (
    <AeroContext.Provider value={value}>
      <div lang={lang}>{children}</div>
      {active && sheetOpen ? (
        <ApprovalSheet
          approval={active}
          copy={copy}
          phase={phase}
          error={sheetError}
          onApprove={() => void approve(active)}
          onDecline={() => void decline(active)}
          onClose={() => setSheetOpen(false)}
        />
      ) : null}
    </AeroContext.Provider>
  );
}
