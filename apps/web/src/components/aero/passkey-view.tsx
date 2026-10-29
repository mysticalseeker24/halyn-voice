'use client';

import { ErrorState, LoadingState } from '@/components/states';
import { useAero } from './aero-provider';

/** One-time passkey registration (docs/API.md: /web/passkeys/register/*). */
export function PasskeyView() {
  const { home, copy, reload, passkeyPhase, passkeyError, registerPasskey } = useAero();
  if (home.status === 'loading') return <LoadingState label={copy.loading} className="text-foreground" />;
  if (home.status === 'error')
    return (
      <ErrorState
        title={copy.errorTitle}
        message={home.message}
        retryLabel={copy.retry}
        onRetry={reload}
        className="text-foreground"
      />
    );
  const registered = home.data.passkey_registered;
  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-2xl font-bold text-foreground">{copy.passkeyTitle}</h1>
      <p className="text-base text-foreground">{copy.passkeyBody}</p>
      {registered ? (
        <p
          role="status"
          data-testid="passkey-ready"
          className="rounded-2xl bg-emerald-100 dark:bg-emerald-950 p-4 font-semibold text-emerald-900 dark:text-emerald-200"
        >
          {passkeyPhase === 'done' ? copy.passkeyDone : copy.passkeyAlready}
        </p>
      ) : (
        <button
          type="button"
          onClick={() => void registerPasskey()}
          disabled={passkeyPhase === 'working'}
          className="min-h-12 rounded-2xl bg-primary px-4 text-base font-semibold text-primary-foreground disabled:opacity-60"
        >
          {passkeyPhase === 'working' ? copy.working : copy.passkeyCta}
        </button>
      )}
      {passkeyPhase === 'cancelled' ? (
        <p role="status" className="text-sm font-medium text-foreground">
          {copy.passkeyCancelled}
        </p>
      ) : null}
      {passkeyPhase === 'error' ? (
        <p role="alert" className="text-sm font-medium text-red-700 dark:text-red-300">
          {passkeyError}
        </p>
      ) : null}
    </div>
  );
}
