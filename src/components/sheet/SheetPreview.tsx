'use client';

import { useState } from 'react';

import { SheetDemo } from '@/components/sheet/SheetDemo';
import type { WorkoutSegment, WorkoutSegmentUnit, WorkoutStructure } from '@/lib/workoutStructure';

// Pré-visualização da súmula do judge (Stories 1.44, 1.47 e 1.48), SÓ em
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
  version: 2,
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
  scoreDisplay: null
};

const UNITS: WorkoutStructure = {
  version: 2,
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
  scoreDisplay: null
};

const AMRAP: WorkoutStructure = {
  version: 2,
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
  scoreDisplay: 'rounds_reps'
};

const MAX_LOAD: WorkoutStructure = {
  version: 2,
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
  scoreDisplay: null
};

const FIXTURES = {
  fortime: { label: 'For Time 21-15-9', structure: FOR_TIME, workoutName: 'Fran · For Time' },
  units: { label: 'Metros e calorias', structure: UNITS, workoutName: 'Remo, bike e burpee · For Time' },
  amrap: { label: 'AMRAP 12 min', structure: AMRAP, workoutName: 'Cindy 30 · AMRAP' },
  maxload: { label: 'Carga máxima', structure: MAX_LOAD, workoutName: 'CrossFit Total · Carga máxima' }
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
