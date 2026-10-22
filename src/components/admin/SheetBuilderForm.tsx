'use client';

import { Fragment, type KeyboardEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Check, Flag, MoreHorizontal, Plus, X } from 'lucide-react';

import {
  INTERVAL_FIELDS,
  MAX_BUILDER_LINES,
  MAX_INTERVAL_FIXED_LINES,
  addLift,
  addLine,
  describeStructureRule,
  formatMinutes,
  formatTimeInput,
  moveLine,
  parseRepsField,
  removeLift,
  removeLine,
  setDraftFormat,
  setForTimeTieBreak,
  toggleStepMark,
  updateIntervalMax,
  updateIntervalTiming,
  updateLift,
  updateLine,
  type AmrapTieBreakMode,
  type BuilderLift,
  type BuilderLine,
  type BuilderStep,
  type ChecklistItem,
  type DraftAnalysis,
  type ForTimeTieBreakMode,
  type IntervalTiming,
  type MaxLoadTieBreakMode,
  type SheetDraft
} from '@/lib/workoutStructureEditor';
import { UNIT_WORDS, WORKOUT_STRUCTURE_LIMITS, type WorkoutStructureFormat } from '@/lib/workoutStructure';

// Formulário do construtor da súmula (Story 1.46, desenho aprovado em
// docs/design/sumula-digital/): uma linha por movimento com três campos,
// repetições, movimento e carga, como o WOD é escrito no quadro do box. O
// rascunho é controlado por quem usa (o painel largo do construtor); a análise
// (etapas, conferência e estrutura gerada) vem de analyzeDraft. Sem rede e sem
// armazenamento; texto em português fixo, como o restante do painel.
// O Intervalado (Story 1.61) segue a Maquete 1 de docs/design/intervalado/.

type SheetBuilderFormProps = {
  draft: SheetDraft;
  analysis: DraftAnalysis;
  onChange: (next: SheetDraft) => void;
  /** Linhas com "mais opções" abertas (controlado por quem usa, para sobreviver ao rascunho). */
  openLines: readonly string[];
  onToggleLine: (key: string) => void;
  idPrefix: string;
};

const inputClass = 'w-full min-w-0 rounded-md border border-card-border bg-dark-gray px-3 py-2 text-sm text-white placeholder:text-muted focus:border-primary/50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50';
const labelClass = 'mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted';
const iconButtonClass = 'flex min-h-10 min-w-10 items-center justify-center rounded-md border border-card-border bg-dark-gray text-white transition-colors hover:border-primary disabled:cursor-not-allowed disabled:opacity-40';
const textButtonClass = 'flex min-h-10 items-center justify-center gap-1.5 rounded-md border border-card-border bg-dark-gray px-3 text-xs font-bold text-white transition-colors hover:border-primary disabled:cursor-not-allowed disabled:opacity-40';
const errorInputClass = 'border-trading-down/70';

const FORMATS: { value: WorkoutStructureFormat; title: string; detail: string }[] = [
  { value: 'for_time', title: 'For Time', detail: 'Menor tempo para um trabalho definido' },
  { value: 'amrap', title: 'AMRAP', detail: 'Mais repetições dentro do tempo' },
  { value: 'max_load', title: 'Carga máxima', detail: 'Maior carga válida, por tentativas' },
  { value: 'interval', title: 'Intervalado', detail: 'Rounds de trabalho e descanso; soma das repetições' }
];

