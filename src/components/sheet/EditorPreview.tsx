'use client';

import { useState } from 'react';

import { WorkoutStructureEditor } from '@/components/admin/WorkoutStructureEditor';
import { deriveLegacyWorkoutFields, validateWorkoutStructure, type WorkoutStructure } from '@/lib/workoutStructure';

// Súmula digital fora do painel (Stories 1.45 e 1.46), SÓ em desenvolvimento:
// o resumo do formulário e o construtor em tela cheia sobre uma estrutura
// local, com o que ele entregaria ao painel (campos legados derivados e a
// estrutura normalizada). Nada é gravado. A página que o usa responde 404 em
// produção.

export function EditorPreview() {
  const [value, setValue] = useState<WorkoutStructure | null>(null);
  const validation = value ? validateWorkoutStructure(value) : null;
  const legacy = validation?.ok ? deriveLegacyWorkoutFields(validation.structure) : null;

  return (
    <div className="space-y-4">
      <p className="text-xs font-bold uppercase tracking-widest text-primary">Editor da prova (só desenvolvimento)</p>
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
