import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Banner } from '../components/states';

const DEMO = [
  { label: 'Organizador', email: 'organizador@elite.test' },
  { label: 'Cliente', email: 'cliente1@elite.test' },
  { label: 'Portaria', email: 'portaria@elite.test' },
];

const HOME_FOR = { ORGANIZER: '/organizador', CUSTOMER: '/', GATE: '/portaria' } as const;

export function LoginPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('cliente1@elite.test');
  const [password, setPassword] = useState('Elite@2026');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const role = await signIn(email.trim(), password);
      navigate(HOME_FOR[role], { replace: true });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Não foi possível entrar.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <h1 className="text-2xl font-semibold">Entrar</h1>

      <form onSubmit={submit} className="space-y-4 rounded-xl border border-stone-800 bg-stone-900/50 p-6">
        <label className="block space-y-1.5">
          <span className="text-sm text-stone-400">E-mail</span>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 outline-none focus:border-amber-400" />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm text-stone-400">Senha</span>
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 outline-none focus:border-amber-400" />
        </label>

        {error && <Banner tone="error">{error}</Banner>}

        <button type="submit" disabled={submitting}
          className="w-full rounded-lg bg-amber-400 py-2.5 font-semibold text-stone-950 hover:bg-amber-300 disabled:opacity-50">
          {submitting ? 'Entrando…' : 'Entrar'}
        </button>
      </form>

      <div className="rounded-xl border border-stone-800 p-4 text-sm">
        <p className="text-stone-400">Contas de demonstração — senha <code className="text-amber-300">Elite@2026</code></p>
        <div className="mt-3 flex flex-wrap gap-2">
          {DEMO.map((account) => (
            <button key={account.email} type="button" onClick={() => setEmail(account.email)}
              className="rounded-lg border border-stone-700 px-3 py-1.5 text-xs hover:border-amber-400">
              {account.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