function Section({ step, title, children, id }: { step: number; title: string; children: ReactNode; id: string }) {
  return (
    <section aria-labelledby={id} className="space-y-3 rounded-lg border border-card-border bg-card p-4">
      <h3 id={id} className="flex items-baseline gap-2 text-xs font-bold uppercase tracking-wider text-white">
        <span className="font-number text-primary">{step}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

function Checklist({ items, rule }: { items: ChecklistItem[]; rule: ReactNode }) {
  return (
    <div className="space-y-3">
      {rule}
      <ul className="space-y-1 text-xs" aria-live="polite">
        {items.map((item) => (
          <li key={`${item.tone}-${item.text}`} className="flex items-baseline gap-2">
            <span
              aria-hidden="true"
              className={`w-3 shrink-0 font-bold ${item.tone === 'ok' ? 'text-trading-up' : item.tone === 'error' ? 'text-trading-down' : 'text-muted'}`}
            >
              {item.tone === 'ok' ? '✓' : item.tone === 'error' ? '!' : '·'}
            </span>
            <span className={item.tone === 'muted' ? 'text-muted' : 'text-white'}>
              <span className="sr-only">{item.tone === 'ok' ? 'Certo: ' : item.tone === 'error' ? 'Corrigir: ' : ''}</span>
              {item.text}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RuleSentence({ analysis }: { analysis: DraftAnalysis }) {
  if (!analysis.structure) {
    return <p className="rounded-md border border-card-border bg-dark-gray px-3 py-2.5 text-xs text-muted">A regra aparece aqui quando os itens marcados com ! forem corrigidos.</p>;
  }
  return (
    <p className="rounded-md border border-card-border bg-dark-gray px-3 py-2.5 text-[13px] leading-relaxed text-white" aria-live="polite">
      {describeStructureRule(analysis.structure).map((part, index) => (
        part.strong ? <strong key={index} className="font-semibold text-primary">{part.text}</strong> : <span key={index}>{part.text}</span>
      ))}
    </p>
  );
}

// Uma linha do trabalho: repetições, movimento e carga; "mais opções" guarda a
// contagem do judge, o padrão do movimento e a ordem.
function WorkLine({
  line,
  index,
  count,
  problem,
  open,
  idPrefix,
  allowSequences,
  minCount = 1,
  onPatch,
  onRemove,
  onMove,
  onToggle
}: {
  line: BuilderLine;
  index: number;
  count: number;
  /** Linhas que não podem ser removidas (no Intervalado os fixos chegam a zero). */
  minCount?: number;
  problem: string | undefined;
  open: boolean;
  idPrefix: string;
  allowSequences: boolean;
  onPatch: (patch: Partial<BuilderLine>) => void;
  onRemove: () => void;
  onMove: (direction: 'up' | 'down') => void;
  onToggle: () => void;
}) {
  const base = `${idPrefix}-${line.key}`;
  const parsedReps = parseRepsField(line.reps);
  const meters = parsedReps.ok && parsedReps.unit === 'm';
  return (
    <li className="space-y-1.5">
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-[6.5rem_minmax(0,1fr)_5.5rem_2.5rem_2.5rem]">
        <input
          id={`${base}-reps`}
          type="text"
          autoComplete="off"
          inputMode="text"
          placeholder={allowSequences ? '21-15-9' : '10'}
          aria-label={`Repetições do movimento ${index + 1}`}
          aria-invalid={Boolean(problem)}
          aria-describedby={problem ? `${base}-problem` : undefined}
          value={line.reps}
          onChange={(event) => onPatch({ reps: event.target.value })}
          className={`${inputClass} col-span-1 text-center font-number ${problem && !line.reps.trim() ? errorInputClass : ''}`}
        />
        <input
          id={`${base}-name`}
          type="text"
          autoComplete="off"
          placeholder="Movimento"
          maxLength={WORKOUT_STRUCTURE_LIMITS.maxNameLength}
          aria-label={`Movimento ${index + 1}`}
          value={line.name}
          onChange={(event) => onPatch({ name: event.target.value })}
          className={`${inputClass} order-first col-span-4 sm:order-none sm:col-span-1 ${problem && !line.name.trim() ? errorInputClass : ''}`}
        />
        <input
          id={`${base}-load`}
          type="text"
          autoComplete="off"
          inputMode="decimal"
          placeholder="kg"
          aria-label={`Carga do movimento ${index + 1} em kg`}
          value={line.load}
          onChange={(event) => onPatch({ load: event.target.value })}
          className={`${inputClass} text-center font-number`}
        />
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={`${base}-more`}
          aria-label={`Mais opções do movimento ${index + 1}`}
          title="Mais opções"
          className={`${iconButtonClass} ${open ? 'border-primary/60 text-primary' : ''}`}
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onRemove}
          disabled={count <= minCount}
          aria-label={`Remover o movimento ${index + 1}`}
          className={iconButtonClass}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      {problem && <p id={`${base}-problem`} className="text-[11px] font-semibold text-trading-down">{problem}</p>}
      {open && (
        <div id={`${base}-more`} className="grid gap-2 rounded-md border border-dashed border-card-border p-3 sm:grid-cols-[11rem_minmax(0,1fr)_auto]">
          <div>
            <label htmlFor={`${base}-mark`} className={labelClass}>Como o judge conta</label>
            <select
              id={`${base}-mark`}
              value={meters ? 'end' : line.mark}
              disabled={meters}
              onChange={(event) => onPatch({ mark: event.target.value as BuilderLine['mark'] })}
              className={inputClass}
            >
              <option value="reps">Toque a toque</option>
              <option value="end">Só o bloco inteiro</option>
            </select>
            {meters && <p className="mt-1 text-[10px] text-muted">Em metros o judge conclui o bloco.</p>}
          </div>
          <div>
            <label htmlFor={`${base}-note`} className={labelClass}>Padrão do movimento (opcional)</label>
            <input
              id={`${base}-note`}
              type="text"
              autoComplete="off"
              maxLength={WORKOUT_STRUCTURE_LIMITS.maxNoteLength}
              value={line.note}
              onChange={(event) => onPatch({ note: event.target.value })}
              className={inputClass}
            />
          </div>
          <div className="flex items-end gap-1.5">
            <button type="button" onClick={() => onMove('up')} disabled={index === 0} aria-label={`Subir o movimento ${index + 1}`} className={iconButtonClass}>
              <ArrowUp className="h-4 w-4" aria-hidden="true" />
            </button>
            <button type="button" onClick={() => onMove('down')} disabled={index === count - 1} aria-label={`Descer o movimento ${index + 1}`} className={iconButtonClass}>
              <ArrowDown className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function LinesHeader({ columns }: { columns: string[] }) {
  return (
    <div aria-hidden="true" className="hidden grid-cols-[6.5rem_minmax(0,1fr)_5.5rem_2.5rem_2.5rem] gap-2 sm:grid">
      {columns.map((column, index) => <span key={`${column}-${index}`} className={labelClass}>{column}</span>)}
    </div>
  );
}

const stepAmount = (step: BuilderStep) => (step.unit === 'reps' ? String(step.reps) : `${step.reps} ${UNIT_WORDS[step.unit].short}`);

function StepsList({ analysis, onToggle, idPrefix }: { analysis: DraftAnalysis; onToggle: (step: BuilderStep) => void; idPrefix: string }) {
  if (analysis.steps.length === 0) {
    return <p className="text-xs text-muted">Nenhuma etapa ainda: preencha repetições e movimento.</p>;
  }
  const rounds = [...new Set(analysis.steps.map((step) => step.ref.round))];
  return (
    <div className="space-y-3">
      {rounds.map((round) => (
        <div key={round} className="space-y-1.5">
          {analysis.rounds > 1 && <p className="text-[10px] font-bold uppercase tracking-widest text-muted">Round {round}</p>}
          <ul className="space-y-1.5">
            {analysis.steps.filter((step) => step.ref.round === round).map((step) => (
              <li
                key={step.key}
                className={`grid grid-cols-[3.5rem_minmax(0,1fr)_auto_2.75rem] items-center gap-2 rounded-md border px-3 py-1 text-sm ${
                  step.marked ? 'border-primary/60 bg-primary/5' : 'border-card-border bg-dark-gray'
                }`}
              >
                <span className="font-number font-bold tabular-nums text-white">{stepAmount(step)}</span>
                <span className="truncate text-white">{step.name}</span>
                <span className="font-number text-xs text-muted">{step.loadKg !== null ? `${String(step.loadKg).replace('.', ',')} kg` : ''}</span>
                <button
                  id={`${idPrefix}-flag-${step.key}`}
                  type="button"
                  onClick={() => onToggle(step)}
                  aria-pressed={step.marked}
                  aria-label={`Marcar o tempo de desempate ao concluir ${stepAmount(step)} ${step.name}${analysis.rounds > 1 ? `, round ${round}` : ''}`}
                  title="Marcar o tempo de desempate aqui"
                  className={`flex min-h-10 min-w-10 items-center justify-center rounded-md border transition-colors ${
                    step.marked ? 'border-primary bg-primary text-ink' : 'border-transparent text-muted hover:border-card-border hover:text-white'
                  }`}
                >
                  <Flag className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// Descanso: listras, como na maquete (a cor vem do tema do painel).
const restStyle = { background: 'repeating-linear-gradient(135deg, var(--card-border) 0 5px, transparent 5px 10px)' };
const restSwatchStyle = { background: 'repeating-linear-gradient(135deg, var(--card-border) 0 3px, transparent 3px 6px)' };

// Linha do tempo do Intervalado (Maquete 1, renderTimeline): um bloco de
// trabalho por round e um de descanso entre eles, sem descanso depois do
// último. A divisão entre fixos e máximo dentro do bloco é só ilustrativa.
function IntervalTimeline({ timing, hasFixed }: { timing: IntervalTiming; hasFixed: boolean }) {
  const { rounds, onSeconds, offSeconds, totalSeconds } = timing;
  const cycle = onSeconds + offSeconds;
  const every = Math.ceil(rounds / 8);
  const ticks: number[] = [];
  for (let round = 1; round <= rounds; round += every) ticks.push((round - 1) * cycle);
  const rest = offSeconds > 0 ? `${formatTimeInput(offSeconds)} de descanso entre eles` : 'sem descanso entre eles';
  return (
    <div>
      <div
        role="img"
        aria-label={`${rounds} rounds de ${formatTimeInput(onSeconds)} de trabalho, ${rest}, ${formatMinutes(totalSeconds)} no total`}
        className="flex h-[34px] overflow-hidden rounded-md border border-card-border bg-dark-gray"
      >
        {Array.from({ length: rounds }, (_, index) => (
          <Fragment key={index}>
            <span className="flex min-w-0" style={{ flex: `${onSeconds} 0 0` }}>
              {hasFixed && <span className="block h-full bg-info" style={{ flex: '45 0 0' }} />}
              <span className="block h-full bg-primary" style={{ flex: '55 0 0' }} />
            </span>
            {index < rounds - 1 && offSeconds > 0 && <span className="block" style={{ flex: `${offSeconds} 0 0`, ...restStyle }} />}
          </Fragment>
        ))}
      </div>
      <div aria-hidden="true" className="relative mt-1 h-[18px] font-number text-[11px] text-muted">
        {ticks.map((at, index) => {
          const left = (at / totalSeconds) * 100;
          // Perto do fim, a marca encostaria na do total em telas estreitas: só aparece a partir de sm.
          const nearEnd = index > 0 && left > 85;
          return (
            <span
              key={at}
              className={`absolute top-0 whitespace-nowrap ${index === 0 ? '' : '-translate-x-1/2'} ${nearEnd ? 'hidden sm:inline' : ''}`}
              style={{ left: `${left}%` }}
            >
              {formatMinutes(at)}
            </span>
          );
        })}
        <span className="absolute top-0 -translate-x-full whitespace-nowrap" style={{ left: '100%' }}>{formatMinutes(totalSeconds)}</span>
      </div>
    </div>
  );
}

function TimelineLegend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted">
      <span className="flex items-center gap-1.5"><span aria-hidden="true" className="h-3 w-3 rounded-[3px] bg-info" />Fixos</span>
      <span className="flex items-center gap-1.5"><span aria-hidden="true" className="h-3 w-3 rounded-[3px] bg-primary" />Máximo</span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden="true" className="h-3 w-3 rounded-[3px] border border-card-border" style={restSwatchStyle} />
        Descanso
      </span>
    </div>
  );
}

export function SheetBuilderForm({ draft, analysis, onChange, openLines, onToggleLine, idPrefix }: SheetBuilderFormProps) {
  const id = (name: string) => `${idPrefix}-${name}`;
  const format = draft.format;
  const ft = draft.forTime;
  const am = draft.amrap;
  const ml = draft.maxLoad;

  // Grupo de opções acessível: um ponto de Tab (o formato escolhido) e as setas trocam a escolha.
  const handleFormatKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const index = FORMATS.findIndex((option) => option.value === format);
    const next = FORMATS[(index + step + FORMATS.length) % FORMATS.length].value;
    onChange(setDraftFormat(draft, next));
    document.getElementById(id(`format-${next}`))?.focus();
  };

  const formatSection = (
    <Section step={1} title="Formato da prova" id={id('format-title')}>
      <div role="radiogroup" aria-labelledby={id('format-title')} onKeyDown={handleFormatKeys} className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        {FORMATS.map((option) => {
          const selected = format === option.value;
          return (
            <button
              key={option.value}
              id={id(`format-${option.value}`)}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(setDraftFormat(draft, option.value))}
              className={`flex min-h-16 flex-col items-start justify-center gap-0.5 rounded-md border px-3 py-2 text-left transition-colors ${
                selected ? 'border-primary bg-primary/10' : 'border-card-border bg-dark-gray hover:border-primary/60'
              }`}
            >
              <span className="flex items-center gap-1.5 text-sm font-bold text-white">
                {selected && <Check className="h-3.5 w-3.5 text-primary" aria-hidden="true" />}
                {option.title}
              </span>
              <span className="text-[11px] text-muted">{option.detail}</span>
            </button>
          );
        })}
      </div>
    </Section>
  );

  const ruleSection = (step: number) => (
    <Section step={step} title="Regra da prova" id={id('rule-title')}>
      <Checklist items={analysis.items} rule={<RuleSentence analysis={analysis} />} />
    </Section>
  );

  const lineList = (list: 'forTime' | 'amrap' | 'interval', lines: BuilderLine[]) => (
    <ul className="space-y-2">
      {lines.map((line, index) => (
        <WorkLine
          key={line.key}
          line={line}
          index={index}
          count={lines.length}
          problem={analysis.lineProblems[line.key]}
          open={openLines.includes(line.key)}
          idPrefix={id(list === 'forTime' ? 'ft' : list === 'amrap' ? 'am' : 'iv')}
          allowSequences={list === 'forTime'}
          minCount={list === 'interval' ? 0 : 1}
          onPatch={(patch) => onChange(updateLine(draft, list, line.key, patch))}
          onRemove={() => onChange(removeLine(draft, list, line.key))}
          onMove={(direction) => onChange(moveLine(draft, list, line.key, direction))}
          onToggle={() => onToggleLine(line.key)}
        />
      ))}
    </ul>
  );

  if (format === 'interval') {
    const iv = draft.interval;
    const timing = analysis.intervalTiming ?? null;
    const timeFields: { name: 'rounds' | 'on' | 'off'; label: string; value: string }[] = [
      { name: 'rounds', label: 'Rounds', value: iv.rounds },
      { name: 'on', label: 'Trabalho · ON (MM:SS)', value: iv.on },
      { name: 'off', label: 'Descanso · OFF (MM:SS)', value: iv.off }
    ];
    const durationProblem = analysis.lineProblems[INTERVAL_FIELDS.duration];
    const fieldProblems = [
      ...timeFields.map((field) => ({ id: id(`iv-${field.name}-problem`), text: analysis.lineProblems[INTERVAL_FIELDS[field.name]] })),
      { id: id('iv-duration-problem'), text: durationProblem }
    ].filter((item): item is { id: string; text: string } => Boolean(item.text));
    const max = iv.max;
    const maxBase = id(`iv-${max.key}`);
    const maxProblem = analysis.lineProblems[max.key];
    const maxOpen = openLines.includes(max.key);
    return (
      <div className="space-y-4">
        {formatSection}
        <Section step={2} title="Rounds e tempos" id={id('iv-time-title')}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {timeFields.map((field) => {
              const fieldId = id(`iv-${field.name}`);
              const problem = analysis.lineProblems[INTERVAL_FIELDS[field.name]];
              return (
                <div key={field.name}>
                  <label htmlFor={fieldId} className={labelClass}>{field.label}</label>
                  <input
                    id={fieldId}
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    value={field.value}
                    aria-invalid={Boolean(problem)}
                    aria-describedby={problem ? `${fieldId}-problem` : undefined}
                    onChange={(event) => onChange(updateIntervalTiming(draft, { [field.name]: event.target.value }))}
                    className={`${inputClass} text-center font-number ${problem ? errorInputClass : ''}`}
                  />
                </div>
              );
            })}
            <div>
              <label htmlFor={id('iv-duration')} className={labelClass}>Duração da prova</label>
              <input
                id={id('iv-duration')}
                type="text"
                readOnly
                value={timing ? formatMinutes(timing.totalSeconds) : '—'}
                aria-invalid={Boolean(durationProblem)}
                aria-describedby={durationProblem ? id('iv-duration-problem') : undefined}
                className={`${inputClass} cursor-default text-center font-number text-muted ${durationProblem ? errorInputClass : ''}`}
              />
            </div>
          </div>
          {fieldProblems.map((problem) => (
            <p key={problem.id} id={problem.id} className="text-[11px] font-semibold text-trading-down">{problem.text}</p>
          ))}
          {timing && <IntervalTimeline timing={timing} hasFixed={iv.lines.length > 0} />}
          <TimelineLegend />
          <p className="text-[11px] leading-relaxed text-muted">Sem descanso depois do último round. Com OFF em 00:00 os rounds ficam colados (EMOM).</p>
        </Section>
        <Section step={3} title="Trabalho de cada round" id={id('iv-work-title')}>
          <LinesHeader columns={['Repetições', 'Movimento', 'Carga (kg)', '', '']} />
          {lineList('interval', iv.lines)}
          <div className="space-y-1.5">
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-[6.5rem_minmax(0,1fr)_5.5rem_2.5rem_2.5rem]">
              <input
                id={`${maxBase}-reps`}
                type="text"
                value="Máx."
                disabled
                readOnly
                aria-label="Repetições do movimento máximo: sem meta"
                className="w-full min-w-0 cursor-not-allowed rounded-md border border-primary bg-dark-gray px-3 py-2 text-center font-number text-sm font-bold text-primary"
              />
              <input
                id={`${maxBase}-name`}
                type="text"
                autoComplete="off"
                placeholder="Movimento máximo"
                maxLength={WORKOUT_STRUCTURE_LIMITS.maxNameLength}
                aria-label="Movimento máximo"
                aria-invalid={Boolean(maxProblem)}
                aria-describedby={maxProblem ? `${maxBase}-problem` : undefined}
                value={max.name}
                onChange={(event) => onChange(updateIntervalMax(draft, { name: event.target.value }))}
                className={`${inputClass} order-first col-span-4 sm:order-none sm:col-span-1 ${maxProblem && !max.name.trim() ? errorInputClass : ''}`}
              />
              <input
                id={`${maxBase}-load`}
                type="text"
                autoComplete="off"
                inputMode="decimal"
                placeholder="kg"
                aria-label="Carga do movimento máximo em kg"
                value={max.load}
                onChange={(event) => onChange(updateIntervalMax(draft, { load: event.target.value }))}
                className={`${inputClass} text-center font-number`}
              />
              <button
                type="button"
                onClick={() => onToggleLine(max.key)}
                aria-expanded={maxOpen}
                aria-controls={`${maxBase}-more`}
                aria-label="Mais opções do movimento máximo"
                title="Mais opções"
                className={`${iconButtonClass} ${maxOpen ? 'border-primary/60 text-primary' : ''}`}
              >
                <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            {maxProblem && <p id={`${maxBase}-problem`} className="text-[11px] font-semibold text-trading-down">{maxProblem}</p>}
            {maxOpen && (
              <div id={`${maxBase}-more`} className="rounded-md border border-dashed border-card-border p-3">
                <label htmlFor={`${maxBase}-note`} className={labelClass}>Padrão do movimento (opcional)</label>
                <input
                  id={`${maxBase}-note`}
                  type="text"
                  autoComplete="off"
                  maxLength={WORKOUT_STRUCTURE_LIMITS.maxNoteLength}
                  value={max.note}
                  onChange={(event) => onChange(updateIntervalMax(draft, { note: event.target.value }))}
                  className={inputClass}
                />
              </div>
            )}
          </div>
          <button type="button" id={id('iv-add')} onClick={() => onChange(addLine(draft, 'interval'))} disabled={iv.lines.length >= MAX_INTERVAL_FIXED_LINES} className={textButtonClass}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Movimento
          </button>
          <p className="text-[11px] leading-relaxed text-muted">
            O movimento máximo fica sempre por último e não tem meta: o judge conta até o fim da janela. A carga é uma por linha; 80 kg e 55 kg viram duas provas, uma por categoria (campo &quot;Categoria vinculada&quot;), como hoje.
          </p>
        </Section>
        <Section step={4} title="Pontuação" id={id('iv-score-title')}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={id('iv-score')} className={labelClass}>Score</label>
              <input id={id('iv-score')} type="text" disabled readOnly value="Soma das repetições do máximo" className={inputClass} />
            </div>
            <div>
              <label htmlFor={id('iv-tiebreak')} className={labelClass}>Desempate</label>
              <input id={id('iv-tiebreak')} type="text" disabled readOnly value="Sem desempate" className={inputClass} />
            </div>
          </div>
          <p className="text-[11px] leading-relaxed text-muted">Round em que os movimentos fixos não terminam dentro da janela vale 0 no máximo. Empates dividem a posição.</p>
        </Section>
        {ruleSection(5)}
      </div>
    );
  }

  if (format === 'max_load') {
    return (
      <div className="space-y-4">
        {formatSection}
        <Section step={2} title="Movimentos de carga" id={id('lifts-title')}>
          <div aria-hidden="true" className="hidden grid-cols-[6.5rem_minmax(0,1fr)_7rem_8rem_2.5rem] gap-2 sm:grid">
            {['Reps / tentativa', 'Movimento', 'Carga inicial (kg)', 'Tentativas', ''].map((column, index) => (
              <span key={index} className={labelClass}>{column}</span>
            ))}
          </div>
          <ul className="space-y-2">
            {ml.lifts.map((lift: BuilderLift, index) => {
              const base = id(`ml-${lift.key}`);
              const problem = analysis.lineProblems[lift.key];
              return (
                <li key={lift.key} className="space-y-1.5">
                  <div className="grid grid-cols-4 gap-2 sm:grid-cols-[6.5rem_minmax(0,1fr)_7rem_8rem_2.5rem]">
                    <input
                      id={`${base}-reps`}
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder="1"
                      aria-label={`Repetições por tentativa do movimento ${index + 1}`}
                      value={lift.reps}
                      onChange={(event) => onChange(updateLift(draft, lift.key, { reps: event.target.value }))}
                      className={`${inputClass} text-center font-number`}
                    />
                    <input
                      id={`${base}-name`}
                      type="text"
                      autoComplete="off"
                      placeholder="Movimento"
                      maxLength={WORKOUT_STRUCTURE_LIMITS.maxNameLength}
                      aria-label={`Movimento ${index + 1}`}
                      aria-invalid={Boolean(problem)}
                      aria-describedby={problem ? `${base}-problem` : undefined}
                      value={lift.name}
                      onChange={(event) => onChange(updateLift(draft, lift.key, { name: event.target.value }))}
                      className={`${inputClass} order-first col-span-4 sm:order-none sm:col-span-1 ${problem && !lift.name.trim() ? errorInputClass : ''}`}
                    />
                    <input
                      id={`${base}-load`}
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="kg"
                      aria-label={`Carga inicial do movimento ${index + 1} em kg`}
                      value={lift.load}
                      onChange={(event) => onChange(updateLift(draft, lift.key, { load: event.target.value }))}
                      className={`${inputClass} text-center font-number`}
                    />
                    <select
                      id={`${base}-attempts`}
                      aria-label={`Tentativas do movimento ${index + 1}`}
                      value={lift.attempts}
                      onChange={(event) => onChange(updateLift(draft, lift.key, { attempts: event.target.value as BuilderLift['attempts'] }))}
                      className={inputClass}
                    >
                      <option value="1">1 tentativa</option>
                      <option value="2">2 tentativas</option>
                      <option value="3">3 tentativas</option>
                      <option value="unlimited">Ilimitadas</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => onChange(removeLift(draft, lift.key))}
                      disabled={ml.lifts.length <= 1}
                      aria-label={`Remover o movimento ${index + 1}`}
                      className={iconButtonClass}
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                  {problem && <p id={`${base}-problem`} className="text-[11px] font-semibold text-trading-down">{problem}</p>}
                </li>
              );
            })}
          </ul>
          <button type="button" id={id('ml-add')} onClick={() => onChange(addLift(draft))} disabled={ml.lifts.length >= WORKOUT_STRUCTURE_LIMITS.maxLifts} className={textButtonClass}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Movimento
          </button>
          <p className="text-[11px] leading-relaxed text-muted">
            1 repetição por tentativa é um 1RM; 3 é um 3RM. A carga inicial é a da primeira tentativa (opcional); depois o judge registra a carga de cada tentativa. Para um complexo, escreva o complexo no movimento (ex.: &quot;Clean + Jerk&quot;).
          </p>
        </Section>
        <Section step={3} title="Regras e pontuação" id={id('ml-rules-title')}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={id('ml-order')} className={labelClass}>Ordem dos movimentos</label>
              <select id={id('ml-order')} value={ml.order} onChange={(event) => onChange({ ...draft, maxLoad: { ...ml, order: event.target.value as SheetDraft['maxLoad']['order'] } })} className={inputClass}>
                <option value="fixed">Fixa, na ordem da lista</option>
                <option value="free">Livre</option>
              </select>
            </div>
            <div>
              <label htmlFor={id('ml-window')} className={labelClass}>Janela de tempo (MM:SS, vazio = sem janela)</label>
              <input id={id('ml-window')} type="text" inputMode="numeric" autoComplete="off" placeholder="sem janela" value={ml.window} onChange={(event) => onChange({ ...draft, maxLoad: { ...ml, window: event.target.value } })} className={`${inputClass} font-number`} />
            </div>
            <div>
              <label htmlFor={id('ml-scoring')} className={labelClass}>Score</label>
              <select id={id('ml-scoring')} value={ml.scoring} onChange={(event) => onChange({ ...draft, maxLoad: { ...ml, scoring: event.target.value as SheetDraft['maxLoad']['scoring'] } })} className={inputClass}>
                <option value="sum">Soma das melhores cargas</option>
                <option value="best">Maior carga única</option>
              </select>
            </div>
            <div>
              <label htmlFor={id('ml-step')} className={labelClass}>Incremento mínimo (kg)</label>
              <input id={id('ml-step')} type="text" inputMode="decimal" autoComplete="off" value={ml.step} onChange={(event) => onChange({ ...draft, maxLoad: { ...ml, step: event.target.value } })} className={`${inputClass} font-number`} />
            </div>
          </div>
          <div>
            <label htmlFor={id('ml-tiebreak')} className={labelClass}>Desempate</label>
            <select id={id('ml-tiebreak')} value={ml.tieBreak} onChange={(event) => onChange({ ...draft, maxLoad: { ...ml, tieBreak: event.target.value as MaxLoadTieBreakMode } })} className={inputClass}>
              <option value="finish_time">Tempo em que terminou o último movimento</option>
              <option value="fewest_attempts">Menos tentativas</option>
              <option value="none">Sem desempate</option>
            </select>
            {ml.tieBreak === 'fewest_attempts' && (
              <p className="mt-1 text-[10px] leading-relaxed text-muted">O lançamento manual de scores só desempata por tempo; menos tentativas vale pela súmula.</p>
            )}
          </div>
        </Section>
        {ruleSection(4)}
      </div>
    );
  }

  if (format === 'amrap') {
    return (
      <div className="space-y-4">
        {formatSection}
        <Section step={2} title="Um round" id={id('am-title')}>
          <LinesHeader columns={['Repetições', 'Movimento', 'Carga (kg)', '', '']} />
          {lineList('amrap', am.lines)}
          <button type="button" id={id('am-add')} onClick={() => onChange(addLine(draft, 'amrap'))} disabled={am.lines.length >= MAX_BUILDER_LINES} className={textButtonClass}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Movimento
          </button>
          <p className="text-[11px] leading-relaxed text-muted">
            As linhas descrevem um round, com um número por movimento (vale 30 cal ou 200 m). O judge conta o round em andamento; ao concluir a última linha, o round fecha e a contagem recomeça.
          </p>
        </Section>
        <Section step={3} title="Pontuação" id={id('am-score-title')}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={id('am-duration')} className={labelClass}>Duração (MM:SS)</label>
              <input id={id('am-duration')} type="text" inputMode="numeric" autoComplete="off" value={am.duration} onChange={(event) => onChange({ ...draft, amrap: { ...am, duration: event.target.value } })} className={`${inputClass} font-number`} />
            </div>
            <div>
              <label htmlFor={id('am-display')} className={labelClass}>Score exibido</label>
              <select id={id('am-display')} value={am.scoreDisplay} onChange={(event) => onChange({ ...draft, amrap: { ...am, scoreDisplay: event.target.value as SheetDraft['amrap']['scoreDisplay'] } })} className={inputClass}>
                <option value="rounds_reps">Rounds + repetições</option>
                <option value="total">Total de repetições</option>
              </select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={id('am-tiebreak')} className={labelClass}>Desempate</label>
              <select
                id={id('am-tiebreak')}
                value={am.tieBreak}
                onChange={(event) => onChange({ ...draft, amrap: { ...am, tieBreak: event.target.value as AmrapTieBreakMode } })}
                className={inputClass}
              >
                <option value="none">Sem desempate</option>
                <option value="last_round">Tempo do último round completo</option>
                <option value="split">Tempo em um marco do 1º round</option>
              </select>
            </div>
            {am.tieBreak === 'split' && (
              <div>
                <label htmlFor={id('am-mark')} className={labelClass}>Marco do 1º round</label>
                <select
                  id={id('am-mark')}
                  value={am.markLine ?? ''}
                  onChange={(event) => onChange({ ...draft, amrap: { ...am, markLine: event.target.value || null } })}
                  className={inputClass}
                >
                  <option value="">Escolha o movimento</option>
                  {am.lines.map((line, index) => (
                    <option key={line.key} value={line.key}>{index + 1}. {line.name.trim() || 'Sem nome'}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <p className="text-[11px] leading-relaxed text-muted">O ranking compara o total de repetições; a forma de exibir vale para a súmula.</p>
        </Section>
        {ruleSection(4)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {formatSection}
      <Section step={2} title="Trabalho da prova" id={id('ft-title')}>
        <LinesHeader columns={['Repetições', 'Movimento', 'Carga (kg)', '', '']} />
        {lineList('forTime', ft.lines)}
        <button type="button" id={id('ft-add')} onClick={() => onChange(addLine(draft, 'forTime'))} disabled={ft.lines.length >= MAX_BUILDER_LINES} className={textButtonClass}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Movimento
        </button>
        <div className="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)] sm:items-end">
          <div>
            <label htmlFor={id('ft-rounds')} className={labelClass}>Rounds</label>
            <input
              id={id('ft-rounds')}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={analysis.derivedRounds !== null ? String(analysis.derivedRounds) : ft.rounds}
              readOnly={analysis.derivedRounds !== null}
              aria-describedby={id('ft-rounds-note')}
              onChange={(event) => onChange({ ...draft, forTime: { ...ft, rounds: event.target.value } })}
              className={`${inputClass} text-center font-number read-only:cursor-not-allowed read-only:opacity-60`}
            />
          </div>
          <p id={id('ft-rounds-note')} className="text-[11px] text-muted">
            {analysis.derivedRounds !== null
              ? `Definido pela sequência de repetições (${analysis.derivedRounds} rounds).`
              : 'Quantas vezes as linhas se repetem.'}
          </p>
        </div>
        <p className="text-[11px] leading-relaxed text-muted">
          No campo de repetições vale um número (50), uma quantidade por round (21-15-9), rounds iguais (3x10) e a unidade no fim (500 m, 30 cal). Um número sozinho se repete em todos os rounds.
        </p>
      </Section>
      <Section step={3} title="Como fica na súmula" id={id('ft-steps-title')}>
        <div className="max-w-sm">
          <label htmlFor={id('ft-tiebreak')} className={labelClass}>Desempate</label>
          <select
            id={id('ft-tiebreak')}
            value={ft.tieBreak}
            onChange={(event) => onChange(setForTimeTieBreak(draft, event.target.value as ForTimeTieBreakMode))}
            className={inputClass}
          >
            <option value="none">Sem desempate</option>
            <option value="split">Tempo em um marco</option>
            <option value="last_split">Tempo do último marco concluído</option>
          </select>
        </div>
        <StepsList analysis={analysis} idPrefix={id('ft')} onToggle={(step) => onChange(toggleStepMark(draft, step.ref))} />
        <p className="text-[11px] leading-relaxed text-muted">
          Etapas geradas a partir das linhas, na ordem em que o judge vai marcar. A bandeira escolhe onde o judge anota o tempo do desempate
          {ft.tieBreak === 'last_split' ? '; com várias bandeiras, vale o tempo da última concluída (como no Open).' : '.'}
        </p>
      </Section>
      <Section step={4} title="Pontuação" id={id('ft-score-title')}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={id('ft-cap')} className={labelClass}>Time cap (MM:SS)</label>
            <input id={id('ft-cap')} type="text" inputMode="numeric" autoComplete="off" value={ft.cap} onChange={(event) => onChange({ ...draft, forTime: { ...ft, cap: event.target.value } })} className={`${inputClass} font-number`} />
          </div>
          <div>
            <label htmlFor={id('ft-penalty')} className={labelClass}>Penalidade por repetição (s)</label>
            <input id={id('ft-penalty')} type="text" inputMode="numeric" autoComplete="off" value={ft.penalty} onChange={(event) => onChange({ ...draft, forTime: { ...ft, penalty: event.target.value } })} className={`${inputClass} font-number`} />
          </div>
        </div>
      </Section>
      {ruleSection(5)}
    </div>
  );
}
