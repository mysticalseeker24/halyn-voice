'use client';

import { ErrorState, LoadingState } from '@/components/states';
import { useAero } from './aero-provider';

/** One-time passkey registration (docs/API.md: /web/passkeys/register/*). */
export function PasskeyView() {
  const { home, copy, reload, passkeyPhase, passkeyError, registerPasskey } = useAero();
  if (home.status === 'loading') return <LoadingState label={copy.loading} className="text-slate-800" />;
  if (home.status === 'error')
    return (
      <ErrorState
        title={copy.errorTitle}
        message={home.message}
        retryLabel={copy.retry}
        onRetry={reload}
        className="text-slate-900"
      />
    );
  const registered = home.data.passkey_registered;
  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-2xl font-bold text-slate-900">{copy.passkeyTitle}</h1>
      <p className="text-base text-slate-800">{copy.passkeyBody}</p>
      {registered ? (
        <p
          role="status"
          data-testid="passkey-ready"
          className="rounded-2xl bg-emerald-100 p-4 font-semibold text-emerald-900"
        >
          {passkeyPhase === 'done' ? copy.passkeyDone : copy.passkeyAlready}
        </p>
      ) : (
        <button
          type="button"
          onClick={() => void registerPasskey()}
          disabled={passkeyPhase === 'working'}
          className="min-h-12 rounded-2xl bg-sky-700 px-4 text-base font-semibold text-white disabled:opacity-60"
        >
          {passkeyPhase === 'working' ? copy.working : copy.passkeyCta}
        </button>
      )}
      {passkeyPhase === 'cancelled' ? (
        <p role="status" className="text-sm font-medium text-slate-900">
          {copy.passkeyCancelled}
        </p>
      ) : null}
      {passkeyPhase === 'error' ? (
        <p role="alert" className="text-sm font-medium text-red-700">
          {passkeyError}
        </p>
      ) : null}
    </div>
  );
}
