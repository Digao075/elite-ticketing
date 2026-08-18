import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const DRAFT_ID = '11111111-1111-4111-8111-111111111111';
const PUBLISHED_ID = '22222222-2222-4222-8222-222222222222';

function organizerEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: PUBLISHED_ID,
    status: 'PUBLISHED',
    startsAt: '2030-02-01T23:00:00.000Z',
    venueName: 'Cine Elite',
    auditoriumName: 'Sala 1',
    priceCents: 3500,
    capacity: 10,
    ticketsSold: 4,
    remainingSeats: 5,
    revenueCents: 14000,
    readyToPublish: false,
    content: { title: 'Clube da Luta', posterPath: null, runtimeMinutes: 139, genres: ['Drama'] },
    ...overrides,
  };
}

function mockApi(routes: Record<string, unknown | ((body: unknown) => unknown)>) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${new URL(url).pathname}`;
    calls.push(key);
    const handler = routes[key];
    if (handler === undefined) {
      return { ok: false, status: 404, json: async () => ({ statusCode: 404, message: `unrouted ${key}` }) };
    }
    const result = typeof handler === 'function' ? (handler as () => unknown)() : handler;
    return { ok: true, status: 200, json: async () => result };
  }));
  return calls;
}

function renderOrganizer() {
  window.localStorage.setItem(
    'elite-ticketing.session',
    JSON.stringify({ token: 'stub', role: 'ORGANIZER', email: 'organizador@elite.test' }),
  );
  return render(
    <MemoryRouter initialEntries={['/organizador']}>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('organizer dashboard', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it('summarises each session with its status and sales', async () => {
    mockApi({ 'GET /organizer/events': [organizerEvent()] });

    renderOrganizer();

    expect(await screen.findByText('Clube da Luta')).toBeInTheDocument();
    expect(screen.getByText('Publicado')).toBeInTheDocument();
    expect(screen.getByText(/4\/10 vendidos/)).toBeInTheDocument();
    expect(screen.getByText(/5 livres/)).toBeInTheDocument();
    // Totals across published sessions.
    expect(screen.getByText(/4 ingressos vendidos/)).toBeInTheDocument();
  });

  it('offers publishing only for a draft that already has a price and seats', async () => {
    mockApi({
      'GET /organizer/events': [
        organizerEvent({ id: DRAFT_ID, status: 'DRAFT', readyToPublish: false, priceCents: null, capacity: 0, ticketsSold: 0, remainingSeats: 0, revenueCents: 0 }),
      ],
    });

    renderOrganizer();

    expect(await screen.findByText('Rascunho')).toBeInTheDocument();
    expect(screen.getByText('Defina preço e assentos para publicar')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publicar' })).not.toBeInTheDocument();
    expect(screen.getByText('Sem assentos configurados')).toBeInTheDocument();
  });

  it('publishes a ready draft and reloads the list', async () => {
    let listReads = 0;
    const calls = mockApi({
      'GET /organizer/events': () => {
        listReads += 1;
        return listReads === 1
          ? [organizerEvent({ id: DRAFT_ID, status: 'DRAFT', readyToPublish: true, ticketsSold: 0, revenueCents: 0 })]
          : [organizerEvent({ id: DRAFT_ID, status: 'PUBLISHED', readyToPublish: false, ticketsSold: 0, revenueCents: 0 })];
      },
      [`POST /events/${DRAFT_ID}/publish`]: { id: DRAFT_ID, status: 'PUBLISHED', priceCents: 3500, capacity: 10 },
    });

    renderOrganizer();

    await userEvent.click(await screen.findByRole('button', { name: 'Publicar' }));

    expect(calls).toContain(`POST /events/${DRAFT_ID}/publish`);
    expect(await screen.findByText('Publicado')).toBeInTheDocument();
    await waitFor(() => expect(listReads).toBeGreaterThan(1));
  });

  it('shows an intentional empty state before the first session exists', async () => {
    mockApi({ 'GET /organizer/events': [] });

    renderOrganizer();

    expect(await screen.findByText('Você ainda não criou sessões')).toBeInTheDocument();
    // The creation wizard is still reachable underneath.
    expect(screen.getByText('Nova sessão')).toBeInTheDocument();
  });

  it('surfaces a failed publish without losing the list', async () => {
    mockApi({
      'GET /organizer/events': [organizerEvent({ id: DRAFT_ID, status: 'DRAFT', readyToPublish: true })],
    });

    renderOrganizer();
    // The publish route is unrouted, so the request fails.
    await userEvent.click(await screen.findByRole('button', { name: 'Publicar' }));

    expect(await screen.findByText(/unrouted/)).toBeInTheDocument();
    expect(screen.getByText('Clube da Luta')).toBeInTheDocument();
  });
});
