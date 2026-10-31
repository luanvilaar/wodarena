'use client';

import Link from 'next/link';

import { RaceAssignmentsPanel } from '@/components/admin/RaceAssignmentsPanel';
import { RaceCoveragePanel } from '@/components/admin/RaceCoveragePanel';
import { RaceJudgesPanel } from '@/components/admin/RaceJudgesPanel';
import { RacePenaltiesPanel } from '@/components/admin/RacePenaltiesPanel';
import { RaceWavesPanel } from '@/components/admin/RaceWavesPanel';
import type { Event } from '@/types';

// Aba "Súmula Fitness Race" do evento (Story 1.95; D3, D4). Contêiner das
// seções do organizador: "Ondas" (Story 1.96, AC8), o atalho "Abrir Wall Ball"
// (Story 1.97), a cobertura ao vivo (Story 1.105, primeira seção, maquete
// telas/cobertura.html), o painel de penalidades e decisões (Story 1.98), a
// escala de judges por estação (Story 1.104) e a gestão de judges, na ordem da
// maquete telas/painel-organizador.html (judges por último), sem tocar de novo
// em admin/page.tsx.

export function RaceSheetPanel({ event }: { event: Event }) {
  return (
    <div className="space-y-6 text-white">
      {/* Atalho do organizador para a tela do árbitro do Wall Ball (Story 1.97). */}
      <Link
        href={`/judge/corrida/${encodeURIComponent(event.id)}/wall-ball`}
        className="inline-flex min-h-11 items-center rounded-md border border-white/20 px-4 text-sm font-bold hover:border-primary"
      >
        Abrir Wall Ball
      </Link>
      <RaceCoveragePanel event={event} />
      <RacePenaltiesPanel event={event} />
      <RaceWavesPanel event={event} />
      <RaceAssignmentsPanel event={event} />
      <RaceJudgesPanel event={event} />
    </div>
  );
}
