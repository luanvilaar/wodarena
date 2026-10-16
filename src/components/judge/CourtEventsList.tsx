'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, MapPin } from 'lucide-react';

import { CourtShell } from '@/components/judge/CourtShell';
import { useApp } from '@/context/AppContext';

// Lista de eventos da quadra (Story 1.49): os eventos presenciais em que a
// pessoa pode arbitrar (judge atribuído, gestor dono ou owner).

type CourtEvent = { id: string; name: string; date: string; location: string };

export function CourtEventsList() {
  const { currentUser } = useApp();
  const [events, setEvents] = useState<CourtEvent[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!currentUser) return;
    let active = true;
    fetch('/api/sheets?view=events')
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Erro ao carregar os eventos.');
        if (active) setEvents(data.events || []);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Erro ao carregar os eventos.');
      });
    return () => {
      active = false;
    };
  }, [currentUser]);

  return (
    <CourtShell title="Eventos" subtitle={currentUser?.name} back={{ href: '/judge', label: 'Voltar ao painel do judge' }}>
      {error ? (
        <p role="alert" className="rounded-md border border-trading-down bg-trading-down/10 px-4 py-3 text-sm font-semibold">{error}</p>
      ) : events === null ? (
        <p role="status" className="py-10 text-center text-sm font-semibold text-muted">Carregando eventos…</p>
      ) : events.length === 0 ? (
        <div className="space-y-2 rounded-xl border border-card-border bg-card px-4 py-8 text-center">
          <p className="font-bold">Nenhum evento presencial para arbitrar.</p>
          <p className="text-sm text-muted">Peça ao gestor para atribuir você ao evento na aba Súmulas e Judges.</p>
        </div>
      ) : (
        <ul className="space-y-3" aria-label="Eventos para arbitrar">
          {events.map((event) => (
            <li key={event.id}>
              <Link
                href={`/judge/quadra/${encodeURIComponent(event.id)}`}
                className="flex min-h-16 items-center justify-between gap-3 rounded-xl border border-card-border bg-card px-4 py-3 hover:border-primary"
              >
                <span className="min-w-0">
                  <span className="block truncate text-base font-extrabold">{event.name}</span>
                  <span className="flex items-center gap-1 truncate text-xs font-semibold text-muted">
                    {event.date}
                    {event.location && (
                      <>
                        <MapPin className="ml-1 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        {event.location}
                      </>
                    )}
                  </span>
                </span>
                <ChevronRight className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </CourtShell>
  );
}
