import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { ApiError, apiRequest, formatBRL, formatDateTime, posterUrl } from '../api/client';
import { useAsync } from '../api/useAsync';
import type { EventDetail, Reservation } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { SeatMap } from '../components/SeatMap';
import { Banner, ErrorState, Spinner } from '../components/states';

const MAX_SEATS = 6;

export function EventDetailPage() {
  const { eventId = '' } = useParams();
  const { session } = useAuth();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useAsync(() => apiRequest<EventDetail>(`/events/${eventId}/public`), [eventId]);
  const [selected, setSelected] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [reserveError, setReserveError] = useState<string | null>(null);

  if (loading) return <Spinner />;
  if (error !== null) return <ErrorState message={error} onRetry={reload} />;
  if (data === null) return null;

  const toggle = (seatLabel: string) =>
    setSelected((current) => (current.includes(seatLabel) ? current.filter((s) => s !== seatLabel) : [...current, seatLabel]));

  async function reserve() {
    if (session === null) {
      navigate('/entrar');
      return;
    }
    setSubmitting(true);
    setReserveError(null);
    try {
      const reservation = await apiRequest<Reservation>('/reservations', {
        method: 'POST',
        token: session.token,
        body: { eventId, seatLabels: selected },
      });
      navigate(`/checkout/${reservation.id}`);
    } catch (cause) {
      const message = cause instanceof ApiError ? cause.message : 'Não foi possível reservar.';
      setReserveError(message);
      // Someone else may have taken the seat between render and click, so
      // re-read availability rather than leaving a stale map on screen.
      setSelected([]);
      reload();
    } finally {
      setSubmitting(false);
    }
  }

  const backdrop = posterUrl(data.content.backdropPath, 'w780');
  const total = data.priceCents * selected.length;

  return (
    <div className="space-y-8">
      <Link to="/" className="inline-block text-sm text-stone-400 hover:text-amber-300">← Todas as sessões</Link>

      <header className="grid gap-6 sm:grid-cols-[200px_1fr]">
        <div className="aspect-2/3 overflow-hidden rounded-xl bg-stone-800">
          {posterUrl(data.content.posterPath) !== null && (
            <img src={posterUrl(data.content.posterPath)!} alt="" className="h-full w-full object-cover" />
          )}
        </div>
        <div className="space-y-3">
          <h1 className="text-3xl font-semibold">{data.content.title}</h1>
          <p className="text-sm text-stone-400">
            {formatDateTime(data.startsAt)} · {data.content.runtimeMinutes} min · {data.content.genres.join(', ')}
          </p>
          <p className="text-sm text-stone-400">{data.venueName} · {data.auditoriumName}</p>
          <p className="max-w-prose text-sm leading-relaxed text-stone-300">{data.content.overview}</p>
          <p className="text-lg font-semibold text-amber-300">{formatBRL(data.priceCents)} por ingresso</p>
        </div>
      </header>

      {backdrop && <img src={backdrop} alt="" className="h-40 w-full rounded-xl object-cover opacity-40" />}

      <section className="space-y-6 rounded-xl border border-stone-800 bg-stone-900/50 p-6">
        <h2 className="text-lg font-medium">Escolha seu lugar</h2>

        {data.remainingSeats === 0
          ? <Banner tone="error">Esta sessão está esgotada.</Banner>
          : <SeatMap seats={data.seats} selected={selected} onToggle={toggle} maxSeats={MAX_SEATS} />}

        {reserveError && <Banner tone="error">{reserveError}</Banner>}

        {selected.length >= MAX_SEATS && <Banner tone="info">Máximo de {MAX_SEATS} ingressos por reserva.</Banner>}

        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-stone-800 pt-5">
          <div>
            <p className="text-sm text-stone-400">
              {selected.length === 0 ? 'Nenhum assento selecionado' : `Assentos ${selected.slice().sort().join(', ')}`}
            </p>
            <p className="text-xl font-semibold">{formatBRL(total)}</p>
          </div>
          <button type="button" onClick={reserve} disabled={selected.length === 0 || submitting}
            className="rounded-lg bg-amber-400 px-6 py-2.5 font-semibold text-stone-950 hover:bg-amber-300 disabled:opacity-40">
            {submitting ? 'Reservando…' : session === null ? 'Entrar para reservar' : 'Reservar'}
          </button>
        </div>
      </section>
    </div>
  );
}
