'use client';

import type { MouseEvent } from 'react';
import { ChevronRight } from 'lucide-react';

import { SCORESHEET_STATUS_LABELS } from '@/lib/scoresheet';
import {
  boardEntryMatches,
  isBoardFilterActive,
  isBoardGroupOpenByDefault,
  splitTeamName,
  type BoardEntry,
  type BoardFilter,
  type BoardGroup,
  type BoardLaneState,
  type BoardSheet
} from '@/lib/scoresheetBoard';

// Lista da prova na aba "Súmulas e Judges" (Story 1.142; desenho aprovado em
// docs/design/sumulas-organizacao/): um bloco por bateria, recolhível, com uma
// linha por raia. Tocar numa linha abre o painel de detalhe (Story 1.143), que
// fica no ScoresheetsPanel. Componente só de exibição: o estado vem por props.

export type BoardRowSheet = BoardSheet & {
  judgeName: string;
  officialResult: string | null;
  officialTieBreak: string | null;
  corrected: boolean;
  absent?: boolean;
};

export const LANE_STATE_LABELS: Record<BoardLaneState, string> = {
  submitted: SCORESHEET_STATUS_LABELS.submitted,
  in_progress: SCORESHEET_STATUS_LABELS.in_progress,
  returned: SCORESHEET_STATUS_LABELS.returned,
  cancelled: SCORESHEET_STATUS_LABELS.cancelled,
  missing: 'Sem súmula',
  waiting: 'Aguardando'
};

export const LANE_STATE_CHIP: Record<BoardLaneState, string> = {
  submitted: 'border-trading-up/60 text-trading-up',
  in_progress: 'border-primary/60 text-primary',
  returned: 'border-trading-down/60 text-trading-down',
  cancelled: 'border-card-border text-muted',
  missing: 'border-dashed border-muted/70 text-muted',
  waiting: 'border-card-border text-muted'
};

const LANE_MARK: Record<BoardLaneState, string> = {
  submitted: 'bg-trading-up',
  in_progress: 'bg-primary',
  returned: 'bg-trading-down',
  cancelled: 'bg-card-border',
  missing: 'border border-dashed border-muted',
  waiting: 'bg-card-border'
};

const MAX_LANE_MARKS = 12;

export const groupTitle = (group: Pick<BoardGroup, 'kind' | 'heatNumber'>) => {
  if (group.kind === 'outside') return 'Fora das baterias do cronograma';
  if (group.kind === 'no_heat') return 'Sem bateria';
  return group.heatNumber ? `Bateria ${group.heatNumber}` : 'Bateria';
};

/** "7/7 publicadas", "6/7 publicadas · 1 sem súmula", "Aguardando · 7 raias". */
export const groupSummary = (group: Pick<BoardGroup, 'kind' | 'started' | 'counts' | 'entries'>) => {
  const live = group.entries.length - group.counts.cancelled;
  if (group.kind === 'heat' && !group.started) return `Aguardando · ${live} ${live === 1 ? 'raia' : 'raias'}`;
  const parts = [`${group.counts.submitted}/${live} publicadas`];
  if (group.counts.missing) parts.push(`${group.counts.missing} sem súmula`);
  if (group.counts.in_progress) parts.push(`${group.counts.in_progress} em andamento`);
  if (group.counts.returned) parts.push(`${group.counts.returned} ${group.counts.returned === 1 ? 'devolvida' : 'devolvidas'}`);
  return parts.join(' · ');
};

type Props = {
  idPrefix: string;
  groups: BoardGroup<BoardRowSheet>[];
  filter: BoardFilter;
  openGroups: Record<string, boolean>;
  divisionNames: Record<string, string>;
  onToggleGroup: (groupKey: string, open: boolean) => void;
  onSelect: (entry: BoardEntry<BoardRowSheet>, sheetId: string | null, trigger: HTMLElement) => void;
  formatWhen: (iso: string) => string;
};

