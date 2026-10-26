'use client';

import { useState } from 'react';

import { SheetDemo } from '@/components/sheet/SheetDemo';
import type { WorkoutSegment, WorkoutSegmentUnit, WorkoutStructure } from '@/lib/workoutStructure';

// Pré-visualização da súmula do judge (Stories 1.44, 1.47, 1.48, 1.62 e 1.80), SÓ em
// desenvolvimento: provas de exemplo sobre o SheetDemo (relógio e log em
// memória). Nada é gravado. A página que a usa responde 404 em produção.

const segment = (
  id: string,
  round: number,
  name: string,
  reps: number,
  load: number | null,
  unit: WorkoutSegmentUnit = 'reps'
): WorkoutSegment => ({
  id,
  round,
  name,
  reps,
  unit,
  load: load === null ? null : { value: load, unit: 'kg' },
  note: '',
  required: true,
  mark: unit === 'reps' ? 'reps' : 'end'
});

const ENTRY = { mode: 'both', marking: 'reps', publish: 'after_review' } as const;

const FOR_TIME: WorkoutStructure = {
  version: 5,
  format: 'for_time',
  totalReps: 90,
  timeCapSeconds: 600,
  incomplete: { rule: 'penalty_per_rep', secondsPerRep: 1, base: 'time_cap' },
  tieBreak: { kind: 'last_split', at: ['s2', 's4', 's6'], order: 'asc' },
  generator: { kind: 'descending', reps: [21, 15, 9] },
  customized: false,
  entry: ENTRY,
  segments: [
    segment('s1', 1, 'Thruster', 21, 43),
    segment('s2', 1, 'Pull-up', 21, null),
    segment('s3', 2, 'Thruster', 15, 43),
    segment('s4', 2, 'Pull-up', 15, null),
    segment('s5', 3, 'Thruster', 9, 43),
    segment('s6', 3, 'Pull-up', 9, null)
  ],
  maxLoad: null,
  scoreDisplay: null,
  interval: null,
  distance: null,
  tonnage: null
};

const UNITS: WorkoutStructure = {
  version: 5,
  format: 'for_time',
  totalReps: 550,
  timeCapSeconds: 900,
  incomplete: { rule: 'penalty_per_rep', secondsPerRep: 1, base: 'time_cap' },
  tieBreak: { kind: 'split_time', at: 'u2', order: 'asc' },
  generator: null,
  customized: true,
  entry: ENTRY,
  segments: [
    segment('u1', 1, 'Remo', 500, null, 'm'),
    segment('u2', 1, 'Bike', 30, null, 'cal'),
    segment('u3', 1, 'Burpee', 20, null)
  ],
  maxLoad: null,
  scoreDisplay: null,
  interval: null,
  distance: null,
  tonnage: null
};

const AMRAP: WorkoutStructure = {
  version: 5,
  format: 'amrap',
  totalReps: 30,
  timeCapSeconds: 720,
  incomplete: null,
  tieBreak: { kind: 'last_round', order: 'asc' },
  generator: { kind: 'fixed', reps: [10] },
  customized: false,
  entry: ENTRY,
  segments: [
    segment('s1', 1, 'Thruster', 10, 43),
    segment('s2', 1, 'Pull-up', 10, null),
    segment('s3', 1, 'Burpee', 10, null)
  ],
  maxLoad: null,
  scoreDisplay: 'rounds_reps',
  interval: null,
  distance: null,
  tonnage: null
};

const MAX_LOAD: WorkoutStructure = {
  version: 5,
  format: 'max_load',
  totalReps: 0,
  timeCapSeconds: 1200,
  incomplete: null,
  tieBreak: { kind: 'finish_time', order: 'asc' },
  generator: null,
  customized: true,
  entry: ENTRY,
  segments: [],
  maxLoad: {
    lifts: [
      { id: 'l1', name: 'Back Squat', reps: 1, maxAttempts: 3, startLoadKg: 100, note: '' },
      { id: 'l2', name: 'Press', reps: 1, maxAttempts: 3, startLoadKg: 40, note: '' },
      { id: 'l3', name: 'Deadlift', reps: 1, maxAttempts: 3, startLoadKg: 120, note: '' }
    ],
    order: 'fixed',
    scoring: 'sum',
    loadStepKg: 2.5
  },
  scoreDisplay: null,
  interval: null,
  distance: null,
  tonnage: null
};

// Story 1.62: o treino de referência do Intervalado (docs/design/intervalado/).
const INTERVAL: WorkoutStructure = {
  version: 5,
  format: 'interval',
  totalReps: 21,
  timeCapSeconds: 1080,
  incomplete: null,
  tieBreak: null,
  generator: null,
  customized: true,
  entry: ENTRY,
  segments: [
    segment('f1', 1, 'Ring Muscle Ups', 6, null),
    segment('f2', 1, 'Box Jump Overs (24/20 in)', 15, null)
  ],
  maxLoad: null,
  scoreDisplay: null,
  interval: { rounds: 5, onSeconds: 120, offSeconds: 120, max: { id: 'mx', name: 'Squat Clean', load: { value: 80, unit: 'kg' }, note: '' } },
  distance: null,
  tonnage: null
};

