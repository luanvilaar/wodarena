'use client';

import React, { useMemo, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';

import { summarizeStructure } from '@/lib/workoutStructureEditor';
import { buildWorkoutStageList, shouldShowWorkoutName } from '@/lib/workoutStageList';
import type { Division, Workout, WorkoutType } from '@/types';

// Lista "Provas WODs Cadastradas" por prova do evento (Story 1.91, opção B de
// docs/design/provas-cadastradas/). Cada grupo é uma prova do evento; cada linha
// é uma categoria. A descrição dos movimentos abre por linha. O que falta
// cadastrar aparece no fim do grupo, com atalho para o formulário ao lado.

type WorkoutStageListProps = {
  workouts: Workout[];
  divisions: Division[];
  /** Evento Qualifier: mostra o prazo de submissão de cada prova. */
  showSubmissionDeadline: boolean;
  getScoreLabel: (type: WorkoutType) => string;
  onEdit: (workout: Workout) => void;
  onDelete: (workout: Workout) => void;
  /** Atalho "cadastrar": o painel preenche o formulário com a categoria e o código; o gestor revisa e salva. */
  onAddMissing: (divisionId: string, suggestedCode: string) => void;
};

const iconButtonClassName =
  'inline-flex h-9 w-9 items-center justify-center rounded-md border border-card-border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const textButtonClassName =
  'rounded px-1 py-1 text-[11px] font-semibold underline decoration-card-border underline-offset-4 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

const workoutDisplayName = (workout: Workout) =>
  [workout.code, shouldShowWorkoutName(workout) ? workout.name : ''].filter(Boolean).join(' ') || workout.name;

type RowProps = {
  /** Único na lista inteira: a mesma prova Geral pode aparecer em mais de um grupo. */
  rowId: string;
  workout: Workout;
  label: string;
  ownLabel: string;
  coverageNote: string;
  isOpen: boolean;
  showSubmissionDeadline: boolean;
  getScoreLabel: (type: WorkoutType) => string;
  onToggle: (rowId: string) => void;
  onEdit: (workout: Workout) => void;
  onDelete: (workout: Workout) => void;
};

function WorkoutRow({
  rowId,
  workout,
  label,
  ownLabel,
  coverageNote,
  isOpen,
  showSubmissionDeadline,
  getScoreLabel,
  onToggle,
  onEdit,
  onDelete
}: RowProps) {
  const describedAs = `${workoutDisplayName(workout)} · ${label}`;
  const descriptionId = `wod-list-desc-${rowId}`;

  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 border-t border-card-border px-3.5 py-2.5 first:border-t-0 sm:grid-cols-[minmax(150px,1.2fr)_minmax(0,1fr)_auto]">
      <div className="min-w-0">
        <p className="text-sm font-bold text-white">{label}</p>
        {ownLabel && <p className="text-[11px] font-medium uppercase text-muted-soft">{ownLabel}</p>}
        {coverageNote && <p className="text-[11px] text-muted-soft">{coverageNote}</p>}
      </div>

      <div className="order-3 col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1 sm:order-none sm:col-span-1">
        <span className="text-xs font-bold uppercase text-white">
          {getScoreLabel(workout.type)}
          {workout.type === 'fortime' && <span className="font-semibold text-muted"> · cap {workout.timeCap || 'sem limite'}</span>}
        </span>
        {workout.tieBreaker && <span className="text-[10px] text-muted-soft">Desempate: {workout.tieBreaker}</span>}
        {showSubmissionDeadline && (
          <span className="text-[10px] text-primary">
            Prazo de submissão: {workout.submissionClosesAt ? new Date(workout.submissionClosesAt).toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' }) : 'não configurado'}
          </span>
        )}
        {workout.structure && (
          <p className="inline-flex items-center gap-1.5 rounded border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
            Súmula digital · {summarizeStructure(workout.structure)}
          </p>
        )}
      </div>

      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={() => onToggle(rowId)}
          aria-expanded={isOpen}
          aria-controls={descriptionId}
          className={`${textButtonClassName} mr-1 text-muted hover:text-white`}
        >
          {isOpen ? 'Fechar' : 'Movimentos'}
        </button>
        <button
          type="button"
          onClick={() => onEdit(workout)}
          className={`${iconButtonClassName} text-muted hover:border-primary/60 hover:text-primary`}
          aria-label={`Editar prova ${describedAs}`}
          title="Editar"
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => onDelete(workout)}
          className={`${iconButtonClassName} text-red-500 hover:border-red-500 hover:text-red-400`}
          aria-label={`Excluir prova ${describedAs}`}
          title="Excluir"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      <pre
        id={descriptionId}
        hidden={!isOpen}
        className="order-last col-span-2 whitespace-pre-wrap rounded-md border border-card-border bg-dark-gray px-3 py-2.5 font-sans text-xs text-muted-soft sm:col-span-3"
      >
        {workout.description}
      </pre>
    </li>
  );
}

