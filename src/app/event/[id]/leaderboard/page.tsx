'use client';

import React, { use } from 'react';
import { useApp } from '@/context/AppContext';
import { Leaderboard } from '@/components/Leaderboard';
import { Trophy, ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function EventLeaderboardPage({ params }: PageProps) {
  const resolvedParams = use(params);
  const eventId = resolvedParams.id;

  const { events } = useApp();

  // Procurar evento correspondente
  const event = events.find(e => e.id === eventId);

  if (!event) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center space-y-4 text-white">
        <Trophy className="h-16 w-16 text-muted animate-bounce" />
        <h2 className="text-xl font-bold uppercase tracking-wider">Evento não encontrado</h2>
        <Link href="/" className="text-sm text-primary hover:underline uppercase font-extrabold tracking-widest">
          Voltar para Home
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      {/* Cabeçalho do placar */}
      <header className="border-b border-card-border bg-dark-gray px-4 py-4 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center justify-center transition-transform duration-300 hover:scale-105 cursor-pointer" aria-label="WODArena - Voltar para a Home">
              <Image
                src="/icon.svg"
                alt="WODArena"
                width={40}
                height={40}
                className="object-contain"
                priority
              />
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-black uppercase tracking-wider text-primary">Leaderboard</span>
                <span className="text-[9px] font-bold uppercase tracking-wider text-muted-soft">| Resultados oficiais</span>
              </div>
              <h1 className="text-base font-black uppercase tracking-tight text-white">{event.name}</h1>
            </div>
          </div>
          <div className="flex items-center">
            <Link 
              href={`/event/${event.id}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-card-border bg-background px-3.5 py-2 text-xs font-bold uppercase tracking-wider text-muted hover:text-white hover:border-muted-soft transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
              <span>Voltar ao Evento</span>
            </Link>
          </div>
        </div>
      </header>

      {/* Área principal: a própria matriz controla sua borda e rolagem horizontal. */}
      <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <Leaderboard event={event} />
      </main>

      {/* Rodapé Minimalista */}
      <footer className="border-t border-card-border bg-dark-gray py-4 text-center">
        <p className="text-[10px] text-muted-soft uppercase font-bold tracking-widest">
          © {new Date().getFullYear()} WODArena - Plataforma Oficial de Resultados
        </p>
      </footer>
    </div>
  );
}
