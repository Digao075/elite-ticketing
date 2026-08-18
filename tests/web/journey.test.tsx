import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The camera library touches browser-only APIs at import time, and the QR
// renderer would draw a canvas on every assertion. Neither is the behaviour
// under test here, so both are replaced.
vi.mock('html5-qrcode', () => ({
  Html5Qrcode: class {
    start = vi.fn().mockResolvedValue(undefined);
    stop = vi.fn().mockResolvedValue(undefined);
  },
}));
vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,stub') },
}));

import { AppRoutes } from '../../apps/web/src/App';
import { AuthProvider } from '../../apps/web/src/auth/AuthContext';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_EVENT_ID = '22222222-2222-4222-8222-222222222222';

function seat(rowLabel: string, seatNumber: number, available = true) {
  return { id: `${rowLabel}${seatNumber}-id`, seatLabel: `${rowLabel}${seatNumber}`, rowLabel, seatNumber, available };
}

const content = {
  providerMovieId: 550, title: 'Clube da Luta', releaseDate: null, posterPath: null,
  backdropPath: null, overview: 'Resumo.', runtimeMinutes: 139, genres: ['Drama'], originalLanguage: 'en',
};

const baseEvent = {
  id: EVENT_ID,
  startsAt: '2030-02-01T23:00:00.000Z',
  endsAt: '2030-02-02T01:00:00.000Z',
  venueName: 'Cine Elite',
  auditoriumName: 'Sala 1',
  priceCents: 3500,
  capacity: 8,
  remainingSeats: 8,
  content,
};

const eventDetail = (seats = [seat('A', 1), seat('A', 2), seat('A', 3)]) => ({
  ...baseEvent,
  capacity: seats.length,
  remainingSeats: seats.filter((s) => s.available).length,
  seats,
});

const ticket = {
  id: 'ticket-1',
  seatLabel: 'A1',
  usedAt: null,
  qrPayload: 'v1.ticket-1.signature',
  shareUrlPath: '/tickets/shared/sometoken',
  event: baseEvent,
};

/**
 * Routes requests by "METHOD /path". A handler may be a plain value, or a
 * function receiving the parsed request body so a test can assert on what the
 * screen actually sent.
 */
type Handler = unknown | ((body: unknown) => unknown);

/**
 * Marks a response as an HTTP failure. A tagged wrapper is used rather than
 * sniffing for a `status` field, because ReservationDto legitimately carries
 * its own `status` and a successful payment would otherwise be mistaken for an
 * error by the test double.
 */
const fail = (status: number, message: string) => ({ __httpError: { status, message } });

function mockApi(routes: Record<string, Handler>) {
  const calls: { key: string; body: unknown }[] = [];

  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const { pathname } = new URL(url);
    const method = init?.method ?? 'GET';
    const key = `${method} ${pathname}`;
    const body = init?.body === undefined ? undefined : JSON.parse(init.body as string);
    calls.push({ key, body });

    const match = Object.keys(routes).find((route) => route === key);
    if (match === undefined) {
      return { ok: false, status: 404, json: async () => ({ statusCode: 404, message: `unrouted ${key}` }) };
    }

    const handler = routes[match];
    const result = typeof handler === 'function' ? (handler as (b: unknown) => unknown)(body) : handler;

    if (result !== null && typeof result === 'object' && '__httpError' in (result as Record<string, unknown>)) {
      const { status, message } = (result as { __httpError: { status: number; message: string } }).__httpError;
      return { ok: false, status, json: async () => ({ statusCode: status, message }) };
    }
    return { ok: true, status: 200, json: async () => result };
  });

  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

