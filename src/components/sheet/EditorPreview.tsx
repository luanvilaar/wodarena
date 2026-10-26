'use client';

import { useState } from 'react';

import { WorkoutStructureEditor } from '@/components/admin/WorkoutStructureEditor';
import { deriveLegacyWorkoutFields, validateWorkoutStructure, type WorkoutStructure } from '@/lib/workoutStructure';

// Súmula digital fora do painel (Stories 1.45 e 1.46), SÓ em desenvolvimento:
// o resumo do formulário e o construtor em tela cheia sobre uma estrutura
// local, com o que ele entregaria ao painel (campos legados derivados e a
// estrutura normalizada). Nada é gravado. A página que o usa responde 404 em
// produção.

// Story 1.61: o treino de referência do Intervalado (docs/design/intervalado/),
// para conferir a prova gravada reabrindo em "Editar súmula".
const INTERVAL_EXAMPLE: WorkoutStructure = {
  version: 5,
  format: 'interval',
  totalReps: 21,
  timeCapSeconds: 1080,
  incomplete: null,
  tieBreak: null,
  generator: null,
  customized: true,
  entry: { mode: 'both', marking: 'reps', publish: 'after_review' },
  segments: [
    { id: 's1', round: 1, name: 'Ring Muscle Ups', reps: 6, unit: 'reps', load: null, note: '', required: true, mark: 'reps' },
    { id: 's2', round: 1, name: 'Box Jump Overs (24/20 in)', reps: 15, unit: 'reps', load: null, note: '', required: true, mark: 'reps' }
  ],
  maxLoad: null,
  scoreDisplay: null,
  interval: { rounds: 5, onSeconds: 120, offSeconds: 120, max: { id: 'mx', name: 'Squat Clean', load: { value: 80, unit: 'kg' }, note: '' } },
  distance: null,
  tonnage: null
};

// Story 1.67: o treino de referência da Distância (docs/design/distancia/).
const DISTANCE_EXAMPLE: WorkoutStructure = {
  version: 5,
  format: 'distance',
  totalReps: 0,
  timeCapSeconds: 1200,
  incomplete: null,
  tieBreak: null,
  generator: null,
  customized: true,
  entry: { mode: 'both', marking: 'reps', publish: 'after_review' },
  segments: [],
  maxLoad: null,
  scoreDisplay: null,
  interval: null,
  distance: { unit: 'm', note: '750 m corrida; máx. distância no remo. Os parceiros trocam a cada volta da corrida.' },
  tonnage: null
};

export function EditorPreview() {
  const [value, setValue] = useState<WorkoutStructure | null>(null);
  const validation = value ? validateWorkoutStructure(value) : null;
  const legacy = validation?.ok ? deriveLegacyWorkoutFields(validation.structure) : null;

  return (
    <div className="space-y-4">
      <p className="text-xs font-bold uppercase tracking-widest text-primary">Editor da prova (só desenvolvimento)</p>
      <button
        type="button"
        onClick={() => setValue(INTERVAL_EXAMPLE)}
        className="min-h-9 rounded-md border border-card-border bg-dark-gray px-3 text-xs font-bold text-white"
      >
        Carregar o exemplo do Intervalado (5 × 02:00 / 02:00)
      </button>
      <button
        type="button"
        onClick={() => setValue(DISTANCE_EXAMPLE)}
        className="ml-2 min-h-9 rounded-md border border-card-border bg-dark-gray px-3 text-xs font-bold text-white"
      >
        Carregar o exemplo da Distância (20:00)
      </button>
      <WorkoutStructureEditor value={value} onChange={setValue} workoutName="Prova de exemplo" timeCapHint="12:00" idPrefix="preview" />
      <details className="rounded-xl border border-card-border p-3 text-xs text-muted" open>
        <summary className="cursor-pointer font-bold text-white">O que o painel receberia</summary>
        <pre data-testid="editor-output" className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap font-mono text-[11px]">
          {JSON.stringify({ campos_legados: legacy, valida: validation ? validation.ok : null, erro: validation && !validation.ok ? validation.error : null, estrutura: validation?.ok ? validation.structure : value }, null, 1)}
        </pre>
      </details>
    </div>
  );
}