export function WorkoutStageList({
  workouts,
  divisions,
  showSubmissionDeadline,
  getScoreLabel,
  onEdit,
  onDelete,
  onAddMissing
}: WorkoutStageListProps) {
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => new Set());
  const { groups, unplaced } = useMemo(() => buildWorkoutStageList(workouts, divisions), [workouts, divisions]);

  const toggle = (rowId: string) =>
    setOpenIds((current) => {
      const next = new Set(current);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });

  const rowProps = { showSubmissionDeadline, getScoreLabel, onToggle: toggle, onEdit, onDelete };

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted-soft">
        A Prova N é a N-ésima prova de cada categoria, na ordem da aba Provas. É a mesma numeração do construtor de baterias.
      </p>

      {groups.map((group) => {
        const headingId = `wod-stage-${group.stageNumber}`;
        const isComplete = group.coveredCount === group.totalCount;
        return (
          <section key={group.stageNumber} aria-labelledby={headingId} className="overflow-hidden rounded-xl border border-card-border">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-card-border bg-dark-gray px-3.5 py-3">
              <h4 id={headingId} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm font-bold text-white">
                <span className="rounded border border-primary/30 bg-primary/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                  {group.title}
                </span>
                {group.subtitle && <span className="uppercase tracking-wide">{group.subtitle}</span>}
              </h4>
              <span
                className={`ml-auto whitespace-nowrap font-number text-[11px] tabular-nums ${isComplete ? 'text-trading-up' : 'text-muted'}`}
              >
                {group.coveredCount} de {group.totalCount} {group.totalCount === 1 ? 'categoria' : 'categorias'}
              </span>
            </div>

            <ul>
              {group.rows.map((row) => (
                <WorkoutRow
                  key={row.key}
                  rowId={`${group.stageNumber}-${row.key}`}
                  workout={row.workout}
                  label={row.label}
                  ownLabel={row.ownLabel}
                  coverageNote={row.coverageNote}
                  isOpen={openIds.has(`${group.stageNumber}-${row.key}`)}
                  {...rowProps}
                />
              ))}
            </ul>

            {group.gaps.length > 0 && (
              <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 border-t border-dashed border-card-border px-3.5 py-2.5 text-xs text-muted-soft">
                <strong className="font-bold text-muted">Sem {group.title.toLowerCase()}:</strong>
                {group.gaps.map((gap) => (
                  <span key={gap.division.id} className="inline-flex flex-wrap items-baseline gap-x-1.5">
                    {gap.division.name}
                    {gap.canAdd ? (
                      <button
                        type="button"
                        onClick={() => onAddMissing(gap.division.id, group.suggestedCode)}
                        className={`${textButtonClassName} text-primary hover:text-primary-hover`}
                        aria-label={`Cadastrar ${group.title} para ${gap.division.name}`}
                      >
                        cadastrar
                      </button>
                    ) : (
                      <span className="text-[11px]">(cadastre antes a Prova {gap.blockedBy})</span>
                    )}
                  </span>
                ))}
              </div>
            )}
          </section>
        );
      })}

      {unplaced.length > 0 && (
        <section aria-labelledby="wod-stage-unplaced" className="overflow-hidden rounded-xl border border-card-border">
          <div className="border-b border-card-border bg-dark-gray px-3.5 py-3">
            <h4 id="wod-stage-unplaced" className="text-sm font-bold text-white">Sem categoria ativa</h4>
            <p className="text-[11px] text-muted-soft">Provas que nenhuma categoria do evento enxerga. Edite para escolher a categoria.</p>
          </div>
          <ul>
            {unplaced.map((workout) => (
              <WorkoutRow
                key={workout.id}
                rowId={`unplaced-${workout.id}`}
                workout={workout}
                label={workout.divisionId ? 'Categoria removida' : 'Geral'}
                ownLabel={workoutDisplayName(workout)}
                coverageNote=""
                isOpen={openIds.has(`unplaced-${workout.id}`)}
                {...rowProps}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