export function ScoresheetBoard({ idPrefix, groups, filter, openGroups, divisionNames, onToggleGroup, onSelect, formatWhen }: Props) {
  const filtered = isBoardFilterActive(filter);
  const visible = groups
    .map((group) => ({ group, entries: group.entries.filter((entry) => boardEntryMatches(entry, filter)) }))
    .filter(({ entries }) => entries.length > 0);

  if (groups.length === 0) return <p className="px-4 py-5 text-sm text-muted">Nenhuma súmula aberta ainda.</p>;
  if (visible.length === 0) return <p className="px-4 py-5 text-sm text-muted">Nenhuma súmula com esses filtros.</p>;

  const renderRow = (group: BoardGroup<BoardRowSheet>, entry: BoardEntry<BoardRowSheet>, sheet: BoardRowSheet | null) => {
    const state: BoardLaneState = sheet ? (sheet.status === 'cancelled' ? 'cancelled' : sheet.status) : entry.state;
    const isCancelledRow = sheet?.status === 'cancelled';
    const name = splitTeamName(sheet?.athleteName || entry.athleteName);
    const lane = entry.lane ? `${group.kind === 'outside' && entry.heatNumber ? `B${entry.heatNumber} ` : ''}R${entry.lane}` : '—';
    const meta = [
      filter.divisionId ? '' : divisionNames[entry.divisionId] || '',
      name.secondary,
      sheet ? `${sheet.judgeName} · ${formatWhen(sheet.updatedAt)}` : state === 'waiting' ? 'aguardando a bateria' : 'sem súmula aberta'
    ].filter(Boolean);
    const extraCancelled = !isCancelledRow && !filter.showCancelled ? entry.cancelled.length : 0;
    return (
      <li key={sheet ? sheet.id : entry.key}>
        <button
          type="button"
          onClick={(clickEvent: MouseEvent<HTMLButtonElement>) => onSelect(entry, isCancelledRow && sheet ? sheet.id : null, clickEvent.currentTarget)}
          data-entry={entry.key}
          data-sheet={sheet?.id ?? ''}
          className={`grid min-h-13 w-full grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-x-3 rounded-lg border px-2.5 py-2 text-left transition-colors hover:border-card-border hover:bg-dark-gray motion-reduce:transition-none ${sheet ? 'border-transparent' : 'border-dashed border-card-border'} ${isCancelledRow ? 'opacity-60' : ''}`}
        >
          <span className="font-number text-xs font-bold text-muted">{lane}</span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold">
              {name.primary}
              {entry.box && <span className="ml-1.5 text-xs font-normal text-muted">{entry.box}</span>}
            </span>
            <span className="block truncate text-xs text-muted">{meta.join(' · ')}</span>
          </span>
          <span className="flex flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-3">
            {extraCancelled > 0 && <span className="hidden whitespace-nowrap text-[11px] text-muted sm:inline">+{extraCancelled} {extraCancelled === 1 ? 'cancelada' : 'canceladas'}</span>}
            <span className="whitespace-nowrap text-right font-number text-sm font-bold">
              {sheet?.officialResult ? sheet.officialResult : <span className="font-normal text-muted">—</span>}
              {sheet?.officialTieBreak ? <span className="ml-1 text-xs font-normal text-muted">tb {sheet.officialTieBreak}</span> : null}
              {sheet?.corrected && <span className="ml-1.5 rounded border border-primary/50 px-1 text-[10px] uppercase text-primary">corrigido</span>}
              {sheet?.absent && <span className="ml-1.5 rounded border border-info/60 px-1 text-[10px] uppercase text-info">Ausente</span>}
            </span>
            <span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${LANE_STATE_CHIP[state]}`}>{LANE_STATE_LABELS[state]}</span>
          </span>
        </button>
      </li>
    );
  };

  return (
    <div className="divide-y divide-card-border">
      {visible.map(({ group, entries }) => {
        const open = openGroups[group.key] ?? (filtered ? true : isBoardGroupOpenByDefault(group));
        const listId = `${idPrefix}-${group.key.replace(/[^a-zA-Z0-9-]/g, '-')}`;
        const live = group.entries.filter((entry) => entry.state !== 'cancelled');
        const divisions = [...new Set(live.map((entry) => entry.divisionId))].map((id) => divisionNames[id]).filter(Boolean);
        return (
          <div key={group.key}>
            <button
              type="button"
              onClick={() => onToggleGroup(group.key, !open)}
              aria-expanded={open}
              aria-controls={open ? listId : undefined}
              className="grid w-full grid-cols-[minmax(0,1fr)_auto_1rem] items-center gap-x-3 gap-y-1.5 px-4 py-3 text-left transition-colors hover:bg-dark-gray/40 motion-reduce:transition-none sm:grid-cols-[minmax(0,1fr)_auto_auto_1rem]"
            >
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                <span className="text-[13px] font-extrabold uppercase tracking-wider">{groupTitle(group)}</span>
                {group.time && <span className="font-number text-xs text-muted">{group.time}</span>}
                {divisions.length > 0 && <span className="text-xs text-muted">{divisions.join(', ')}</span>}
              </span>
              <span className="col-start-1 row-start-2 inline-flex gap-[3px] sm:col-start-2 sm:row-start-1" aria-hidden="true">
                {live.length <= MAX_LANE_MARKS
                  ? live.map((entry) => <i key={entry.key} className={`h-2 w-3 rounded-sm ${LANE_MARK[entry.state]}`} />)
                  : <i className="block h-1.5 w-24 overflow-hidden rounded-full bg-card-border"><i className="block h-full bg-trading-up" style={{ width: `${Math.round((group.counts.submitted / live.length) * 100)}%` }} /></i>}
              </span>
              <span className={`whitespace-nowrap text-right font-number text-xs ${group.complete ? 'text-trading-up' : 'text-muted'}`}>{groupSummary(group)}</span>
              <ChevronRight className={`h-4 w-4 text-muted transition-transform motion-reduce:transition-none ${open ? 'rotate-90' : ''}`} aria-hidden="true" />
            </button>
            {open && (
              <ul id={listId} className="space-y-0.5 px-2 pb-3">
                {entries.flatMap((entry) => [
                  ...(filter.showCancelled ? entry.cancelled.map((sheet) => renderRow(group, entry, sheet)) : []),
                  ...(entry.state === 'cancelled' ? [] : [renderRow(group, entry, entry.sheet)])
                ])}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
