import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

import { describeWaveStart, type RaceWave } from '@/lib/raceWaves';

// Lista das ondas da tela de largada (Story 1.96, AC1; maquete
// telas/largada.html): horário previsto, título, categorias, atletas e o
// estado ("Aguardando largada" ou "Largou às HH:MM:SS"). A próxima onda a
// largar ganha borda grossa; a guardada no aparelho (sem conexão, AC6) avisa.
// Linhas de 68 px para o polegar (AC9).

type RaceWaveListProps = {
  waves: readonly RaceWave[];
  queuedIds: readonly string[];
  nextId: string | null;
  timeZone?: string;
  hrefFor: (heatId: string) => string;
};

export function RaceWaveList({ waves, queuedIds, nextId, timeZone, hrefFor }: RaceWaveListProps) {
  return (
    <ul className="space-y-3" aria-label="Ondas do evento">
      {waves.map((item) => {
        const isQueued = queuedIds.includes(item.id) && !item.startedAt;
        const isNext = item.id === nextId && !isQueued;
        return (
          <li key={item.id}>
            <Link
              href={hrefFor(item.id)}
              className={`flex min-h-[68px] items-center justify-between gap-3 rounded-xl bg-card px-4 py-3 hover:border-primary ${isNext ? 'border-2 border-primary' : 'border border-card-border'}`}
            >
              <span className="min-w-0">
                <span className="block truncate text-base font-extrabold">
                  {isNext && <span className="mr-2 text-[10px] font-bold uppercase tracking-widest text-primary">Próxima</span>}
                  {item.title}
                </span>
                <span className="block text-xs font-semibold text-muted">
                  <span className="tabular-nums">{item.time || '—'}</span> previsto
                  {item.categories.length > 0 && ` · ${item.categories.join(' · ')}`}
                  {` · ${item.athletes.length} ${item.athletes.length === 1 ? 'atleta' : 'atletas'}`}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <span className={`rounded-full border px-2 py-1 text-[11px] font-bold tabular-nums ${item.startedAt ? 'border-trading-up/60 text-trading-up' : isQueued ? 'border-trading-down text-trading-down' : 'border-card-border text-muted'}`}>
                  {isQueued ? 'Guardada no aparelho' : describeWaveStart(item.startedAt, timeZone)}
                </span>
                <ChevronRight className="h-5 w-5 text-muted" aria-hidden="true" />
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
