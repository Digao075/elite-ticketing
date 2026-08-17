import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppRoutes } from '../../apps/web/src/App';
import { AuthProvider } from '../../apps/web/src/auth/AuthContext';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </MemoryRouter>,
  );
}

const event = {
  id: '11111111-1111-4111-8111-111111111111',
  startsAt: '2030-02-01T23:00:00.000Z',
  endsAt: '2030-02-02T01:00:00.000Z',
  venueName: 'Cine Elite',
  auditoriumName: 'Sala 1',
  priceCents: 3500,
  capacity: 10,
  remainingSeats: 4,
  content: {
    providerMovieId: 550, title: 'Clube da Luta', releaseDate: null, posterPath: null,
    backdropPath: null, overview: 'Resumo.', runtimeMinutes: 139, genres: ['Drama'], originalLanguage: 'en',
  },
};

describe('web app', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists published sessions returned by the API', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [event] }));

    renderAt('/');

    expect(await screen.findByText('Clube da Luta')).toBeInTheDocument();
    expect(screen.getByText('4 livres')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Elite Ticketing' })).toBeInTheDocument();
  });

  it('shows an intentional empty state when nothing is published', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] }));

    renderAt('/');

    expect(await screen.findByText('Nenhuma sessão publicada')).toBeInTheDocument();
  });

  it('surfaces an API failure instead of failing silently', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    renderAt('/');

    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível falar com o servidor');
  });

  it('keeps an anonymous visitor away from the customer ticket area', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] }));

    renderAt('/ingressos');

    // Redirected to the sign-in screen rather than shown an empty ticket list.
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Entrar' })).toBeInTheDocument());
  });
});
