import { BrowserRouter, Link, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';

import { AuthProvider, useAuth } from './auth/AuthContext';
import type { Role } from './api/types';
import { BrowsePage } from './pages/BrowsePage';
import { CheckoutPage } from './pages/CheckoutPage';
import { EventDetailPage } from './pages/EventDetailPage';
import { GatePage } from './pages/GatePage';
import { LoginPage } from './pages/LoginPage';
import { OrganizerPage } from './pages/OrganizerPage';
import { SharedTicketPage } from './pages/SharedTicketPage';
import { TicketsPage } from './pages/TicketsPage';

/** Client-side gate for nicer UX only. Every endpoint re-checks on the server. */
function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { session } = useAuth();
  const location = useLocation();
  if (session === null) return <Navigate to="/entrar" state={{ from: location }} replace />;
  if (session.role !== role) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function Header() {
  const { session, signOut } = useAuth();
  const link = ({ isActive }: { isActive: boolean }) =>
    `rounded-lg px-3 py-1.5 text-sm transition ${isActive ? 'bg-stone-800 text-amber-300' : 'text-stone-400 hover:text-stone-100'}`;

  return (
    <header className="border-b border-stone-800">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-4">
        <h1 className="text-lg font-semibold tracking-tight">
          <Link to="/">Elite Ticketing</Link>
        </h1>

        <nav className="flex flex-1 flex-wrap items-center gap-1">
          <NavLink to="/" className={link} end>Em cartaz</NavLink>
          {session?.role === 'CUSTOMER' && <NavLink to="/ingressos" className={link}>Meus ingressos</NavLink>}
          {session?.role === 'ORGANIZER' && <NavLink to="/organizador" className={link}>Organizador</NavLink>}
          {session?.role === 'GATE' && <NavLink to="/portaria" className={link}>Portaria</NavLink>}
        </nav>

        {session === null
          ? <Link to="/entrar" className="rounded-lg border border-stone-700 px-4 py-1.5 text-sm hover:border-amber-400">Entrar</Link>
          : (
            <div className="flex items-center gap-3">
              <span className="hidden text-xs text-stone-500 sm:inline">{session.email}</span>
              <button type="button" onClick={signOut} className="rounded-lg border border-stone-700 px-3 py-1.5 text-sm hover:border-amber-400">Sair</button>
            </div>
          )}
      </div>
    </header>
  );
}

export function AppRoutes() {
  return (
    <div className="min-h-screen bg-stone-950 text-stone-100">
      <Header />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Routes>
          <Route path="/" element={<BrowsePage />} />
          <Route path="/eventos/:eventId" element={<EventDetailPage />} />
          <Route path="/entrar" element={<LoginPage />} />
          <Route path="/tickets/shared/:shareToken" element={<SharedTicketPage />} />
          <Route path="/checkout/:reservationId" element={<RequireRole role="CUSTOMER"><CheckoutPage /></RequireRole>} />
          <Route path="/ingressos" element={<RequireRole role="CUSTOMER"><TicketsPage /></RequireRole>} />
          <Route path="/organizador" element={<RequireRole role="ORGANIZER"><OrganizerPage /></RequireRole>} />
          <Route path="/portaria" element={<RequireRole role="GATE"><GatePage /></RequireRole>} />
          <Route path="*" element={<p className="text-stone-400">Página não encontrada.</p>} />
        </Routes>
      </main>
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
