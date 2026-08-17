import { Link } from 'react-router-dom';

import { apiRequest, formatBRL, formatDateTime, posterUrl } from '../api/client';
import { useAsync } from '../api/useAsync';
import type { EventListEntry } from '../api/types';
import { EmptyState, ErrorState, Spinner } from '../components/states';

export function BrowsePage() {
  const { data, loading, error, reload } = useAsync(() => apiRequest<EventListEntry[]>('/events'), []);

  if (loading) return <Spinner label="Buscando sessões…" />;
  if (error !== null) return <ErrorState message={error} onRetry={reload} />;
  if (data === null || data.length === 0) {
    return (
      <EmptyState
        title="Nenhuma sessão publicada"
        description="Assim que um organizador publicar um evento, ele aparece aqui. Rode pnpm db:seed para carregar a sessão de demonstração."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Em cartaz</h1>
        <p className="text-sm text-stone-400">{data.length} {data.length === 1 ? 'sessão disponível' : 'sessões disponíveis'}</p>
      </div>

      <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {data.map((event) => {
          const soldOut = event.remainingSeats === 0;
          const poster = posterUrl(event.content.posterPath);
          return (
            <li key={event.id}>
              <Link to={`/eventos/${event.id}`}
                className="group flex h-full flex-col overflow-hidden rounded-xl border border-stone-800 bg-stone-900/50 transition hover:border-amber-400/60">
                <div className="aspect-2/3 overflow-hidden bg-stone-800">
                  {poster === null
                    ? <div className="flex h-full items-center justify-center text-sm text-stone-600">Sem pôster</div>
                    : <img src={poster} alt="" loading="lazy" className="h-full w-full object-cover transition group-hover:scale-105" />}
                </div>
                <div className="flex flex-1 flex-col gap-1.5 p-4">
                  <h2 className="font-medium leading-tight">{event.content.title}</h2>
                  <p className="text-xs text-stone-400">{formatDateTime(event.startsAt)}</p>
                  <p className="text-xs text-stone-400">{event.venueName} · {event.auditoriumName}</p>
                  <div className="mt-auto flex items-center justify-between pt-3">
                    <span className="font-semibold text-amber-300">{formatBRL(event.priceCents)}</span>
                    <span className={`text-xs ${soldOut ? 'text-red-400' : 'text-stone-400'}`}>
                      {soldOut ? 'Esgotado' : `${event.remainingSeats} livres`}
                    </span>
                  </div>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
