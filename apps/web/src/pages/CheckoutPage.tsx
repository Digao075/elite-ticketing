import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { ApiError, apiRequest, formatBRL } from '../api/client';
import type { Reservation } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Banner } from '../components/states';

/**
 * Simulated checkout. The outcome is chosen explicitly so a reviewer can walk
 * both the approved and the refused path without a payment provider.
 */
export function CheckoutPage() {
  const { reservationId = '' } = useParams();
  const { session } = useAuth();
  const navigate = useNavigate();
  const [result, setResult] = useState<Reservation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<'approve' | 'decline' | null>(null);

  async function pay(outcome: 'approve' | 'decline') {
    if (session === null) return;
    setPending(outcome);
    setError(null);
    try {
      setResult(await apiRequest<Reservation>(`/reservations/${reservationId}/payment`, {
        method: 'POST', token: session.token, body: { outcome },
      }));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'O pagamento falhou.');
    } finally {
      setPending(null);
    }
  }

  if (result?.status === 'PAID') {
    return (
      <div className="mx-auto max-w-md space-y-5 text-center">
        <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-emerald-500/15 text-3xl text-emerald-400">✓</div>
        <h1 className="text-2xl font-semibold">Pagamento aprovado</h1>
        <p className="text-stone-400">
          {result.seats.length === 1 ? 'Seu ingresso está' : 'Seus ingressos estão'} disponível{result.seats.length === 1 ? '' : 'eis'} em Meus ingressos.
        </p>
        <button type="button" onClick={() => navigate('/ingressos')}
          className="w-full rounded-lg bg-amber-400 py-2.5 font-semibold text-stone-950 hover:bg-amber-300">
          Ver meus ingressos
        </button>
      </div>
    );
  }

  if (result?.status === 'DECLINED') {
    return (
      <div className="mx-auto max-w-md space-y-5 text-center">
        <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-red-500/15 text-3xl text-red-400">×</div>
        <h1 className="text-2xl font-semibold">Pagamento recusado</h1>
        <p className="text-stone-400">Nenhum ingresso foi emitido e os assentos voltaram para o estoque.</p>
        <button type="button" onClick={() => navigate('/')}
          className="w-full rounded-lg border border-stone-700 py-2.5 font-medium hover:border-amber-400">
          Escolher outra sessão
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <h1 className="text-2xl font-semibold">Pagamento</h1>
      <Banner tone="info">
        Cobrança simulada — nenhuma transação real acontece. Escolha o resultado para percorrer os dois caminhos.
      </Banner>

      {error && <Banner tone="error">{error}</Banner>}

      <div className="space-y-3 rounded-xl border border-stone-800 bg-stone-900/50 p-6">
        <p className="text-sm text-stone-400">Reserva {reservationId.slice(0, 8)}…</p>
        <p className="text-xs text-stone-500">A reserva expira em 10 minutos se o pagamento não for concluído.</p>

        <div className="grid gap-3 pt-3">
          <button type="button" onClick={() => pay('approve')} disabled={pending !== null}
            className="rounded-lg bg-emerald-500 py-3 font-semibold text-stone-950 hover:bg-emerald-400 disabled:opacity-50">
            {pending === 'approve' ? 'Processando…' : 'Simular pagamento aprovado'}
          </button>
          <button type="button" onClick={() => pay('decline')} disabled={pending !== null}
            className="rounded-lg border border-red-800 py-3 font-medium text-red-300 hover:bg-red-950/40 disabled:opacity-50">
            {pending === 'decline' ? 'Processando…' : 'Simular pagamento recusado'}
          </button>
        </div>
      </div>
    </div>
  );
}
