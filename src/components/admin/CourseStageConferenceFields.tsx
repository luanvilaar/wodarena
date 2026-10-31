'use client';

import React from 'react';

import {
  RACE_CONFERENCE_KINDS,
  RACE_CONFERENCE_KIND_LABELS,
  RACE_STAGE_UNITS_MAX,
  RACE_STAGE_UNITS_MIN,
  conferenceKindUsesUnits,
  validateRaceStageConference
} from '@/lib/raceCourseStructure';
import type { RaceConferenceKind } from '@/types';

// Tipo de conferência e meta da estação no editor do percurso Fitness Race
// (Story 1.100, D33). O tipo vem pré-selecionado pela sugestão do nome e
// acompanha o nome enquanto o organizador não escolhe à mão; o campo
// "Trechos / voltas" só aparece para trenó e seções. O painel guarda o estado e
// valida de novo ao salvar (validateRaceStageConference).

type CourseStageConferenceFieldsProps = {
  /** Tipo em vigor: o escolhido à mão ou, sem escolha, o sugerido pelo nome. */
  conferenceKind: RaceConferenceKind;
  /** Tipo sugerido pelo nome da etapa. */
  suggestedKind: RaceConferenceKind;
  /** true quando o organizador escolheu o tipo no seletor (a sugestão deixa de acompanhar o nome). */
  chosenByHand: boolean;
  units?: number;
  /** Repetições do formulário: o tipo Reps exige a meta. */
  reps?: number;
  onConferenceKindChange: (kind: RaceConferenceKind) => void;
  onUnitsChange: (units: number | undefined) => void;
};

const fieldClassName =
  'w-full rounded-md border border-card-border bg-dark-gray px-4 py-2 text-sm text-white focus:border-primary/50 focus:outline-none';
const labelClassName = 'mb-1 block text-xs font-bold uppercase tracking-wider text-muted font-sans';

export function CourseStageConferenceFields({
  conferenceKind,
  suggestedKind,
  chosenByHand,
  units,
  reps,
  onConferenceKindChange,
  onUnitsChange
}: CourseStageConferenceFieldsProps) {
  const showUnits = conferenceKindUsesUnits(conferenceKind);
  const error = validateRaceStageConference({ type: 'station', conferenceKind, units, reps });

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-4">
        <div className={showUnits ? '' : 'col-span-2'}>
          <label htmlFor="library-stage-conference-kind" className={labelClassName}>Tipo de conferência *</label>
          <select
            id="library-stage-conference-kind"
            value={conferenceKind}
            onChange={(e) => onConferenceKindChange(e.target.value as RaceConferenceKind)}
            aria-describedby="library-stage-conference-hint"
            className={fieldClassName}
          >
            {RACE_CONFERENCE_KINDS.map((kind) => (
              <option key={kind} value={kind}>{RACE_CONFERENCE_KIND_LABELS[kind]}</option>
            ))}
          </select>
        </div>
        {showUnits && (
          <div>
            <label htmlFor="library-stage-units" className={labelClassName}>Trechos / voltas</label>
            <input
              id="library-stage-units"
              type="number"
              min={RACE_STAGE_UNITS_MIN}
              max={RACE_STAGE_UNITS_MAX}
              step={1}
              inputMode="numeric"
              placeholder={conferenceKind === 'sled' ? 'Ex: 4' : 'Ex: 8'}
              value={units ?? ''}
              onChange={(e) => onUnitsChange(e.target.value === '' ? undefined : Number(e.target.value))}
              className={`${fieldClassName} font-number`}
            />
          </div>
        )}
      </div>
      <p id="library-stage-conference-hint" className="text-[11px] text-muted">
        {chosenByHand
          ? `Sugerido pelo nome: ${RACE_CONFERENCE_KIND_LABELS[suggestedKind]}.`
          : 'Sugerido pelo nome da etapa. Ajuste se a conferência for outra.'}
        {conferenceKind === 'sled' && ' Sem trechos informados, a súmula usa a distância dividida por 12,5 m.'}
      </p>
      {error && (
        <p role="alert" className="rounded-md border border-trading-down/40 bg-trading-down/10 px-3 py-2 text-xs font-semibold text-trading-down">
          {error}
        </p>
      )}
    </div>
  );
}
