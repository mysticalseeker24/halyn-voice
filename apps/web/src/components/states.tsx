import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

// Every screen has a loading, empty and error state (apps/web/CLAUDE.md).

export function LoadingState({ label, className }: { label: string; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={cn('flex items-center gap-3 p-4 text-sm', className)}>
      <span
        aria-hidden="true"
        className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
      />
      {label}
    </div>
  );
}

export function EmptyState({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p data-state="empty" className={cn('p-4 text-sm opacity-80', className)}>
      {children}
    </p>
  );
}

export function ErrorState({
  title,
  message,
  retryLabel,
  onRetry,
  className,
}: {
  title: string;
  message?: string;
  retryLabel: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div role="alert" className={cn('flex flex-col items-start gap-2 p-4', className)}>
      <p className="font-semibold">{title}</p>
      {message ? <p className="text-sm">{message}</p> : null}
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="min-h-11 rounded-lg border border-current px-4 text-sm font-medium"
        >
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}