function signIn(role: 'CUSTOMER' | 'GATE' | 'ORGANIZER') {
  window.localStorage.setItem(
    'elite-ticketing.session',
    JSON.stringify({ token: 'stub-token', role, email: `${role.toLowerCase()}@elite.test` }),
  );
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('seat selection', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it('marks a taken seat as unavailable and refuses to select it', async () => {
    mockApi({ [`GET /events/${EVENT_ID}/public`]: eventDetail([seat('A', 1), seat('A', 2, false)]) });

    renderAt(`/eventos/${EVENT_ID}`);

    const taken = await screen.findByRole('button', { name: 'Assento A2 (ocupado)' });
    expect(taken).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Assento A1' }));
    expect(screen.getByRole('button', { name: 'Assento A1' })).toHaveAttribute('aria-pressed', 'true');
    // The disabled seat never becomes selected.
    expect(taken).toHaveAttribute('aria-pressed', 'false');
  });

  it('totals the selected seats at the event price', async () => {
    mockApi({ [`GET /events/${EVENT_ID}/public`]: eventDetail() });

    renderAt(`/eventos/${EVENT_ID}`);

    await userEvent.click(await screen.findByRole('button', { name: 'Assento A1' }));
    await userEvent.click(screen.getByRole('button', { name: 'Assento A2' }));

    expect(screen.getByText('Assentos A1, A2')).toBeInTheDocument();
    // R$ 35,00 x 2 — non-breaking space is what toLocaleString emits.
    expect(screen.getByText(/R\$\s?70,00/)).toBeInTheDocument();
  });

  it('stops at six seats per reservation and says why', async () => {
    const seats = Array.from({ length: 8 }, (_, index) => seat('A', index + 1));
    mockApi({ [`GET /events/${EVENT_ID}/public`]: eventDetail(seats) });

    renderAt(`/eventos/${EVENT_ID}`);

    for (let number = 1; number <= 6; number += 1) {
      await userEvent.click(await screen.findByRole('button', { name: `Assento A${number}` }));
    }

    expect(screen.getByText('Máximo de 6 ingressos por reserva.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Assento A7' })).toBeDisabled();
    // A selected seat stays clickable so the choice can be undone.
    expect(screen.getByRole('button', { name: 'Assento A1' })).toBeEnabled();
  });

  it('sends an anonymous visitor to sign in instead of reserving', async () => {
    mockApi({ [`GET /events/${EVENT_ID}/public`]: eventDetail() });

    renderAt(`/eventos/${EVENT_ID}`);

    await userEvent.click(await screen.findByRole('button', { name: 'Assento A1' }));
    expect(screen.getByRole('button', { name: 'Entrar para reservar' })).toBeInTheDocument();
  });

  it('recovers from a lost seat race by re-reading availability', async () => {
    signIn('CUSTOMER');
    let detailReads = 0;
    mockApi({
      [`GET /events/${EVENT_ID}/public`]: () => {
        detailReads += 1;
        // Somebody else took A1 between the first render and the click.
        return detailReads === 1 ? eventDetail() : eventDetail([seat('A', 1, false), seat('A', 2), seat('A', 3)]);
      },
      'POST /reservations': fail(409, 'Seat is no longer available'),
    });

    renderAt(`/eventos/${EVENT_ID}`);

    await userEvent.click(await screen.findByRole('button', { name: 'Assento A1' }));
    await userEvent.click(screen.getByRole('button', { name: 'Reservar' }));

    expect(await screen.findByText('Seat is no longer available')).toBeInTheDocument();
    // The stale map is replaced rather than left showing a seat that is gone.
    await waitFor(() => expect(detailReads).toBeGreaterThan(1));
    expect(await screen.findByRole('button', { name: 'Assento A1 (ocupado)' })).toBeDisabled();
  });
});

