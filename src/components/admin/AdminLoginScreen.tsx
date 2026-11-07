'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { BarChart3, ClipboardList, Dumbbell, Eye, EyeOff, Loader2, Lock, LogIn, Mail, Scale, SlidersHorizontal, Users } from 'lucide-react';

// Tela de login do painel (Story 1.92, proposta C de docs/design/login-novo/):
// um login só, a área vem da conta. As três áreas aparecem ao lado só como
// informação. Recuperar e redefinir senha usam o mesmo painel. A fonte de
// display (--font-login-display) vem do wrapper em src/app/admin/page.tsx.
// A variante `owner` (Story 1.123, decisão D6 de docs/design/painel-proprietario/)
// é a mesma tela para o /owner: título do proprietário, só o formulário de login
// e, ao lado, o que o painel tem. O login() com ownerOnly não muda.

export type AdminLoginMode = 'login' | 'forgot' | 'reset';
export type AdminLoginNotice = { text: string; tone: 'success' | 'error' };

type AdminLoginScreenProps = {
  /** `panel` (padrão): /admin. `owner`: /owner, sem lembrar e-mail, recuperação nem criação de conta. */
  variant?: 'panel' | 'owner';
  mode: AdminLoginMode;
  notice: AdminLoginNotice | null;
  login: {
    email: string;
    password: string;
    remember?: boolean;
    submitting: boolean;
    onEmailChange: (value: string) => void;
    onPasswordChange: (value: string) => void;
    onRememberChange?: (value: boolean) => void;
    onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
    onForgotPassword?: () => void;
  };
  forgot?: {
    email: string;
    submitting: boolean;
    onEmailChange: (value: string) => void;
    onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
    onBack: () => void;
  };
  reset?: {
    password: string;
    confirm: string;
    submitting: boolean;
    onPasswordChange: (value: string) => void;
    onConfirmChange: (value: string) => void;
    onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  };
};

const displayClassName = 'font-[family-name:var(--font-login-display)] font-normal uppercase';
const focusRingClassName = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info';
const inputClassName = `h-12 w-full rounded-sm border border-card-border bg-background px-4 text-base text-white placeholder:text-muted transition-colors focus:border-info ${focusRingClassName}`;
const labelClassName = 'text-xs font-bold uppercase tracking-wider text-muted';
const linkButtonClassName = `min-h-11 rounded-sm text-sm font-semibold text-primary transition-colors hover:text-primary-hover ${focusRingClassName}`;

const COPY: Record<AdminLoginMode, { title: string; subtitle: string }> = {
  login: {
    title: 'Bem-vindo',
    subtitle: 'Entre com seu e-mail e senha. A WODArena abre a área certa para a sua conta.'
  },
  forgot: {
    title: 'Recuperar senha',
    subtitle: 'Informe o e-mail cadastrado. Enviaremos um link de recuperação.'
  },
  reset: {
    title: 'Nova senha',
    subtitle: 'Escolha uma nova senha para entrar na sua conta.'
  }
};

const OWNER_COPY = {
  title: 'Painel do proprietário',
  subtitle: 'Acesso restrito à conta proprietária da WODArena.'
};

const OWNER_SECTIONS = [
  { id: 'numbers', Icon: BarChart3, name: 'Números da plataforma', description: 'Receita, vendas e taxa, por moeda e período' },
  { id: 'people', Icon: Users, name: 'Gestores e eventos', description: 'Validade de acesso, vendas e ranking' },
  { id: 'settings', Icon: SlidersHorizontal, name: 'Comercial e configurações', description: 'Leads, taxa de serviço e vitrine da home' }
] as const;

const AREAS = [
  { id: 'admin', Icon: ClipboardList, name: 'Área administrativa', description: 'Se você organiza eventos' },
  { id: 'judge', Icon: Scale, name: 'Área do judge', description: 'Se você arbitra um evento' },
  { id: 'athlete', Icon: Dumbbell, name: 'Área do atleta', description: 'Se você compete' }
] as const;

type FieldProps = {
  id: string;
  label: string;
  type?: 'text' | 'email';
  autoComplete: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  minLength?: number;
};

