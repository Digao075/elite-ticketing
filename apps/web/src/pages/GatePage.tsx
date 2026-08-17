import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

import { ApiError, apiRequest, formatDateTime } from '../api/client';
import { useAsync } from '../api/useAsync';
import type { EventListEntry, GateValidation } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Banner, ErrorState, Spinner } from '../components/states';

const READER_ID = 'gate-qr-reader';

const OUTCOME = {
  VALID: { title: 'Entrada liberada', tone: 'bg-emerald-500/15 text-emerald-300 border-emerald-700', icon: '✓' },
  ALREADY_USED: { title: 'Ingresso já utilizado', tone: 'bg-amber-500/15 text-amber-300 border-amber-700', icon: '!' },
  WRONG_EVENT: { title: 'Sessão errada', tone: 'bg-amber-500/15 text-amber-300 border-amber-700', icon: '!' },
  INVALID: { title: 'Ingresso inválido', tone: 'bg-red-500/15 text-red-300 border-red-700', icon: '×' },
} as const;

export function GatePage() {
  const { session } = useAuth();
  const events = useAsync(() => apiRequest<EventListEntry[]>('/events'), []);
  const [eventId, setEventId] = useState('');
  const [manual, setManual] = useState('');
  const [result, setResult] = useState<GateValidation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    if (eventId === '' && events.data && events.data.length > 0) setEventId(events.data[0].id);
  }, [events.data, eventId]);

  // Camera must be released when leaving the screen, or it stays on.
  useEffect(() => () => { void scannerRef.current?.stop().catch(() => undefined); }, []);

  async function validate(qrPayload: string) {
    if (session === null || eventId === '' || busyRef.current) return;
    busyRef.current = true;
    setError(null);
    try {
      setResult(await apiRequest<GateValidation>('/gate/validations', {
        method: 'POST', token: session.token, body: { qrPayload: qrPayload.trim(), eventId },
      }));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Não foi possível validar.');
    } finally {
      // Brief cooldown so one QR held to the lens is not read repeatedly.
      window.setTimeout(() => { busyRef.current = false; }, 1200);
    }
  }

  async function startCamera() {
    setCameraError(null);
    try {
      const scanner = new Html5Qrcode(READER_ID);
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (decoded) => { void validate(decoded); },
        () => undefined,
      );
      setScanning(true);
    } catch {
      setCameraError('Não foi possível abrir a câmera. Navegadores só liberam a câmera em https ou localhost — use a digitação manual.');
    }
  }

  async function stopCamera() {
    await scannerRef.current?.stop().catch(() => undefined);
    scannerRef.current = null;
    setScanning(false);
  }

  if (events.loading) return <Spinner />;
  if (events.error !== null) return <ErrorState message={events.error} onRetry={events.reload} />;

  const outcome = result === null ? null : OUTCOME[result.outcome];

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <h1 className="text-2xl font-semibold">Portaria</h1>

      <label className="block space-y-1.5">
        <span className="text-sm text-stone-400">Sessão desta entrada</span>
        <select value={eventId} onChange={(e) => { setEventId(e.target.value); setResult(null); }}
          className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 outline-none focus:border-amber-400">
          {events.data?.map((event) => (
            <option key={event.id} value={event.id}>
              {event.content.title} — {formatDateTime(event.startsAt)}
            </option>
          ))}
        </select>
      </label>

      {outcome !== null && result !== null && (
        <div className={`rounded-xl border p-6 text-center ${outcome.tone}`} role="status" aria-live="polite">
          <div className="mx-auto mb-3 flex size-14 items-center justify-center rounded-full bg-black/30 text-3xl">{outcome.icon}</div>
          <p className="text-xl font-semibold">{outcome.title}</p>
          {result.seatLabel !== null && <p className="mt-1 text-sm">Assento {result.seatLabel} · {result.eventTitle}</p>}
          {result.outcome === 'ALREADY_USED' && result.usedAt !== null && (
            <p className="mt-1 text-sm opacity-80">Validado em {formatDateTime(result.usedAt)}</p>
          )}
          {result.outcome === 'WRONG_EVENT' && <p className="mt-1 text-sm opacity-80">Este ingresso é de outra sessão.</p>}
        </div>
      )}

      {error && <Banner tone="error">{error}</Banner>}

      <section className="space-y-4 rounded-xl border border-stone-800 bg-stone-900/50 p-5">
        <div id={READER_ID} className={`overflow-hidden rounded-lg ${scanning ? 'block' : 'hidden'}`} />

        {cameraError && <Banner tone="error">{cameraError}</Banner>}

        <button type="button" onClick={() => (scanning ? stopCamera() : startCamera())}
          className="w-full rounded-lg bg-amber-400 py-2.5 font-semibold text-stone-950 hover:bg-amber-300">
          {scanning ? 'Parar câmera' : 'Ler QR pela câmera'}
        </button>

        <div className="flex items-center gap-3 text-xs text-stone-500">
          <span className="h-px flex-1 bg-stone-800" />ou digite o código<span className="h-px flex-1 bg-stone-800" />
        </div>

        <form onSubmit={(e) => { e.preventDefault(); void validate(manual); }} className="flex gap-2">
          <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="v1.…"
            className="min-w-0 flex-1 rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 font-mono text-sm outline-none focus:border-amber-400" />
          <button type="submit" disabled={manual.trim() === ''}
            className="rounded-lg border border-stone-600 px-4 text-sm font-medium hover:border-amber-400 disabled:opacity-40">
            Validar
          </button>
        </form>
      </section>
    </div>
  );
}
