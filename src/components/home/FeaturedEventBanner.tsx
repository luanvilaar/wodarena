'use client';

import React, { useState, useEffect } from 'react';
import { useApp } from '@/context/AppContext';
import { RegisterModal } from '@/components/RegisterModal';
import { MapPin, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { getEventStatus, parseEventDate } from '@/lib/eventStatus';

type CountdownState = {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
};

export function FeaturedEventBanner({ openLeadModal }: { openLeadModal: () => void }) {
  const { events } = useApp();
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);
  const [countdown, setCountdown] = useState<CountdownState>({ days: 0, hours: 0, minutes: 0, seconds: 0 });

  const eligibleEvents = events.filter((event) => (
    (event.status === 'live' || event.status === 'upcoming')
    && getEventStatus(event) !== 'finished'
  ));
  const featuredEvent = eligibleEvents.find((event) => event.isFeatured) ?? eligibleEvents[0];

  useEffect(() => {
    if (!featuredEvent) return;

    const calculateTimeLeft = () => {
      const eventDate = parseEventDate(featuredEvent.date);
      if (!eventDate) return { days: 0, hours: 0, minutes: 0, seconds: 0 };
      const difference = eventDate.getTime() - Date.now();
      
      if (isNaN(difference) || difference <= 0) {
        return { days: 0, hours: 0, minutes: 0, seconds: 0 };
      }

      return {
        days: Math.floor(difference / (1000 * 60 * 60 * 24)),
        hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
        minutes: Math.floor((difference / 1000 / 60) % 60),
        seconds: Math.floor((difference / 1000) % 60)
      };
    };

    const timer = setInterval(() => {
      setCountdown(calculateTimeLeft());
    }, 1000);

    const firstTick = setTimeout(() => {
      setCountdown(calculateTimeLeft());
    }, 0);

    return () => {
      clearInterval(timer);
      clearTimeout(firstTick);
    };
  }, [featuredEvent]);

  if (!featuredEvent) {
    return (
      <section 
        className="relative overflow-hidden min-h-[460px] sm:min-h-[600px] border-b border-card-border bg-cover bg-center flex flex-col justify-end"
        style={{ backgroundImage: `url('/banner_compor.png')` }}
      >
        {/* Máscara de gradientes */}
        <div className="absolute inset-0 z-0 pointer-events-none"
          style={{
            background: `
              linear-gradient(180deg, 
                rgba(11, 14, 17, 0.18) 0%, 
                rgba(11, 14, 17, 0.0) 28%, 
                rgba(11, 14, 17, 0.72) 62%, 
                rgba(11, 14, 17, 0.97) 100%
              ),
              linear-gradient(90deg, 
                rgba(11, 14, 17, 0.55) 0%, 
                rgba(11, 14, 17, 0.0) 52%
              )
            `
          }}
        />

        <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 w-full pb-12 sm:pb-16 flex flex-col items-center text-center">
          <div className="max-w-2xl space-y-6">
            <span className="inline-flex text-[10px] font-bold uppercase tracking-wider text-primary">Plataforma WODArena</span>
            <h2 className="text-3xl font-black uppercase leading-[0.9] tracking-[-0.06em] text-white sm:text-6xl">
              CRIE E GERENCIE SEU <span className="text-primary">EVENTO</span>
            </h2>
            <p className="text-sm text-muted leading-relaxed max-w-lg mx-auto">
              Seja um dos primeiros boxes e organizadores a utilizar a plataforma mais moderna de Functional Fitness e Fitness Racing. Gerencie inscrições, scores e leaderboards ao vivo.
            </p>
            <button 
              onClick={openLeadModal}
              className="inline-flex h-12 items-center gap-2 rounded-md bg-primary px-6 text-sm font-black uppercase text-ink transition-colors hover:bg-primary-hover active:bg-primary-hover shadow-lg shadow-primary/15"
            >
              Quero utilizar o WODArena
            </button>
          </div>
        </div>
      </section>
    );
  }

  // Categorias ativas
  const activeDivisions = featuredEvent.divisions?.filter(d => d.isActive) ?? [];

  // Formata o subtítulo das divisões (ex: "Individual + Duplas")
  const hasIndividual = activeDivisions.some(d => d.type === 'individual');
  const hasTeams = activeDivisions.some(d => d.type !== 'individual');
  const divisionsSummary = [
    hasIndividual ? 'Individual' : '',
    hasTeams ? 'Duplas & Equipes' : ''
  ].filter(Boolean).join(' + ') || 'Todas as Categorias';

  // Formatador padronizado de número para countdown
  const formatNum = (num: number) => String(num).padStart(2, '0');

  // Separar nome do evento para dar cor amarela ao último termo
  const nameParts = featuredEvent.name.split(' ');
  const nameMain = nameParts.slice(0, -1).join(' ');
  const nameHighlight = nameParts.slice(-1).join('');

  return (
    <>
      {/* Banner Versão Mobile */}
      <section 
        className="md:hidden relative overflow-hidden min-h-[480px] border-b border-card-border bg-cover bg-center flex flex-col justify-end"
        style={{ backgroundImage: `url(${featuredEvent.bannerUrl || '/banner_compor.png'})` }}
      >
        {/* Máscara de gradientes reforçada para Mobile */}
        <div className="absolute inset-0 z-0 pointer-events-none"
          style={{
            background: `
              linear-gradient(180deg, 
                rgba(11, 14, 17, 0.25) 0%, 
                rgba(11, 14, 17, 0.1) 25%, 
                rgba(11, 14, 17, 0.8) 60%, 
                rgba(11, 14, 17, 0.98) 100%
              )
            `
          }}
        />

        <div className="relative z-10 w-full px-4 pt-16 pb-8 flex flex-col justify-end">
          <div className="space-y-4">
            
            {/* Status e badges */}
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className="inline-flex items-center gap-1 rounded-full border border-trading-up/30 bg-trading-up/15 px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-trading-up backdrop-blur-md">
                <span className="h-1.5 w-1.5 rounded-full bg-trading-up animate-pulse" />
                Inscrições abertas
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/12 px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary backdrop-blur-md">
                {featuredEvent.eventType === 'fitness_racing' ? 'Fitness Racing' : 'Functional Fitness'}
              </span>
            </div>

            {/* Localização */}
            <div className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-muted/90 bg-[#0b0e11]/50 backdrop-blur-sm border border-card-border/30 rounded-full px-2.5 py-0.5 w-fit">
              <MapPin className="h-3 w-3 text-primary" />
              <span>{featuredEvent.city || featuredEvent.location}, {featuredEvent.state || 'BR'}</span>
            </div>

            {/* Título do Evento */}
            <h2 className="text-3xl font-black uppercase leading-[1.0] tracking-[-0.04em] text-white">
              {nameMain}{' '}
              <span className="text-primary">{nameHighlight}</span>
            </h2>

            {/* Metadados adicionais: data e divisões */}
            <div className="flex flex-wrap items-center text-[11px] font-bold text-white/70 gap-1.5">
              <span>{featuredEvent.date}</span>
              <span className="h-1 w-1 rounded-full bg-white/30" />
              <span>{divisionsSummary}</span>
            </div>

            {/* Countdown Compacto */}
            <div className="flex items-center gap-3 py-1">
              <span className="text-[10px] font-black uppercase tracking-widest text-muted">Restam:</span>
              <div className="flex gap-2 items-center">
                <div className="flex items-baseline gap-0.5 rounded-md bg-[#0b0e11]/60 border border-card-border/30 px-2 py-0.5">
                  <span className="text-sm font-black text-white font-number">{formatNum(countdown.days)}</span>
                  <span className="text-[7px] font-bold uppercase text-muted font-mono">d</span>
                </div>
                <span className="text-white/40 font-bold">:</span>
                <div className="flex items-baseline gap-0.5 rounded-md bg-[#0b0e11]/60 border border-card-border/30 px-2 py-0.5">
                  <span className="text-sm font-black text-white font-number">{formatNum(countdown.hours)}</span>
                  <span className="text-[7px] font-bold uppercase text-muted font-mono">h</span>
                </div>
                <span className="text-white/40 font-bold">:</span>
                <div className="flex items-baseline gap-0.5 rounded-md bg-[#0b0e11]/60 border border-card-border/30 px-2 py-0.5">
                  <span className="text-sm font-black text-white font-number">{formatNum(countdown.minutes)}</span>
                  <span className="text-[7px] font-bold uppercase text-muted font-mono">m</span>
                </div>
                <span className="text-white/40 font-bold">:</span>
                <div className="flex items-baseline gap-0.5 rounded-md bg-[#0b0e11]/60 border border-card-border/30 px-2 py-0.5">
                  <span className="text-sm font-black text-white font-number">{formatNum(countdown.seconds)}</span>
                  <span className="text-[7px] font-bold uppercase text-muted font-mono">s</span>
                </div>
              </div>
            </div>

            {/* Botões de Ação */}
            <div className="flex flex-col gap-2.5 pt-2">
              <button 
                onClick={() => setIsRegisterOpen(true)}
                className="w-full flex h-12 items-center justify-center gap-2 rounded-md bg-primary px-6 text-sm font-black uppercase text-ink transition-colors hover:bg-primary-hover active:bg-primary-hover shadow-lg shadow-primary/10"
              >
                Inscreva-se agora
                <ArrowRight className="h-4 w-4" />
              </button>
              <Link 
                href={`/event/${featuredEvent.id}`}
                className="w-full flex h-12 items-center justify-center rounded-md border border-card-border bg-card/75 hover:bg-elevated/75 px-6 text-sm font-bold text-white transition-colors backdrop-blur-md"
              >
                Ver evento completo
              </Link>
            </div>

          </div>
        </div>
      </section>

      {/* Banner Versão Desktop */}
      <section 
        className="hidden md:flex relative overflow-hidden min-h-[600px] border-b border-card-border bg-cover bg-center flex-col justify-end"
        style={{ backgroundImage: `url(${featuredEvent.bannerUrl || '/banner_compor.png'})` }}
      >
        {/* Máscara de gradientes */}
        <div className="absolute inset-0 z-0 pointer-events-none"
          style={{
            background: `
              linear-gradient(180deg, 
                rgba(11, 14, 17, 0.18) 0%, 
                rgba(11, 14, 17, 0.0) 28%, 
                rgba(11, 14, 17, 0.72) 62%, 
                rgba(11, 14, 17, 0.97) 100%
              ),
              linear-gradient(90deg, 
                rgba(11, 14, 17, 0.55) 0%, 
                rgba(11, 14, 17, 0.0) 52%
              )
            `
          }}
        />

        <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 w-full pb-12 sm:pb-16">
          <div className="grid gap-8 lg:grid-cols-[1.25fr_0.75fr] lg:items-end w-full">
            {/* Lado Esquerdo: Evento em Destaque */}
            <div className="space-y-6">
              <div className="inline-flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-trading-up shadow-[0_0_8px_rgba(14,203,129,0.7)] animate-pulse" />
                <span className="text-xs font-black uppercase tracking-[0.18em] text-trading-up">
                  Evento em destaque
                </span>
              </div>

              <div className="flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-trading-up/30 bg-trading-up/15 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-trading-up backdrop-blur-md">
                  <span className="h-1.5 w-1.5 rounded-full bg-trading-up animate-pulse" />
                  Inscrições abertas
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/12 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-primary backdrop-blur-md">
                  {featuredEvent.eventType === 'fitness_racing' ? 'Fitness Racing' : 'Functional Fitness'}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-card-border bg-dark-gray/70 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-muted backdrop-blur-md">
                  <MapPin className="h-3 w-3" />
                  {featuredEvent.city || featuredEvent.location}, {featuredEvent.state || 'BR'}
                </span>
              </div>

              <h2 className="text-4xl font-black uppercase leading-[0.9] tracking-[-0.06em] text-white sm:text-6xl lg:text-7xl">
                {nameMain}{' '}
                <span className="text-primary">{nameHighlight}</span>
              </h2>

              <div className="flex flex-wrap items-center text-sm font-bold text-white/70 gap-2 sm:gap-4">
                <span>{featuredEvent.date}</span>
                <span className="h-1.5 w-1.5 rounded-full bg-white/30 hidden sm:inline" />
                <span>{featuredEvent.location}</span>
                <span className="h-1.5 w-1.5 rounded-full bg-white/30 hidden sm:inline" />
                <span>{divisionsSummary}</span>
              </div>

              {/* Painel de Countdown em Glassmorphism */}
              <div className="inline-flex gap-4 sm:gap-6 items-center p-4 sm:p-5 rounded-2xl border border-card-border bg-[#0b0e11]/65 backdrop-blur-md w-fit">
                {/* Countdown */}
                <div className="flex gap-4 sm:gap-6 justify-between sm:justify-start items-center">
                  <div className="flex flex-col items-center">
                    <span className="text-2xl sm:text-3xl font-black text-white leading-none tracking-tight font-number">
                      {formatNum(countdown.days)}
                    </span>
                    <span className="text-[9px] font-bold uppercase tracking-widest text-muted mt-1 font-mono">Dias</span>
                  </div>
                  <div className="flex flex-col items-center">
                    <span className="text-2xl sm:text-3xl font-black text-white leading-none tracking-tight font-number">
                      {formatNum(countdown.hours)}
                    </span>
                    <span className="text-[9px] font-bold uppercase tracking-widest text-muted mt-1 font-mono">Horas</span>
                  </div>
                  <div className="flex flex-col items-center">
                    <span className="text-2xl sm:text-3xl font-black text-white leading-none tracking-tight font-number">
                      {formatNum(countdown.minutes)}
                    </span>
                    <span className="text-[9px] font-bold uppercase tracking-widest text-muted mt-1 font-mono">Minutos</span>
                  </div>
                  <div className="flex flex-col items-center">
                    <span className="text-2xl sm:text-3xl font-black text-white leading-none tracking-tight font-number">
                      {formatNum(countdown.seconds)}
                    </span>
                    <span className="text-[9px] font-bold uppercase tracking-widest text-muted mt-1 font-mono">Segundos</span>
                  </div>
                </div>
              </div>

              {/* Ações do Evento */}
              <div className="flex flex-wrap gap-3">
                <button 
                  onClick={() => setIsRegisterOpen(true)}
                  className="inline-flex h-12 items-center gap-2 rounded-md bg-primary px-6 text-sm font-black uppercase text-ink transition-colors hover:bg-primary-hover active:bg-primary-hover"
                >
                  Inscreva-se agora
                  <ArrowRight className="h-4 w-4" />
                </button>
                <Link 
                  href={`/event/${featuredEvent.id}`}
                  className="inline-flex h-12 items-center rounded-md border border-card-border bg-card/75 hover:bg-elevated/75 px-6 text-sm font-bold text-white transition-colors backdrop-blur-md"
                >
                  Ver evento completo
                </Link>
              </div>
            </div>

            {/* Lado Direito: Card de Captação Comercial (Dividindo Espaço) */}
            <div className="rounded-2xl border border-card-border bg-[#0b0e11]/80 p-6 backdrop-blur-md space-y-4 lg:mb-1">
              <div className="space-y-1.5">
                <span className="inline-flex text-[9px] font-black uppercase tracking-[0.15em] text-primary">Plataforma WODArena</span>
                <h3 className="text-lg font-black uppercase text-white leading-tight">Organize seu evento</h3>
              </div>
              <p className="text-xs text-muted leading-relaxed">
                Gerencie inscrições, crie cronogramas de baterias inteligentes, publique resultados e ofereça leaderboards em tempo real.
              </p>
              <button 
                onClick={openLeadModal}
                className="w-full flex h-11 items-center justify-center gap-2 rounded-md bg-primary px-4 text-xs font-bold uppercase text-ink transition-colors hover:bg-primary-hover active:bg-primary-hover"
              >
                Quero utilizar o WODArena
              </button>
            </div>
          </div>
        </div>
      </section>

      <RegisterModal 
        event={featuredEvent} 
        isOpen={isRegisterOpen} 
        onClose={() => setIsRegisterOpen(false)} 
      />
    </>
  );
}
