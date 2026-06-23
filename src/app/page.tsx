'use client';

import Link from 'next/link';
import React, { useState } from 'react';
import { useApp } from '@/context/AppContext';
import { EventCard } from '@/components/EventCard';
import {
  ArrowRight,
  Building,
  MapPin,
  Phone,
  Search,
  ShieldCheck,
  Trophy,
  Users
} from 'lucide-react';
import { EventStatus } from '@/types';

type LeadFormState = {
  managerName: string;
  phone: string;
  eventName: string;
  city: string;
  state: string;
  acceptedTerms: boolean;
};

const UF_OPTIONS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS',
  'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC',
  'SP', 'SE', 'TO'
];

const EMPTY_LEAD_FORM: LeadFormState = {
  managerName: '',
  phone: '',
  eventName: '',
  city: '',
  state: '',
  acceptedTerms: false
};

export default function Home() {
  const { events, athletes, registrations } = useApp();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | EventStatus>('all');
  const [leadFormOpen, setLeadFormOpen] = useState(false);
  const [leadForm, setLeadForm] = useState<LeadFormState>(EMPTY_LEAD_FORM);
  const [leadSubmitting, setLeadSubmitting] = useState(false);
  const [leadErrorMessage, setLeadErrorMessage] = useState('');
  const [leadSuccessMessage, setLeadSuccessMessage] = useState('');
  const totalDivisions = events.reduce((total, event) => total + event.divisions.length, 0);
  const platformStats = [
    { label: 'Eventos', value: events.length },
    { label: 'Atletas', value: athletes.length },
    { label: 'Categorias', value: totalDivisions },
    { label: 'Inscrições', value: registrations.length },
  ];

  const filteredEvents = events.filter((event) => {
    const matchesSearch = event.name.toLowerCase().includes(searchQuery.toLowerCase())
      || event.location.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || event.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const handleLeadFieldChange = (field: keyof LeadFormState, value: string | boolean) => {
    setLeadForm((current) => ({
      ...current,
      [field]: value
    }));
  };

  const handleLeadSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLeadErrorMessage('');
    setLeadSuccessMessage('');

    if (!leadForm.acceptedTerms) {
      setLeadErrorMessage('Voce precisa aceitar os termos e a politica de privacidade para continuar.');
      return;
    }

    try {
      setLeadSubmitting(true);

      const response = await fetch('/api/commercial-leads', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(leadForm)
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || 'Nao foi possivel registrar seu interesse agora.');
      }

      setLeadSuccessMessage(
        data.message || 'Recebemos suas informacoes e, em breve, entraremos em contato.'
      );
      setLeadForm(EMPTY_LEAD_FORM);
      setLeadFormOpen(true);
    } catch (err) {
      setLeadErrorMessage(
        err instanceof Error ? err.message : 'Nao foi possivel registrar seu interesse agora.'
      );
    } finally {
      setLeadSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <section className="relative overflow-hidden border-b border-card-border py-16 sm:py-20 lg:py-24">
        <div className="absolute inset-0 z-0 pointer-events-none lg:hidden">
          <video
            src="/hero-vertical.mp4"
            autoPlay
            loop
            muted
            playsInline
            className="h-full w-full object-cover opacity-15"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-background/50"></div>
        </div>

        <div className="absolute inset-0 z-0 pointer-events-none hidden lg:block">
          <video
            src="/hero-vertical.mp4"
            autoPlay
            loop
            muted
            playsInline
            className="h-full w-full object-cover opacity-20"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-background/65"></div>
          <div className="absolute inset-0 bg-gradient-to-r from-background via-transparent to-background/30"></div>
        </div>

        <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl space-y-8">
            <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-primary">
              <Trophy className="h-4 w-4" aria-hidden="true" /> O placar oficial da arena
            </span>
            <div className="space-y-5">
              <h1 className="max-w-4xl text-balance text-4xl font-black leading-[1.03] tracking-[-0.04em] text-white sm:text-6xl lg:text-7xl">
                COMPITA. ACOMPANHE. <span className="text-primary">DOMINE A ARENA.</span>
              </h1>
              <p className="max-w-2xl text-pretty text-base leading-7 text-muted sm:text-lg">
                Inscrições, cronogramas e leaderboards em tempo real para atletas, boxes e organizadores de Functional Fitness.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <a href="#eventos" className="flex h-12 items-center gap-2 rounded-md bg-primary px-6 text-sm font-bold text-ink transition-colors hover:bg-primary-hover active:bg-primary-hover">
                Explorar eventos <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </a>
              <button
                type="button"
                onClick={() => setLeadFormOpen(true)}
                className="flex h-12 items-center rounded-md bg-card px-6 text-sm font-bold text-white transition-colors hover:bg-elevated"
              >
                Quero utilizar o WODArena
              </button>
            </div>
            <div className="grid gap-3 pt-2 sm:grid-cols-2 xl:grid-cols-4">
              {platformStats.map((stat) => (
                <div key={stat.label} className="rounded-2xl border border-card-border bg-card/90 p-4">
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted">{stat.label}</p>
                  <p className="mt-2 text-3xl font-black tracking-[-0.04em] text-white">{stat.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="quero-utilizar-wodarena" className="border-b border-card-border bg-card/40 py-16 sm:py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
            <div className="space-y-6">
              <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-primary">
                <Building className="h-4 w-4" aria-hidden="true" /> Campanha comercial
              </span>
              <div className="space-y-4">
                <h2 className="max-w-2xl text-balance text-3xl font-black uppercase leading-tight text-white sm:text-4xl">
                  Seja um dos primeiros gestores a utilizar o WODArena.
                </h2>
                <p className="max-w-2xl text-sm leading-7 text-muted sm:text-base">
                  Cadastre seu interesse para apresentar seu evento no WODArena e conversar com nossa equipe sobre a fase promocional para os primeiros gestores.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  onClick={() => setLeadFormOpen(true)}
                  className="flex h-12 items-center gap-2 rounded-md bg-primary px-6 text-sm font-bold text-ink transition-colors hover:bg-primary-hover shadow-lg shadow-primary/10"
                >
                  Quero utilizar o WODArena <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </button>
                <p className="text-xs leading-6 text-muted max-w-xs">
                  Os primeiros eventos cadastrados poderao usar a plataforma gratuitamente durante o periodo promocional.
                </p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              {[
                {
                  title: 'Gestão Centralizada',
                  desc: 'Operação simplificada de inscrições, baterias e cronogramas do seu evento.',
                  icon: Trophy
                },
                {
                  title: 'Leaderboard em Tempo Real',
                  desc: 'Resultados e pontuações públicas atualizadas instantaneamente na arena.',
                  icon: Users
                },
                {
                  title: 'Contato Prioritário',
                  desc: 'Suporte exclusivo e contato direto com nossos engenheiros na fase promocional.',
                  icon: Phone
                },
                {
                  title: 'Parceria de Crescimento',
                  desc: 'Ajude a moldar a plataforma de acordo com as necessidades do seu box.',
                  icon: ShieldCheck
                }
              ].map((benefit) => {
                const Icon = benefit.icon;
                return (
                  <div key={benefit.title} className="rounded-2xl border border-card-border bg-card p-5 transition-colors hover:border-primary/20">
                    <Icon className="h-6 w-6 text-primary mb-3" aria-hidden="true" />
                    <h4 className="font-bold text-white text-sm uppercase tracking-wide">{benefit.title}</h4>
                    <p className="mt-2 text-xs leading-relaxed text-muted">{benefit.desc}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section id="eventos" className="mx-auto w-full max-w-7xl space-y-8 px-4 py-12 sm:px-6 lg:px-8">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Calendário oficial</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-white">Eventos em destaque</h2>
          </div>
          <p className="max-w-md text-sm leading-6 text-muted">Encontre sua próxima competição, acompanhe resultados ou garanta sua inscrição.</p>
        </div>

        <div className="flex flex-col gap-4 rounded-xl border border-card-border bg-card p-4 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap gap-1.5">
            {[
              { id: 'all', label: 'Todos' },
              { id: 'live', label: 'Ao Vivo' },
              { id: 'upcoming', label: 'Em Breve' },
              { id: 'finished', label: 'Finalizados' }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setStatusFilter(tab.id as 'all' | EventStatus)}
                className={`min-h-10 rounded-md border px-4 py-2 text-xs font-bold uppercase tracking-wider transition-colors ${
                  statusFilter === tab.id
                    ? 'border-primary bg-primary text-ink'
                    : 'border-card-border bg-dark-gray text-muted hover:border-muted hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="relative w-full md:max-w-xs">
            <label htmlFor="event-search" className="sr-only">Buscar evento ou local</label>
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
            <input
              id="event-search"
              name="event-search"
              type="text"
              placeholder="Buscar evento ou local..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-10 w-full rounded-lg border border-card-border bg-dark-gray pl-10 pr-4 text-sm text-white placeholder:text-muted focus:border-primary focus:outline-none"
            />
          </div>
        </div>

        {filteredEvents.length > 0 ? (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {filteredEvents.map((event, index) => (
              <EventCard key={event.id} event={event} priority={index === 0} />
            ))}
          </div>
        ) : (
          <div className="space-y-4 rounded-xl border border-dashed border-card-border bg-card py-20 text-center">
            <Search className="mx-auto h-12 w-12 text-muted" />
            <div className="space-y-1">
              <h4 className="text-lg font-bold uppercase tracking-wider text-white">Nenhum evento encontrado</h4>
              <p className="text-sm text-muted">Tente ajustar seus termos de busca ou mudar os filtros de status.</p>
            </div>
          </div>
        )}
      </section>

      {/* Modal de Conversão Comercial */}
      {leadFormOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center p-4" role="dialog" aria-modal="true">
          {/* Overlay de fundo */}
          <div 
            className="fixed inset-0 bg-black/85 backdrop-blur-sm transition-opacity" 
            onClick={() => {
              setLeadFormOpen(false);
              setLeadErrorMessage('');
              setLeadSuccessMessage('');
            }}
            aria-hidden="true"
          />

          {/* Container do Modal */}
          <div className="relative transform overflow-hidden rounded-2xl border border-card-border bg-card p-6 shadow-2xl transition duration-200 max-w-lg w-full z-10">
            {/* Botão de Fechar */}
            <button
              type="button"
              onClick={() => {
                setLeadFormOpen(false);
                setLeadErrorMessage('');
                setLeadSuccessMessage('');
              }}
              className="absolute right-4 top-4 text-muted hover:text-white transition-colors p-1 rounded-lg hover:bg-dark-gray/50"
              aria-label="Fechar formulário"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            <div className="border-b border-card-border pb-4 pr-6">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Captação de interesse</p>
              <h3 className="mt-2 text-xl font-bold uppercase tracking-tight text-white">
                Cadastro para gestores
              </h3>
              <p className="mt-2 text-sm leading-6 text-muted">
                Preencha seus dados para que a equipe WODArena entre em contato e apresente a plataforma.
              </p>
            </div>

            {leadSuccessMessage && (
              <div role="status" aria-live="polite" className="mt-4 rounded-xl border border-primary/25 bg-primary/10 px-4 py-3">
                <p className="text-sm font-bold text-white">Solicitação enviada com sucesso!</p>
                <p className="mt-1 text-xs leading-6 text-primary">{leadSuccessMessage}</p>
              </div>
            )}

            {leadErrorMessage && (
              <div role="alert" className="mt-4 rounded-xl border border-red-500/30 bg-red-950/20 px-4 py-3 text-xs leading-6 text-red-300">
                {leadErrorMessage}
              </div>
            )}

            {!leadSuccessMessage && (
              <form onSubmit={handleLeadSubmit} className="mt-6 space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label htmlFor="lead-manager-name" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">
                      Nome do gestor
                    </label>
                    <input
                      id="lead-manager-name"
                      type="text"
                      required
                      value={leadForm.managerName}
                      onChange={(e) => handleLeadFieldChange('managerName', e.target.value)}
                      placeholder="Ex: Carlos Roberto"
                      className="h-11 w-full rounded-lg border border-card-border bg-dark-gray px-4 text-sm text-white placeholder:text-muted focus:border-primary focus:outline-none"
                    />
                  </div>

                  <div>
                    <label htmlFor="lead-phone" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">
                      Telefone
                    </label>
                    <div className="relative">
                      <PhoneInputIcon />
                      <input
                        id="lead-phone"
                        type="tel"
                        required
                        value={leadForm.phone}
                        onChange={(e) => handleLeadFieldChange('phone', e.target.value)}
                        placeholder="(00) 00000-0000"
                        className="h-11 w-full rounded-lg border border-card-border bg-dark-gray pl-10 pr-4 text-sm text-white placeholder:text-muted focus:border-primary focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="lead-event-name" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">
                      Nome do evento
                    </label>
                    <input
                      id="lead-event-name"
                      type="text"
                      required
                      value={leadForm.eventName}
                      onChange={(e) => handleLeadFieldChange('eventName', e.target.value)}
                      placeholder="Ex: Arena Summer Challenge"
                      className="h-11 w-full rounded-lg border border-card-border bg-dark-gray px-4 text-sm text-white placeholder:text-muted focus:border-primary focus:outline-none"
                    />
                  </div>

                  <div>
                    <label htmlFor="lead-city" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">
                      Cidade
                    </label>
                    <div className="relative">
                      <MapPin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
                      <input
                        id="lead-city"
                        type="text"
                        required
                        value={leadForm.city}
                        onChange={(e) => handleLeadFieldChange('city', e.target.value)}
                        placeholder="Ex: Fortaleza"
                        className="h-11 w-full rounded-lg border border-card-border bg-dark-gray pl-10 pr-4 text-sm text-white placeholder:text-muted focus:border-primary focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="lead-state" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">
                      Estado (UF)
                    </label>
                    <select
                      id="lead-state"
                      required
                      value={leadForm.state}
                      onChange={(e) => handleLeadFieldChange('state', e.target.value)}
                      className="h-11 w-full rounded-lg border border-card-border bg-dark-gray px-4 text-sm font-semibold text-white focus:border-primary focus:outline-none"
                    >
                      <option value="">Selecione</option>
                      {UF_OPTIONS.map((uf) => (
                        <option key={uf} value={uf}>{uf}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="rounded-xl border border-card-border bg-dark-gray/20 p-4 text-xs leading-6 text-muted">
                  <div className="flex items-start gap-2">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    <p>
                      Usaremos seus dados para registrar seu interesse no WODArena e permitir que nossa equipe entre em contato sobre a plataforma. Leia nossos{' '}
                      <Link href="/termos" target="_blank" className="font-bold text-white underline transition-colors hover:text-primary">
                        Termos de Uso
                      </Link>{' '}
                      e a{' '}
                      <Link href="/termos#privacidade" target="_blank" className="font-bold text-white underline transition-colors hover:text-primary">
                        Politica de Privacidade
                      </Link>
                      .
                    </p>
                  </div>
                </div>

                <label className="flex items-start gap-3 rounded-xl border border-card-border bg-dark-gray/20 p-4">
                  <input
                    type="checkbox"
                    checked={leadForm.acceptedTerms}
                    onChange={(e) => handleLeadFieldChange('acceptedTerms', e.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-card-border bg-dark-gray text-primary focus:ring-1 focus:ring-primary"
                  />
                  <span className="text-xs leading-6 text-muted">
                    Li e concordo com os Termos de Uso e com a Politica de Privacidade da WODArena, e autorizo o contato da equipe comercial sobre esta solicitacao.
                  </span>
                </label>

                <button
                  type="submit"
                  disabled={leadSubmitting || !leadForm.acceptedTerms}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-md bg-primary px-6 text-sm font-bold text-ink transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-primary/50 disabled:text-ink/70"
                >
                  {leadSubmitting ? (
                    <>
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink border-t-transparent"></span>
                      Enviando solicitação...
                    </>
                  ) : (
                    <>
                      Quero utilizar o WODArena <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </>
                  )}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PhoneInputIcon() {
  return <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />;
}