function Field({ id, label, type = 'text', autoComplete, placeholder, value, onChange, minLength }: FieldProps) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className={labelClassName}>{label}</label>
      <input
        id={id}
        name={id}
        type={type}
        autoComplete={autoComplete}
        required
        minLength={minLength}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={inputClassName}
      />
    </div>
  );
}

function PasswordField({ id, label, autoComplete, placeholder, value, onChange, minLength }: Omit<FieldProps, 'type'>) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="space-y-2">
      <label htmlFor={id} className={labelClassName}>{label}</label>
      <div className="relative">
        <input
          id={id}
          name={id}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          required
          minLength={minLength}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={`${inputClassName} pr-12`}
        />
        <button
          type="button"
          onClick={() => setVisible(current => !current)}
          aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'}
          aria-pressed={visible}
          className={`absolute right-0 top-0 flex h-12 w-12 items-center justify-center rounded-sm text-muted transition-colors hover:text-white ${focusRingClassName}`}
        >
          {visible ? <EyeOff className="h-[18px] w-[18px]" aria-hidden="true" /> : <Eye className="h-[18px] w-[18px]" aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
}

function AuthNotice({ notice }: { notice: AdminLoginNotice | null }) {
  if (!notice) return null;
  const isError = notice.tone === 'error';

  return (
    <p
      role={isError ? 'alert' : 'status'}
      className={`rounded-sm border bg-background px-4 py-3 text-sm font-semibold ${isError ? 'border-trading-down/35 text-trading-down' : 'border-trading-up/35 text-trading-up'}`}
    >
      {notice.text}
    </p>
  );
}

type SubmitButtonProps = {
  busy: boolean;
  label: string;
  busyLabel: string;
  Icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
};

function SubmitButton({ busy, label, busyLabel, Icon }: SubmitButtonProps) {
  return (
    <button
      type="submit"
      disabled={busy}
      aria-busy={busy}
      className={`flex h-12 w-full items-center justify-center gap-2 rounded-sm bg-primary px-6 text-lg tracking-[0.08em] text-ink transition-colors hover:bg-primary-hover active:bg-primary-hover disabled:cursor-progress disabled:opacity-70 ${displayClassName} ${focusRingClassName}`}
    >
      <span>{busy ? busyLabel : label}</span>
      {busy
        ? <Loader2 className="h-[18px] w-[18px] animate-spin motion-reduce:animate-none" aria-hidden />
        : <Icon className="h-[18px] w-[18px]" aria-hidden />}
    </button>
  );
}

