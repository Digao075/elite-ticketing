import { useState, type FormEvent } from 'react';

import { ApiError, apiRequest, formatBRL, posterUrl } from '../api/client';
import type { MovieSummary } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Banner, Spinner } from '../components/states';
import { OrganizerEventList } from '../components/OrganizerEventList';

type Draft = { id: string; title: string };

/**
 * Organizer flow in one screen: pick a film, schedule it, lay out the room,
 * publish. Kept as a single guided sequence because each step depends on the
 * id produced by the previous one.
 */
export function OrganizerPage() {
  const { session } = useAuth();
  const token = session?.token ?? null;

  const [query, setQuery] = useState('');
  const [movies, setMovies] = useState<MovieSummary[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [chosen, setChosen] = useState<MovieSummary | null>(null);

  const [startsAt, setStartsAt] = useState('');
  const [venueName, setVenueName] = useState('Cine Elite Centro');
  const [auditoriumName, setAuditoriumName] = useState('Sala 2');
  const [draft, setDraft] = useState<Draft | null>(null);

  const [rows, setRows] = useState(4);
  const [seatsPerRow, setSeatsPerRow] = useState(8);
  const [price, setPrice] = useState('35,00');
  const [seated, setSeated] = useState<number | null>(null);

  const [published, setPublished] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped whenever the wizard changes something the dashboard displays.
  const [version, setVersion] = useState(0);
  const refreshDashboard = () => setVersion((current) => current + 1);

  const fail = (cause: unknown, fallback: string) =>
    setError(cause instanceof ApiError ? cause.message : fallback);

  async function search(event: FormEvent) {
    event.preventDefault();
    setSearching(true);
    setError(null);
    try {
      setMovies(await apiRequest<MovieSummary[]>(`/catalog/movies?query=${encodeURIComponent(query)}`, { token }));
    } catch (cause) {
      fail(cause, 'A busca falhou. Confira TMDB_API_KEY no .env.');
      setMovies(null);
    } finally {
      setSearching(false);
    }
  }

  async function createDraft(event: FormEvent) {
    event.preventDefault();
    if (chosen === null) return;
    setBusy(true);
    setError(null);
    try {
      // The selection is signed by the API so the event snapshot cannot be
      // tampered with between choosing the film and creating the session.
      const selection = await apiRequest<{ selectionToken: string }>(
        `/catalog/movies/${chosen.providerMovieId}/selection`, { method: 'POST', token },
      );
      const created = await apiRequest<{ id: string }>('/events', {
        method: 'POST', token,
        body: {
          providerMovieId: chosen.providerMovieId,
          selectionToken: selection.selectionToken,
          startsAt: new Date(startsAt).toISOString(),
          venueName, auditoriumName,
        },
      });
      setDraft({ id: created.id, title: chosen.title });
      refreshDashboard();
    } catch (cause) {
      fail(cause, 'Não foi possível criar o evento.');
    } finally {
      setBusy(false);
    }
  }

  async function configureSeats(event: FormEvent) {
    event.preventDefault();
    if (draft === null) return;
    setBusy(true);
    setError(null);
    try {
      const priceCents = Math.round(Number(price.replace(/\./g, '').replace(',', '.')) * 100);
      const result = await apiRequest<{ capacity: number }>(`/events/${draft.id}/seats`, {
        method: 'PUT', token,
        body: {
          priceCents,
          rows: Array.from({ length: rows }, (_, index) => ({ label: String.fromCharCode(65 + index), seatCount: seatsPerRow })),
        },
      });
      setSeated(result.capacity);
      refreshDashboard();
    } catch (cause) {
      fail(cause, 'Não foi possível configurar os assentos.');
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (draft === null) return;
    setBusy(true);
    setError(null);
    try {
      await apiRequest(`/events/${draft.id}/publish`, { method: 'POST', token });
      setPublished(true);
      refreshDashboard();
    } catch (cause) {
      fail(cause, 'Não foi possível publicar.');
    } finally {
      setBusy(false);
    }
  }

  const step = published ? 4 : seated !== null ? 3 : draft !== null ? 2 : 1;
  const card = 'space-y-4 rounded-xl border border-stone-800 bg-stone-900/50 p-6';
  const field = 'w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 outline-none focus:border-amber-400';
  const primary = 'rounded-lg bg-amber-400 px-5 py-2.5 font-semibold text-stone-950 hover:bg-amber-300 disabled:opacity-40';

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <OrganizerEventList token={token} version={version} />

      <div className="border-t border-stone-800 pt-6">
        <h1 className="text-2xl font-semibold">Nova sessão</h1>
        <p className="text-sm text-stone-400">Passo {step} de 4</p>
      </div>

      {error && <Banner tone="error">{error}</Banner>}

      <section className={card} aria-labelledby="step-1">
        <h2 id="step-1" className="font-medium">1 · Escolha o filme</h2>
        {chosen === null ? (
          <>
            <form onSubmit={search} className="flex gap-2">
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar no TMDb…" className={`${field} min-w-0 flex-1`} />
              <button type="submit" disabled={query.trim() === '' || searching} className={primary}>Buscar</button>
            </form>
            {searching && <Spinner label="Consultando o TMDb…" />}
            {movies !== null && movies.length === 0 && <p className="text-sm text-stone-400">Nenhum filme encontrado.</p>}
            {movies !== null && movies.length > 0 && (
              <ul className="grid max-h-80 grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3">
                {movies.map((movie) => (
                  <li key={movie.providerMovieId}>
                    <button type="button" onClick={() => setChosen(movie)}
                      className="w-full overflow-hidden rounded-lg border border-stone-800 text-left hover:border-amber-400">
                      <div className="aspect-2/3 bg-stone-800">
                        {posterUrl(movie.posterPath) !== null && <img src={posterUrl(movie.posterPath)!} alt="" className="h-full w-full object-cover" />}
                      </div>
                      <p className="truncate p-2 text-xs">{movie.title}</p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <div className="flex items-center justify-between gap-4">
            <p className="font-medium text-amber-300">{chosen.title}</p>
            {draft === null && (
              <button type="button" onClick={() => setChosen(null)} className="text-sm text-stone-400 hover:text-amber-300">Trocar</button>
            )}
          </div>
        )}
      </section>

      {chosen !== null && (
        <section className={card} aria-labelledby="step-2">
          <h2 id="step-2" className="font-medium">2 · Data, local e sala</h2>
          {draft === null ? (
            <form onSubmit={createDraft} className="space-y-3">
              <input type="datetime-local" required value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className={field} />
              <input required value={venueName} onChange={(e) => setVenueName(e.target.value)} placeholder="Local" className={field} />
              <input required value={auditoriumName} onChange={(e) => setAuditoriumName(e.target.value)} placeholder="Sala" className={field} />
              <button type="submit" disabled={busy} className={primary}>{busy ? 'Criando…' : 'Criar rascunho'}</button>
            </form>
          ) : (
            <Banner tone="success">Rascunho criado.</Banner>
          )}
        </section>
      )}

      {draft !== null && (
        <section className={card} aria-labelledby="step-3">
          <h2 id="step-3" className="font-medium">3 · Assentos e preço</h2>
          {seated === null ? (
            <form onSubmit={configureSeats} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="space-y-1 text-sm text-stone-400">Fileiras
                  <input type="number" min={1} max={26} value={rows} onChange={(e) => setRows(Number(e.target.value))} className={field} />
                </label>
                <label className="space-y-1 text-sm text-stone-400">Por fileira
                  <input type="number" min={1} max={50} value={seatsPerRow} onChange={(e) => setSeatsPerRow(Number(e.target.value))} className={field} />
                </label>
                <label className="space-y-1 text-sm text-stone-400">Preço (R$)
                  <input value={price} onChange={(e) => setPrice(e.target.value)} className={field} />
                </label>
              </div>
              <p className="text-xs text-stone-500">
                {rows * seatsPerRow} assentos · arrecadação máxima {formatBRL(Math.round(Number(price.replace(/\./g, '').replace(',', '.')) * 100) * rows * seatsPerRow || 0)}
              </p>
              <button type="submit" disabled={busy} className={primary}>{busy ? 'Salvando…' : 'Salvar mapa'}</button>
            </form>
          ) : (
            <Banner tone="success">{seated} assentos configurados.</Banner>
          )}
        </section>
      )}

      {seated !== null && (
        <section className={card} aria-labelledby="step-4">
          <h2 id="step-4" className="font-medium">4 · Publicar</h2>
          {published ? (
            <Banner tone="success">Sessão publicada — já aparece para os clientes.</Banner>
          ) : (
            <>
              <p className="text-sm text-stone-400">Depois de publicada, o mapa de assentos não pode mais ser alterado.</p>
              <button type="button" onClick={publish} disabled={busy} className={primary}>{busy ? 'Publicando…' : 'Publicar sessão'}</button>
            </>
          )}
        </section>
      )}
    </div>
  );
}
