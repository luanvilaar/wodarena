'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Flag } from 'lucide-react';

import { CourtShell } from '@/components/judge/CourtShell';
import { useApp } from '@/context/AppContext';

// Tela do evento Fitness Race para a arbitragem (Story 1.96; sem a largada
// desde a Story 1.110). A largada das ondas é só do organizador, no painel do
// evento (aba Súmula Fitness Race, seção Ondas): aqui ficam os atalhos do
// árbitro para o Wall Ball (Story 1.97) e para as outras estações (Story
// 1.102), que as telas de cartão, estação e Wall Ball usam como "Voltar ao
// evento". O nome do evento vem da leitura das ondas; o servidor confere o
// acesso de novo.

export function RaceEventHubScreen({ eventId }: { eventId: string }) {
  const { currentUser } = useApp();
  const [eventName, setEventName] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!currentUser) return;
    let active = true;
    fetch(`/api/race-sheets?view=waves&eventId=${encodeURIComponent(eventId)}`)
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Erro ao carregar o evento.');
        if (active) setEventName(data.event?.name || '');
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Erro ao carregar o evento.');
      });
    return () => {
      active = false;
    };
  }, [currentUser, eventId]);

  const listHref = `/judge/corrida/${encodeURIComponent(eventId)}`;

  return (
    <CourtShell
      eyebrow="Fitness Race · Arbitragem"
      title={eventName || 'Evento'}
      subtitle="Fitness Race"
      back={{ href: '/judge/corrida', label: 'Voltar aos eventos' }}
    >
      {error ? (
        <p role="alert" className="rounded-md border border-trading-down bg-trading-down/10 px-4 py-3 text-sm font-semibold">{error}</p>
      ) : (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl border border-card-border bg-card px-4 py-4">
            <Flag className="mt-0.5 h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
            <div className="space-y-1">
              <p className="font-bold">A largada é feita pelo organizador.</p>
              <p className="text-sm text-muted">Quando a onda largar, as corridas aparecem nas estações. Escolha onde você está.</p>
            </div>
          </div>
          {/* Árbitro do Wall Ball (Story 1.97) e das outras estações (Story 1.102). */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Link href={`${listHref}/wall-ball`} className="flex min-h-16 items-center justify-center rounded-xl border-2 border-card-border bg-card text-base font-extrabold hover:border-primary">
              Abrir Wall Ball
            </Link>
            <Link href={`${listHref}/estacao`} className="flex min-h-16 items-center justify-center rounded-xl border-2 border-card-border bg-card text-base font-extrabold hover:border-primary">
              Abrir estações
            </Link>
          </div>
        </div>
      )}
    </CourtShell>
  );
}
