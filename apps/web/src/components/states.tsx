import type { ReactNode } from 'react';

export function Spinner({ label = 'Carregando…' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-3 py-16 text-stone-400">
      <span className="size-5 animate-spin rounded-full border-2 border-stone-600 border-t-amber-400" aria-hidden />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-xl border border-red-900/60 bg-red-950/40 p-6 text-red-200">
      <p className="font-medium">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-4 rounded-lg border border-red-700 px-4 py-2 text-sm font-medium hover:bg-red-900/40">
          Tentar de novo
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-stone-700 p-10 text-center">
      <p className="text-lg font-medium text-stone-200">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-stone-400">{description}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function Banner({ tone, children }: { tone: 'success' | 'error' | 'info'; children: ReactNode }) {
  const tones = {
    success: 'border-emerald-800 bg-emerald-950/50 text-emerald-200',
    error: 'border-red-900 bg-red-950/50 text-red-200',
    info: 'border-stone-700 bg-stone-900 text-stone-300',
  } as const;
  return <div role="status" className={`rounded-lg border px-4 py-3 text-sm ${tones[tone]}`}>{children}</div>;
}
