'use client';

import React, { useState } from 'react';
import { useApp } from '@/context/AppContext';
import { EventCard } from '@/components/EventCard';
import { ArrowRight, CalendarDays, Search, TicketCheck, Trophy, Users } from 'lucide-react';
import { EventStatus } from '@/types';

export default function Home() {
  const { events, athletes, registrations } = useApp();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | EventStatus>('all');

  // Filtrar eventos por busca e por status
  const filteredEvents = events.filter((event) => {
    const matchesSearch = event.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          event.location.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || event.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // Contabilizar total de divisões de forma dinâmica
  const totalDivisions = events.reduce((sum, event) => sum + (event.divisions?.length || 0), 0);

  return (
    <div className="min-h-screen bg-background">
      <section className="relative overflow-hidden border-b border-card-border py-16 sm:py-20 lg:py-24">
        {/* Vídeo de fundo em telas Mobile/Tablet */}
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

        <div className="relative z-10 mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-[65%_35%] lg:items-center lg:px-8">
          {/* Coluna da Esquerda: Textos, Ações e Stats */}
          <div className="space-y-8">
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
              <a href="/admin" className="flex h-12 items-center rounded-md bg-card px-6 text-sm font-bold text-white transition-colors hover:bg-elevated">
                Organizar competição
              </a>
            </div>

            {/* Stats em Grid Horizontal no Desktop / Grid 2x2 no Mobile */}
            <div className="grid grid-cols-2 gap-4 pt-4 sm:grid-cols-4">
              {[
                { value: events.length, label: 'Eventos', icon: Trophy },
                { value: athletes.length, label: 'Atletas', icon: Users },
                { value: totalDivisions, label: 'Divisões', icon: CalendarDays },
                { value: registrations.length, label: 'Inscrições', icon: TicketCheck }
              ].map((stat) => {
                const Icon = stat.icon;
                return (
                  <div key={stat.label} className="rounded-xl border border-card-border bg-card p-4 transition-colors hover:border-primary/20">
                    <Icon className="mb-3 h-4 w-4 text-primary" aria-hidden="true" />
                    <p className="font-number text-xl font-bold text-primary">{stat.value}</p>
                    <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">{stat.label}</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Coluna da Direita: Vídeo Horizontal Fundido com o Background (Somente Desktop) */}
          <div className="hidden lg:flex lg:justify-end lg:items-center pr-4">
            <div className="relative w-full aspect-[16/9] overflow-hidden rounded-2xl">
              {/* Vídeo Widescreen Horizontal */}
              <video 
                src="/hero-vertical.mp4" 
                autoPlay 
                loop 
                muted 
                playsInline 
                className="w-full h-full object-cover"
              />
              
              {/* Overlays de gradiente para fusão perfeita com o fundo escuro do site */}
              {/* Borda Esquerda (Suavização com a coluna de texto) */}
              <div className="absolute inset-y-0 left-0 w-1/4 bg-gradient-to-r from-background to-transparent pointer-events-none"></div>
              {/* Borda Direita */}
              <div className="absolute inset-y-0 right-0 w-1/12 bg-gradient-to-l from-background to-transparent pointer-events-none"></div>
              {/* Topo */}
              <div className="absolute inset-x-0 top-0 h-1/6 bg-gradient-to-b from-background to-transparent pointer-events-none"></div>
              {/* Base */}
              <div className="absolute inset-x-0 bottom-0 h-1/6 bg-gradient-to-t from-background to-transparent pointer-events-none"></div>
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
            <Search className="h-12 w-12 text-muted mx-auto" />
            <div className="space-y-1">
              <h4 className="text-lg font-bold text-white uppercase tracking-wider">Nenhum evento encontrado</h4>
              <p className="text-sm text-muted">Tente ajustar seus termos de busca ou mudar os filtros de status.</p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
