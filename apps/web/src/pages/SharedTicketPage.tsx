import { useParams } from 'react-router-dom';

import { apiRequest, formatDateTime, posterUrl } from '../api/client';
import { useAsync } from '../api/useAsync';
import type { Ticket } from '../api/types';
import { QrImage } from '../components/QrImage';
import { Banner, ErrorState, Spinner } from '../components/states';

/** Public view reached by an unguessable link. No account required. */
export function SharedTicketPage() {
  const { shareToken = '' } = useParams();
  const { data, loading, error, reload } = useAsync(
    () => apiRequest<Ticket>(`/tickets/shared/${shareToken}`),
    [shareToken],
  );

  if (loading) return <Spinner label="Abrindo ingresso…" />;
  if (error !== null) return <ErrorState message={error} onRetry={reload} />;
  if (data === null) return null;

  return (
    <div className="mx-auto max-w-sm space-y-5">
      <p className="text-center text-xs uppercase tracking-widest text-stone-500">Ingresso compartilhado</p>

      <article className="overflow-hidden rounded-2xl border border-stone-800 bg-stone-900/50">
        {posterUrl(data.event.content.backdropPath, 'w780') !== null && (
          <img src={posterUrl(data.event.content.backdropPath, 'w780')!} alt="" className="h-32 w-full object-cover opacity-60" />
        )}
        <div className="space-y-1 p-5 text-center">
          <h1 className="text-xl font-semibold">{data.event.content.title}</h1>
          <p className="text-sm text-stone-400">{formatDateTime(data.event.startsAt)}</p>
          <p className="text-sm text-stone-400">{data.event.venueName} · {data.event.auditoriumName}</p>
          <p className="pt-2 text-2xl font-bold text-amber-300">{data.seatLabel}</p>
        </div>

        <div className="flex flex-col items-center gap-3 border-t border-dashed border-stone-700 bg-stone-950/60 p-6">
          {data.usedAt === null
            ? <><QrImage value={data.qrPayload} /><p className="text-xs text-stone-500">Apresente este código na portaria</p></>
            : <Banner tone="error">Ingresso já utilizado em {formatDateTime(data.usedAt)}</Banner>}
        </div>
      </article>
    </div>
  );
}
