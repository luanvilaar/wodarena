'use client';

import { useRef, useState, type FormEvent } from 'react';
import { Building, KeyRound } from 'lucide-react';
import { MANAGER_PASSWORD_MIN_LENGTH } from '@/lib/managerAccess';

// Cadastro de gestor no painel lateral (Story 1.125; regras da Story 1.121): senha
// mínima, envio travado contra duplo clique e a mensagem real da API na tela.

export type NewManagerInput = {
  name: string;
  email: string;
  password: string;
  organization: string;
  serviceValidUntil?: string;
};

type Props = {
  onCreate: (input: NewManagerInput) => Promise<{ success: true } | { success: false; error: string }>;
  onCreated: (name: string) => void;
  onBusyChange?: (busy: boolean) => void;
};

const inputClassName = 'min-h-11 w-full rounded-lg border border-card-border bg-background px-3 text-sm text-white placeholder:text-muted focus:border-primary/50 focus:outline-none';
const labelClassName = 'mb-1 block text-[11px] font-bold uppercase tracking-wider text-muted';

export function OwnerNewManagerForm({ onCreate, onCreated, onBusyChange }: Props) {
  const [name, setName] = useState('');
  const [organization, setOrganization] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [serviceValidUntil, setServiceValidUntil] = useState('');
  const [message, setMessage] = useState({ text: '', isError: false });
  const [isCreatingManager, setIsCreatingManager] = useState(false);
  const createManagerPendingRef = useRef(false);

  const handleCreateManager = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (createManagerPendingRef.current) return;
    if (!name.trim() || !email.trim() || !password || !organization.trim()) {
      setMessage({ text: 'Preencha nome, organização, e-mail e senha do gestor.', isError: true });
      return;
    }
    if (password.length < MANAGER_PASSWORD_MIN_LENGTH) {
      setMessage({ text: `A senha temporária precisa ter pelo menos ${MANAGER_PASSWORD_MIN_LENGTH} caracteres.`, isError: true });
      return;
    }

    // Trava o envio: um duplo clique criava o gestor e logo depois mostrava "e-mail já existe".
    createManagerPendingRef.current = true;
    setIsCreatingManager(true);
    onBusyChange?.(true);
    setMessage({ text: '', isError: false });
    let result: Awaited<ReturnType<Props['onCreate']>>;
    try {
      result = await onCreate({ name, email, password, organization, serviceValidUntil: serviceValidUntil || undefined });
    } finally {
      createManagerPendingRef.current = false;
      setIsCreatingManager(false);
      onBusyChange?.(false);
    }

    if (result.success) {
      onCreated(name.trim());
      return;
    }
    setMessage({ text: result.error, isError: true });
  };

  return (
    <form onSubmit={handleCreateManager} className="space-y-4" aria-busy={isCreatingManager}>
      <div>
        <label htmlFor="manager-name" className={labelClassName}>Nome do gestor *</label>
        <input id="manager-name" name="manager-name" autoComplete="name" required placeholder="Ex.: Carlos Roberto" value={name} onChange={event => setName(event.target.value)} className={inputClassName} />
      </div>
      <div>
        <label htmlFor="manager-organization" className={labelClassName}>Organização / box *</label>
        <div className="relative">
          <Building className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" aria-hidden />
          <input id="manager-organization" name="manager-organization" autoComplete="organization" required placeholder="Ex.: Box Exemplo" value={organization} onChange={event => setOrganization(event.target.value)} className={`${inputClassName} pl-9`} />
        </div>
      </div>
      <div>
        <label htmlFor="manager-email" className={labelClassName}>E-mail de login *</label>
        <input id="manager-email" name="manager-email" type="email" autoComplete="email" required placeholder="gestor@email.com" value={email} onChange={event => setEmail(event.target.value)} className={inputClassName} />
      </div>
      <div>
        <label htmlFor="manager-password" className={labelClassName}>Senha temporária *</label>
        <div className="relative">
          <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" aria-hidden />
          <input
            id="manager-password"
            name="manager-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={MANAGER_PASSWORD_MIN_LENGTH}
            placeholder={`Mínimo de ${MANAGER_PASSWORD_MIN_LENGTH} caracteres`}
            value={password}
            onChange={event => setPassword(event.target.value)}
            className={`${inputClassName} pl-9`}
          />
        </div>
      </div>
      <div>
        <label htmlFor="manager-service-valid-until" className={labelClassName}>Validade de uso</label>
        <input id="manager-service-valid-until" name="manager-service-valid-until" type="date" value={serviceValidUntil} onChange={event => setServiceValidUntil(event.target.value)} className={inputClassName} />
        <p className="mt-1 text-xs text-muted">Opcional. Pode ser definida agora ou renovada depois.</p>
      </div>

      {message.text && (
        <p role={message.isError ? 'alert' : 'status'} className={`rounded-lg border px-3 py-2 text-xs font-semibold ${message.isError ? 'border-red-500/30 bg-red-950/20 text-red-300' : 'border-primary/30 bg-primary/10 text-primary'}`}>
          {message.text}
        </p>
      )}

      <button
        type="submit"
        disabled={isCreatingManager}
        aria-busy={isCreatingManager}
        className="min-h-11 w-full rounded-md bg-primary text-xs font-bold uppercase tracking-wider text-black transition-colors hover:bg-primary-hover disabled:cursor-wait disabled:opacity-60"
      >
        {isCreatingManager ? 'Cadastrando…' : 'Emitir credenciais de gestor'}
      </button>
    </form>
  );
}
