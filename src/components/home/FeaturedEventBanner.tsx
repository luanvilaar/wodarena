'use client';

import React, { useState, useEffect } from 'react';
import { useApp } from '@/context/AppContext';
import { RegisterModal } from '@/components/RegisterModal';
import { MapPin, ArrowRight } from 'lucide-react';
import Link from 'next/link';

type CountdownState = {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
};

export function FeaturedEventBanner() {
  const { events, registrations } = useApp();
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);
  const [countdown, setCountdown] = useState<CountdownState>({ days: 0, hours: 0, minutes: 0, seconds: 0 });

  // Encontra o primeiro evento "live" ou "upcoming"
  const featuredEvent = events.find(e => e.status === 'live' || e.status === 'upcoming');

  useEffect(() => {
    if (!featuredEvent) return;

    const calculateTimeLeft = () => {
      // Divide a string de data (ex: "15 JUL 2026") para criar um objeto Date correto
      let eventDate = new Date(featuredEvent.date);
      if (isNaN(eventDate.getTime())) {
        // Fallback robusto se a data for textual
        // Ex: "15 JUL 2026"
        const parts = featuredEvent.date.split(' ');
        if (parts.length === 3) {
          const day = parseInt(parts[0], 10);
          const monthsMap: Record<string, number> = {
            'JAN': 0, 'FEB': 1, 'MAR': 2, 'APR': 3, 'MAY': 4, 'JUN': 5,
            'JUL': 6, 'AUG': 7, 'SEP': 8, 'OCT': 9, 'NOV': 10, 'DEC': 11,
            'AGO': 7, 'SET': 8, 'OUT': 9, 'DEZ': 11
          };
          const month = monthsMap[parts[1].toUpperCase()] ?? 0;
          const year = parseInt(parts[2], 10);
          eventDate = new Date(year, month, day, 8, 0, 0);
        }
      }

      const difference = eventDate.getTime() - Date.now();
      
      if (difference <= 0) {
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

  if (!featuredEvent) return null;

  // Estatísticas Reais baseadas no AppContext
  const eventRegistrations = registrations.filter(r => r.eventId === featuredEvent.id);
  const totalRegistrationsCount = eventRegistrations.length;
  
  // Limites e vagas
  const activeDivisions = featuredEvent.divisions?.filter(d => d.isActive) ?? [];
  const totalSlotsLimit = activeDivisions.reduce((sum, div) => sum + (div.slotsLimit || 0), 0) || featuredEvent.ticketSlots || 100;
  
  const fillPercentage = Math.min(Math.round((totalRegistrationsCount / totalSlotsLimit) * 100), 100);

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
      <section 
        className="relative overflow-hidden min-h-[500px] sm:min-h-[600px] border-b border-card-border bg-cover bg-center flex flex-col justify-end"
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
          <div className="max-w-3xl space-y-6">
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

            {/* Painel de Countdown e Stats em Glassmorphism */}
            <div className="grid sm:grid-cols-[auto_1px_auto] items-stretch gap-4 p-4 sm:p-5 rounded-2xl border border-card-border bg-[#0b0e11]/65 backdrop-blur-md">
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

              {/* Separador */}
              <div className="hidden sm:block w-[1px] bg-card-border my-1" />

              {/* Stats */}
              <div className="flex justify-between sm:gap-6 items-center">
                <div className="flex flex-col items-center text-center">
                  <span className="text-lg sm:text-xl font-black text-trading-up leading-none font-number">
                    {totalRegistrationsCount}
                  </span>
                  <span className="text-[9px] font-bold uppercase tracking-widest text-muted mt-1 font-mono">Inscritos</span>
                </div>
                <div className="flex flex-col items-center text-center">
                  <span className="text-lg sm:text-xl font-black text-primary leading-none font-number">
                    {fillPercentage}%
                  </span>
                  <span className="text-[9px] font-bold uppercase tracking-widest text-muted mt-1 font-mono">Preenchido</span>
                </div>
                <div className="flex flex-col items-center text-center">
                  <span className="text-lg sm:text-xl font-black text-white leading-none font-number">
                    {activeDivisions.length}
                  </span>
                  <span className="text-[9px] font-bold uppercase tracking-widest text-muted mt-1 font-mono">Categorias</span>
                </div>
              </div>
            </div>

            {/* Barra de Progresso */}
            <div className="w-full h-[3px] bg-card-border/60 rounded-full overflow-hidden">
              <div className="h-full bg-primary transition-all duration-500" style={{ width: `${fillPercentage}%` }} />
            </div>

            {/* Ações */}
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
