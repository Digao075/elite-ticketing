import { useState } from 'react';

import { ApiError, apiRequest, formatBRL, formatDateTime, posterUrl } from '../api/client';
import { useAsync } from '../api/useAsync';
import type { OrganizerEvent } from '../api/types';
import { Banner, EmptyState, ErrorState, Spinner } from './states';

/** `version` lets the page force a reload after the wizard creates something. */
export function OrganizerEventList({ token, version }: { token: string | null; version: number }) {
  const { data, loading, error, reload } = useAsync(
    () => apiRequest<OrganizerEvent[]>('/organizer/events', { token }),
    [token, version],
  );
  const [publishing, setPublishing] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);

  async function publish(eventId: string) {
    setPublishing(eventId);
    setPublishError(null);
    try {
      await apiRequest(`/events/${eventId}/publish`, { method: 'POST', token });
      reload();
    } catch (cause) {
      setPublishError(cause instanceof ApiError ? cause.message : 'Não foi possível publicar.');
    } finally {
      setPublishing(null);
    }
  }

  if (loading) return <Spinner label="Carregando suas sessões…" />;
  if (error !== null) return <ErrorState message={error} onRetry={reload} />;
  if (data === null || data.length === 0) {
    return (
      <EmptyState
        title="Você ainda não criou sessões"
        description="Monte a primeira abaixo: escolha o filme, defina sala e horário, configure os assentos e publique."
      />
    );
  }

  const published = data.filter((event) => event.status === 'PUBLISHED');
  const revenue = published.reduce((total, event) => total + event.revenueCents, 0);
  const sold = published.reduce((total, event) => total + event.ticketsSold, 0);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-lg font-medium">Suas sessões</h2>
        <p className="text-sm text-stone-400">
          {sold} {sold === 1 ? 'ingresso vendido' : 'ingressos vendidos'} · {formatBRL(revenue)}
        </p>
      </div>

      {publishError && <Banner tone="error">{publishError}</Banner>}

      <ul className="space-y-3">
        {data.map((event) => {
          const soldOut = event.status === 'PUBLISHED' && event.remainingSeats === 0;
          return (
            <li key={event.id} className="flex flex-wrap items-center gap-4 rounded-xl border border-stone-800 bg-stone-900/50 p-4">
              <div className="h-16 w-11 shrink-0 overflow-hidden rounded bg-stone-800">
                {posterUrl(event.content.posterPath) !== null && (
                  <img src={posterUrl(event.content.posterPath)!} alt="" className="h-full w-full object-cover" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate font-medium">{event.content.title}</h3>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      event.status === 'PUBLISHED'
                        ? 'bg-emerald-500/15 text-emerald-300'
                        : 'bg-stone-700/60 text-stone-300'
                    }`}
                  >
                    {event.status === 'PUBLISHED' ? 'Publicado' : 'Rascunho'}
                  </span>
                  {soldOut && <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] text-red-300">Esgotado</span>}
                </div>
                <p className="text-xs text-stone-400">{formatDateTime(event.startsAt)} · {event.venueName} · {event.auditoriumName}</p>
                <p className="mt-1 text-xs text-stone-400">
                  {event.capacity === 0
                    ? 'Sem assentos configurados'
                    : `${event.ticketsSold}/${event.capacity} vendidos · ${event.remainingSeats} livres`}
                  {event.priceCents !== null && ` · ${formatBRL(event.priceCents)}`}
                </p>
              </div>

              <div className="text-right">
                {event.status === 'PUBLISHED' ? (
                  <p className="font-semibold text-amber-300">{formatBRL(event.revenueCents)}</p>
                ) : event.readyToPublish ? (
                  <button
                    type="button"
                    onClick={() => publish(event.id)}
                    disabled={publishing !== null}
                    className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-stone-950 hover:bg-amber-300 disabled:opacity-40"
                  >
                    {publishing === event.id ? 'Publicando…' : 'Publicar'}
                  </button>
                ) : (
                  <p className="max-w-36 text-xs text-stone-500">Defina preço e assentos para publicar</p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