export function AdminLoginScreen({ variant = 'panel', mode, notice, login, forgot, reset }: AdminLoginScreenProps) {
  const isOwner = variant === 'owner';
  const copy = isOwner ? OWNER_COPY : COPY[mode];
  const noticeElement = <AuthNotice notice={notice} />;
  const fieldPrefix = isOwner ? 'owner' : 'admin';
  // O /owner não tem o menu do site nem um segundo <main> (o layout já tem um).
  const Root = isOwner ? 'div' : 'main';
  const asideItems = isOwner ? OWNER_SECTIONS : AREAS;

  return (
    <Root className={`flex items-center justify-center bg-background px-4 py-8 sm:px-6 sm:py-12 ${isOwner ? 'min-h-screen' : 'min-h-[calc(100vh-64px)]'}`}>
      <div className="grid w-full max-w-[980px] overflow-hidden rounded-sm border border-card-border bg-dark-gray md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <section aria-labelledby="admin-login-title" className="flex flex-col gap-8 p-6 sm:p-10">
          <div className="space-y-3">
            <h1 id="admin-login-title" className={`text-4xl leading-none tracking-[0.01em] text-white sm:text-5xl ${displayClassName}`}>
              {copy.title}
            </h1>
            <p className="max-w-[46ch] text-base leading-6 text-muted">{copy.subtitle}</p>
          </div>

          {(isOwner || mode === 'login') && (
            <form onSubmit={login.onSubmit} className="space-y-4">
              <Field
                id={`${fieldPrefix}-email`}
                label="E-mail"
                type="email"
                autoComplete="email"
                placeholder="voce@email.com"
                value={login.email}
                onChange={login.onEmailChange}
              />
              <PasswordField
                id={`${fieldPrefix}-password`}
                label="Senha"
                autoComplete="current-password"
                placeholder="Digite sua senha"
                value={login.password}
                onChange={login.onPasswordChange}
              />

              {!isOwner && (
                <div className="flex flex-wrap items-center justify-between gap-x-4 text-sm">
                  <label className="flex min-h-11 items-center gap-2 text-muted">
                    <input
                      type="checkbox"
                      checked={Boolean(login.remember)}
                      onChange={(event) => login.onRememberChange?.(event.target.checked)}
                      className={`h-4 w-4 rounded-sm border-card-border bg-background accent-primary ${focusRingClassName}`}
                    />
                    <span>Lembrar meu e-mail</span>
                  </label>
                  <button type="button" onClick={login.onForgotPassword} className={linkButtonClassName}>
                    Esqueci minha senha
                  </button>
                </div>
              )}

              {noticeElement}
              <SubmitButton busy={login.submitting} label="Entrar" busyLabel="Entrando…" Icon={LogIn} />

              {!isOwner && (
              <p className="text-sm leading-6 text-muted">
                Ainda não tem conta? Ela é criada na sua primeira inscrição.{' '}
                <Link
                  href="/#eventos"
                  className={`whitespace-nowrap rounded-sm font-semibold text-primary underline underline-offset-4 transition-colors hover:text-primary-hover ${focusRingClassName}`}
                >
                  Ver eventos
                </Link>
              </p>
              )}
            </form>
          )}

          {!isOwner && mode === 'forgot' && forgot && (
            <form onSubmit={forgot.onSubmit} className="space-y-4">
              <Field
                id="forgot-password-email"
                label="E-mail cadastrado"
                type="email"
                autoComplete="email"
                placeholder="voce@email.com"
                value={forgot.email}
                onChange={forgot.onEmailChange}
              />
              {noticeElement}
              <SubmitButton busy={forgot.submitting} label="Enviar link de recuperação" busyLabel="Enviando…" Icon={Mail} />
              <button type="button" onClick={forgot.onBack} className={`${linkButtonClassName} w-full text-center text-muted hover:text-white`}>
                Voltar para o login
              </button>
            </form>
          )}

          {!isOwner && mode === 'reset' && reset && (
            <form onSubmit={reset.onSubmit} className="space-y-4">
              <PasswordField
                id="reset-password-new"
                label="Nova senha"
                autoComplete="new-password"
                placeholder="Mínimo 6 caracteres"
                minLength={6}
                value={reset.password}
                onChange={reset.onPasswordChange}
              />
              <PasswordField
                id="reset-password-confirm"
                label="Confirmar senha"
                autoComplete="new-password"
                placeholder="Repita a nova senha"
                minLength={6}
                value={reset.confirm}
                onChange={reset.onConfirmChange}
              />
              {noticeElement}
              <SubmitButton busy={reset.submitting} label="Redefinir senha" busyLabel="Redefinindo…" Icon={Lock} />
            </form>
          )}
        </section>

        <aside aria-labelledby="admin-login-areas" className="border-t border-card-border bg-background p-6 sm:p-10 md:flex md:flex-col md:justify-center md:border-l md:border-t-0">
          <h2 id="admin-login-areas" className="text-sm font-semibold text-muted">{isOwner ? 'Neste painel' : 'Depois de entrar, você vai para'}</h2>
          <ul className="mt-5 divide-y divide-card-border">
            {asideItems.map(({ id, Icon, name, description }) => (
              <li key={id} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-0.5 py-5 first:pt-0 last:pb-0">
                <span className="row-span-2 flex h-11 w-11 items-center justify-center bg-primary text-ink">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className={`text-lg leading-tight tracking-[0.05em] text-white ${displayClassName}`}>{name}</span>
                <span className="text-sm text-muted">{description}</span>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </Root>
  );
}