// Story 1.68: o treino de referência da Distância (docs/design/distancia/).
const DISTANCE: WorkoutStructure = {
  version: 5,
  format: 'distance',
  totalReps: 0,
  timeCapSeconds: 1200,
  incomplete: null,
  tieBreak: null,
  generator: null,
  customized: true,
  entry: ENTRY,
  segments: [],
  maxLoad: null,
  scoreDisplay: null,
  interval: null,
  distance: { unit: 'm', note: '750 m corrida; máx. distância no remo. Os parceiros trocam a cada volta da corrida.' },
  tonnage: null
};

// Story 1.80: os dois treinos de referência da Tonelagem (docs/design/tonelagem/).
const TONNAGE_BASE = {
  version: 5,
  format: 'tonnage',
  incomplete: null,
  tieBreak: null,
  generator: null,
  customized: true,
  entry: ENTRY,
  maxLoad: null,
  scoreDisplay: null,
  interval: null,
  distance: null
} as const;

// Treino 1: 10 Pull Ups e 10 Burpees liberam, Squat Clean conta (carga livre, time cap de 10:00).
const TONNAGE_LIBERATION: WorkoutStructure = {
  ...TONNAGE_BASE,
  totalReps: 20,
  timeCapSeconds: 600,
  segments: [segment('s1', 1, 'Pull Ups', 10, null), segment('s2', 1, 'Burpees', 10, null)],
  tonnage: {
    position: 2,
    lift: { id: 'tn', name: 'Squat Clean', loadKg: null, note: '' },
    loadMode: 'athlete',
    increment: { allowed: false, stepKg: 2.5 },
    note: ''
  }
};

// Treino 2: um exercício só, carga livre que pode subir de 10 em 10 kg, time cap de 03:00.
const TONNAGE_SINGLE: WorkoutStructure = {
  ...TONNAGE_BASE,
  totalReps: 0,
  timeCapSeconds: 180,
  segments: [],
  tonnage: {
    position: 0,
    lift: { id: 'tn', name: 'Squat Snatch', loadKg: null, note: '' },
    loadMode: 'athlete',
    increment: { allowed: true, stepKg: 10 },
    note: ''
  }
};

const FIXTURES = {
  fortime: { label: 'For Time 21-15-9', structure: FOR_TIME, workoutName: 'Fran · For Time' },
  units: { label: 'Metros e calorias', structure: UNITS, workoutName: 'Remo, bike e burpee · For Time' },
  amrap: { label: 'AMRAP 12 min', structure: AMRAP, workoutName: 'Cindy 30 · AMRAP' },
  maxload: { label: 'Carga máxima', structure: MAX_LOAD, workoutName: 'CrossFit Total · Carga máxima' },
  interval: { label: 'Intervalado 5 × 02:00 / 02:00', structure: INTERVAL, workoutName: 'Intervalado 5 × 2′' },
  distance: { label: 'Distância 20:00', structure: DISTANCE, workoutName: 'Remo e corrida · Distância' },
  tonnage1: { label: 'Tonelagem com liberação', structure: TONNAGE_LIBERATION, workoutName: 'Squat Clean · Tonelagem' },
  tonnage2: { label: 'Tonelagem 03:00', structure: TONNAGE_SINGLE, workoutName: 'Squat Snatch · Tonelagem' }
} as const;

type FixtureId = keyof typeof FIXTURES;

export function SheetPreview() {
  const [fixtureId, setFixtureId] = useState<FixtureId>('fortime');
  const fixture = FIXTURES[fixtureId];

  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-xl border border-dashed border-card-border p-3 text-xs text-muted">
        <p className="font-bold uppercase tracking-widest text-primary">Pré-visualização (só desenvolvimento)</p>
        <div className="flex flex-wrap items-center gap-2">
          {(Object.keys(FIXTURES) as FixtureId[]).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setFixtureId(id)}
              aria-pressed={fixtureId === id}
              className={`min-h-9 rounded-md border px-3 text-xs font-bold ${fixtureId === id ? 'border-primary bg-primary text-ink' : 'border-card-border bg-dark-gray text-white'}`}
            >
              {FIXTURES[id].label}
            </button>
          ))}
        </div>
      </div>

      <SheetDemo
        key={fixtureId}
        structure={fixture.structure}
        context={{ workoutName: fixture.workoutName, athleteName: 'Atleta de Exemplo', laneLabel: 'Lane 3' }}
        showLog
      />
    </div>
  );
}
