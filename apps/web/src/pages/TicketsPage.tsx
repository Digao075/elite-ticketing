import { useState } from 'react';
import { Link } from 'react-router-dom';

import { apiRequest, formatDateTime, posterUrl } from '../api/client';
import { useAsync } from '../api/useAsync';
import type { Ticket } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { QrImage } from '../components/QrImage';
import { Banner, EmptyState, ErrorState, Spinner } from '../components/states';

export function TicketsPage() {
  const { session } = useAuth();
  const { data, loading, error, reload } = useAsync(
    () => apiRequest<Ticket[]>('/tickets/me', { token: session?.token }),
    [session?.token],
  );
  const [copied, setCopied] = useState<string | null>(null);

  async function share(ticket: Ticket) {
    const url = `${window.location.origin}${ticket.shareUrlPath}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(ticket.id);
      window.setTimeout(() => setCopied(null), 2500);
    } catch {
      window.prompt('Copie o link do ingresso:', url);
    }
  }

  if (loading) return <Spinner />;
  if (error !== null) return <ErrorState message={error} onRetry={reload} />;
  if (data === null || data.length === 0) {
    return (
      <EmptyState
        title="Você ainda não tem ingressos"
        description="Escolha uma sessão, reserve seu lugar e conclua o pagamento para receber o ingresso com QR."
        action={<Link to="/" className="rounded-lg bg-amber-400 px-5 py-2.5 font-semibold text-stone-950 hover:bg-amber-300">Ver sessões</Link>}
      />
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Meus ingressos</h1>

      <ul className="grid gap-5 sm:grid-cols-2">
        {data.map((ticket) => (
          <li key={ticket.id} className="overflow-hidden rounded-xl border border-stone-800 bg-stone-900/50">
            <div className="flex gap-4 p-5">
              <div className="h-28 w-20 shrink-0 overflow-hidden rounded-lg bg-stone-800">
                {posterUrl(ticket.event.content.posterPath) !== null && (
                  <img src={posterUrl(ticket.event.content.posterPath)!} alt="" className="h-full w-full object-cover" />
                )}
              </div>
              <div className="min-w-0 space-y-1">
                <h2 className="truncate font-medium">{ticket.event.content.title}</h2>
                <p className="text-xs text-stone-400">{formatDateTime(ticket.event.startsAt)}</p>
                <p className="text-xs text-stone-400">{ticket.event.venueName} · {ticket.event.auditoriumName}</p>
                <p className="pt-1 text-sm">Assento <span className="font-semibold text-amber-300">{ticket.seatLabel}</span></p>
              </div>
            </div>

            <div className="flex flex-col items-center gap-3 border-t border-stone-800 bg-stone-950/60 p-5">
              {ticket.usedAt === null
                ? <QrImage value={ticket.qrPayload} />
                : <div className="flex size-[200px] items-center justify-center rounded-lg bg-stone-900 text-center text-sm text-stone-500">
                    Ingresso já utilizado<br />em {formatDateTime(ticket.usedAt)}
                  </div>}

              <code className="max-w-full truncate text-[10px] text-stone-600">{ticket.qrPayload}</code>

              <div className="flex w-full gap-2">
                <button type="button" onClick={() => share(ticket)}
                  className="flex-1 rounded-lg border border-stone-700 py-2 text-sm hover:border-amber-400">
                  {copied === ticket.id ? 'Link copiado ✓' : 'Compartilhar'}
                </button>
                <Link to={ticket.shareUrlPath} className="flex-1 rounded-lg border border-stone-700 py-2 text-center text-sm hover:border-amber-400">
                  Abrir
                </Link>
              </div>

              {ticket.usedAt !== null && <Banner tone="info">Este ingresso já passou pela portaria.</Banner>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