describe('simulated payment', () => {
  beforeEach(() => {
    window.localStorage.clear();
    signIn('CUSTOMER');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('confirms an approved payment and points at the tickets', async () => {
    const calls = mockApi({
      'POST /reservations/res-1/payment': { id: 'res-1', eventId: EVENT_ID, status: 'PAID', expiresAt: '2030-01-01T00:10:00.000Z', totalCents: 7000, seats: [{ seatLabel: 'A1', rowLabel: 'A', seatNumber: 1 }] },
    });

    renderAt('/checkout/res-1');

    await userEvent.click(screen.getByRole('button', { name: 'Simular pagamento aprovado' }));

    expect(await screen.findByText('Pagamento aprovado')).toBeInTheDocument();
    expect(calls.at(-1)?.body).toEqual({ outcome: 'approve' });
  });

  it('states that a refused payment issued nothing and freed the seats', async () => {
    const calls = mockApi({
      'POST /reservations/res-1/payment': { id: 'res-1', eventId: EVENT_ID, status: 'DECLINED', expiresAt: '2030-01-01T00:10:00.000Z', totalCents: 3500, seats: [{ seatLabel: 'A1', rowLabel: 'A', seatNumber: 1 }] },
    });

    renderAt('/checkout/res-1');

    await userEvent.click(screen.getByRole('button', { name: 'Simular pagamento recusado' }));

    expect(await screen.findByText('Pagamento recusado')).toBeInTheDocument();
    expect(screen.getByText(/Nenhum ingresso foi emitido/)).toBeInTheDocument();
    expect(calls.at(-1)?.body).toEqual({ outcome: 'decline' });
  });

  it('surfaces a refused expired reservation instead of failing silently', async () => {
    mockApi({ 'POST /reservations/res-1/payment': fail(409, 'Reservation has expired') });

    renderAt('/checkout/res-1');

    await userEvent.click(screen.getByRole('button', { name: 'Simular pagamento aprovado' }));

    expect(await screen.findByText('Reservation has expired')).toBeInTheDocument();
  });
});

describe('gate validation', () => {
  beforeEach(() => {
    window.localStorage.clear();
    signIn('GATE');
  });
  afterEach(() => vi.unstubAllGlobals());

  async function validateWith(outcome: Record<string, unknown>) {
    mockApi({ 'GET /events': [baseEvent], 'POST /gate/validations': outcome });
    renderAt('/portaria');
    const field = await screen.findByPlaceholderText('v1.…');
    await userEvent.type(field, 'v1.ticket-1.signature');
    await userEvent.click(screen.getByRole('button', { name: 'Validar' }));
  }

  it('admits a valid ticket and names the seat', async () => {
    await validateWith({ outcome: 'VALID', seatLabel: 'A1', eventTitle: 'Clube da Luta', usedAt: '2030-02-01T22:00:00.000Z' });

    expect(await screen.findByText('Entrada liberada')).toBeInTheDocument();
    expect(screen.getByText(/Assento A1/)).toBeInTheDocument();
  });

  it('refuses a second scan of the same ticket', async () => {
    await validateWith({ outcome: 'ALREADY_USED', seatLabel: 'A1', eventTitle: 'Clube da Luta', usedAt: '2030-02-01T22:00:00.000Z' });

    expect(await screen.findByText('Ingresso já utilizado')).toBeInTheDocument();
  });

  it('separates a wrong-session ticket from an invalid one', async () => {
    await validateWith({ outcome: 'WRONG_EVENT', seatLabel: 'A1', eventTitle: 'Outro Filme', usedAt: null });

    expect(await screen.findByText('Sessão errada')).toBeInTheDocument();
    expect(screen.getByText('Este ingresso é de outra sessão.')).toBeInTheDocument();
  });

  it('rejects a forged code', async () => {
    await validateWith({ outcome: 'INVALID', seatLabel: null, eventTitle: null, usedAt: null });

    expect(await screen.findByText('Ingresso inválido')).toBeInTheDocument();
  });

  it('offers manual entry so the door still works without a camera', async () => {
    mockApi({ 'GET /events': [baseEvent] });
    renderAt('/portaria');

    expect(await screen.findByPlaceholderText('v1.…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ler QR pela câmera' })).toBeInTheDocument();
  });
});

describe('my tickets', () => {
  beforeEach(() => {
    window.localStorage.clear();
    signIn('CUSTOMER');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows an intentional empty state before any purchase', async () => {
    mockApi({ 'GET /tickets/me': [] });

    renderAt('/ingressos');

    expect(await screen.findByText('Você ainda não tem ingressos')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver sessões' })).toBeInTheDocument();
  });

  it('renders the QR and a share link for an unused ticket', async () => {
    mockApi({ 'GET /tickets/me': [ticket] });

    renderAt('/ingressos');

    expect(await screen.findByAltText('QR code do ingresso')).toBeInTheDocument();
    expect(screen.getByText('A1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Abrir' })).toHaveAttribute('href', '/tickets/shared/sometoken');
  });

  it('replaces the QR with the consumption time once the ticket is used', async () => {
    mockApi({ 'GET /tickets/me': [{ ...ticket, usedAt: '2030-02-01T22:00:00.000Z' }] });

    renderAt('/ingressos');

    expect(await screen.findByText(/Ingresso já utilizado/)).toBeInTheDocument();
    expect(screen.queryByAltText('QR code do ingresso')).not.toBeInTheDocument();
  });
});
