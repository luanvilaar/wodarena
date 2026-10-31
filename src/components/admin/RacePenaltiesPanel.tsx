'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Clock, ExternalLink, History, Pencil, Search, Undo2, UserX, X } from 'lucide-react';

import {
  RaceDecisionDialog,
  postRaceDecision,
  raceButton,
  raceInput,
  type RaceDecisionResult
} from '@/components/admin/RaceDecisionDialog';
import {
  RACE_DECISION_LABELS,
  RACE_PENALTY_STATUSES,
  RACE_PENALTY_STATUS_LABELS,
  RACE_RUN_STATUS_LABELS,
  countRacePenaltiesByStatus,
  describeRaceNoTimeReason,
  filterRacePenalties,
  formatRaceDuration,
  formatRacePenalty,
  listNoTimeRuns,
  matchesRaceAthlete,
  parseRaceDuration,
  previewRaceOfficial,
  raceRunActions,
  type RaceManageDecision,
  type RaceManagePenalty,
  type RaceManageRunStatus,
  type RacePenaltyStatus,
  type RaceClosingStationSnapshot
} from '@/lib/racePenaltiesView';
import type { RaceRulePresetId } from '@/lib/raceRulePresets';
import { formatRaceClock } from '@/lib/raceWaves';
import type { Event } from '@/types';

// Painel do organizador da súmula Fitness Race (Story 1.98; maquete aprovada
// telas/painel-organizador.html, D23). Pelo D2 as penalidades já valem quando
// nascem: o painel é de revisão e ajuste. "Sem tempo fechado" (D22, com a marca
// "Atleta saiu", D24), penalidades com busca e filtros (alterar e revogar, para
// corrigir uma penalidade dada errado) e corridas (ajustar tempo, DNF). Não há
// DQ, lançamento de infração geral nem escolha de regulamento (decisão do
// organizador do produto em 2026-10-30): o caso grave é DNF. Cartões altos em
// toda largura, sem tabela com rolagem lateral (D20). Consulta periódica de
// 20 s, no padrão do ScoresheetsPanel (o projeto não tem Realtime).

const REFRESH_MS = 20_000;

type ManageRun = {
  id: string;
  status: RaceManageRunStatus;
  startedAt: string | null;
  finishAt: string | null;
  grossSeconds: number | null;
  penaltySeconds: number;
  officialSeconds: number | null;
  timeSource: 'sheet' | 'manual' | null;
  athleteId: string;
  athleteName: string;
  box: string;
  divisionId: string | null;
  divisionName: string;
  heatId: string | null;
  heatTitle: string;
  closingStation: RaceClosingStationSnapshot;
};

type ManageRuleset = {
  id: string;
  version: number;
  preset: RaceRulePresetId | 'custom';
  name: string;
  verified: boolean;
  lockedAt: string | null;
  used: boolean;
  general: { code: string; label: string; seconds: number }[];
};

export type RaceManagePayload = {
  event: { id: string; name: string; timeZone: string };
  divisions: { id: string; name: string }[];
  runs: ManageRun[];
  penalties: RaceManagePenalty[];
  decisions: RaceManageDecision[];
  ruleset: ManageRuleset | null;
};

type Modal =
  | { kind: 'revoke'; penalty: RaceManagePenalty }
  | { kind: 'alter'; penalty: RaceManagePenalty }
  | { kind: 'adjust' | 'dnf' | 'undnf'; run: ManageRun };

type Notice = { tone: 'ok' | 'warn' | 'error'; text: string; retryRunIds?: string[] };

const chip = (tone: string) => `inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold ${tone}`;
const STATUS_TONE: Record<RacePenaltyStatus, string> = {
  confirmed: 'border-primary/60 text-primary',
  pending: 'border-amber-400/60 text-amber-300',
  revoked: 'border-card-border text-muted line-through',
  cancelled: 'border-card-border text-muted'
};

/** Atalho "Lançar à mão": abre a aba "Lançar Resultados" do evento sem mexer em admin/page.tsx. */
const openManualResultsTab = () => {
  if (typeof document === 'undefined') return false;
  const select = document.getElementById('admin-event-tabs-select') as HTMLSelectElement | null;
  const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.trim() === 'Lançar Resultados');
  if (button) {
    button.click();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return true;
  }
  return Boolean(select);
};

/** Tempo oficial previsto ao restaurar (desfazer DNF), pelo `before` da decisão de origem. */
const restorePreview = (run: ManageRun, decisions: RaceManageDecision[], actions: string[]) => {
  const origin = [...decisions]
    .filter((item) => item.runId === run.id && actions.includes(item.action) && item.before && item.before.status !== run.status)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const before = origin?.before;
  if (!before || before.status !== 'finished') return null;
  const gross = typeof before.gross_seconds === 'number' ? before.gross_seconds : null;
  return previewRaceOfficial(gross, run.penaltySeconds);
};

function SectionHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">{eyebrow}</p>
        <h3 className="text-lg font-bold uppercase">{title}</h3>
        {description && <p className="text-xs text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

function DecisionLog({ items, origin, timeZone }: { items: RaceManageDecision[]; origin: string; timeZone: string }) {
  return (
    <div className="space-y-1 rounded-md border border-card-border bg-black/20 p-3 text-xs">
      <p className="text-muted">{origin}</p>
      {items.length === 0 ? <p className="text-muted">Nenhuma decisão registrada.</p> : items.map((item) => (
        <p key={item.id} className="break-words">
          <span className="font-bold">{RACE_DECISION_LABELS[item.action] ?? item.action}</span>
          {` por ${item.actorName} às `}
          <span className="tabular-nums">{formatRaceClock(item.createdAt, timeZone)}</span>
          {item.reason ? `. Motivo: “${item.reason}”` : ''}
        </p>
      ))}
    </div>
  );
}

/** `initialPayload`: dados já carregados (renderização no servidor e testes); a consulta periódica segue igual. */
export function RacePenaltiesPanel({ event, initialPayload = null }: { event: Event; initialPayload?: RaceManagePayload | null }) {
  const [payload, setPayload] = useState<RaceManagePayload | null>(initialPayload);
  const [loadError, setLoadError] = useState('');
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [status, setStatus] = useState<RacePenaltyStatus>('confirmed');
  const [query, setQuery] = useState('');
  const [divisionId, setDivisionId] = useState('');
  const [modal, setModal] = useState<Modal | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [openLog, setOpenLog] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/race-sheets?view=manage&eventId=${encodeURIComponent(event.id)}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Erro ao carregar o painel.');
      setPayload(data as RaceManagePayload);
      setLoadError('');
      setUpdatedAt(new Date().toISOString());
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : 'Erro ao carregar o painel.');
    }
  }, [event.id]);

  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    const interval = window.setInterval(() => void load(), REFRESH_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(interval);
    };
  }, [load]);

  const afterDecision = useCallback(async (result: RaceDecisionResult) => {
    setModal(null);
    if (result.republish && !result.republish.ok) {
      setNotice({ tone: 'warn', text: result.republish.warning || 'Decisão gravada, mas o resultado não foi atualizado.', retryRunIds: result.republish.failedRunIds });
    } else {
      setNotice({ tone: 'ok', text: 'Decisão gravada.' });
    }
    await load();
  }, [load]);

  const decide = useCallback(async (body: Record<string, unknown>) => {
    await afterDecision(await postRaceDecision({ eventId: event.id, ...body }));
  }, [afterDecision, event.id]);

  const retry = async (runIds: string[]) => {
    try {
      await decide({ action: 'republish_run', runIds });
    } catch (cause) {
      setNotice({ tone: 'warn', text: cause instanceof Error ? cause.message : 'Não foi possível atualizar o resultado.', retryRunIds: runIds });
    }
  };

  const timeZone = payload?.event.timeZone;
  const clock = useCallback((iso: string | null) => (iso ? formatRaceClock(iso, timeZone) : '—'), [timeZone]);
  const penalties = useMemo(() => payload?.penalties ?? [], [payload]);
  const runById = useMemo(() => new Map((payload?.runs ?? []).map((run) => [run.id, run])), [payload]);
  const decisions = useMemo(() => payload?.decisions ?? [], [payload]);
  const visiblePenalties = useMemo(() => filterRacePenalties(penalties, { status, query, divisionId }), [penalties, status, query, divisionId]);
  const counts = useMemo(() => countRacePenaltiesByStatus(penalties, query, divisionId), [penalties, query, divisionId]);
  const noTimeRuns = useMemo(() => listNoTimeRuns(payload?.runs ?? []), [payload]);
  const visibleRuns = useMemo(() => (payload?.runs ?? []).filter((run) => (!divisionId || run.divisionId === divisionId) && matchesRaceAthlete(run.athleteName, query)), [payload, divisionId, query]);

  if (loadError && !payload) return <p role="alert" className="rounded-md border border-red-500/40 bg-red-950/20 px-3 py-2 text-sm">{loadError}</p>;
  if (!payload) return <p role="status" className="text-sm text-muted">Carregando o painel da corrida…</p>;

  const toggleLog = (id: string) => setOpenLog((current) => ({ ...current, [id]: !current[id] }));
  const runLabel = (run: ManageRun | undefined) => (run ? [run.divisionName, run.heatTitle].filter(Boolean).join(' · ') : '');

  return (
    <div className="space-y-6">
      {notice && (
        <div role={notice.tone === 'ok' ? 'status' : 'alert'} className={`flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm ${notice.tone === 'ok' ? 'border-trading-up/50 bg-trading-up/10' : 'border-amber-400/50 bg-amber-950/30'}`}>
          <span>{notice.text}</span>
          <div className="flex gap-2">
            {notice.retryRunIds?.length ? (
              <button type="button" className={raceButton} onClick={() => void retry(notice.retryRunIds as string[])}>
                <Undo2 className="h-4 w-4" aria-hidden="true" /> Tentar de novo
              </button>
            ) : null}
            <button type="button" className={raceButton} onClick={() => setNotice(null)} aria-label="Fechar aviso"><X className="h-4 w-4" aria-hidden="true" /></button>
          </div>
        </div>
      )}

      {/* Sem tempo fechado (AC9) */}
      <section className="space-y-4 rounded-xl border border-card-border bg-card p-5" aria-label="Sem tempo fechado">
        <SectionHeader eyebrow="Pede sua decisão" title="Sem tempo fechado" description="A onda largou, mas a última estação não liberou o atleta. A súmula não inventa tempo: lance pelo fluxo manual, ajuste aqui ou marque DNF." />
        {noTimeRuns.length === 0 ? <p className="text-sm text-muted">Todas as corridas que largaram têm tempo fechado.</p> : (
          <ul className="grid gap-3 xl:grid-cols-2">
            {noTimeRuns.map((run) => (
              <li key={run.id} className="min-w-0 space-y-3 rounded-lg border border-card-border bg-dark-gray p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="break-words font-bold">{run.athleteName}</p>
                    <p className="text-xs text-muted">{runLabel(run)} · largou às <span className="tabular-nums">{clock(run.startedAt)}</span></p>
                  </div>
                  <span className={chip('border-card-border text-muted')}>Em corrida</span>
                </div>
                <p className="break-words text-sm">{describeRaceNoTimeReason(run.closingStation, (iso) => formatRaceClock(iso, timeZone))}</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={raceButton} onClick={() => { if (!openManualResultsTab()) setNotice({ tone: 'warn', text: 'Abra a aba "Lançar Resultados" do evento para lançar à mão.' }); }}>
                    <ExternalLink className="h-4 w-4" aria-hidden="true" /> Lançar à mão
                  </button>
                  <button type="button" className={raceButton} onClick={() => setModal({ kind: 'adjust', run })}><Clock className="h-4 w-4" aria-hidden="true" /> Ajustar tempo</button>
                  <button type="button" className={raceButton} onClick={() => setModal({ kind: 'dnf', run })}><UserX className="h-4 w-4" aria-hidden="true" /> Marcar DNF</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Penalidades (AC1 a AC4) */}
      <section className="space-y-4 rounded-xl border border-card-border bg-card p-5" aria-label="Penalidades">
        <SectionHeader eyebrow="Súmula Fitness Race" title="Penalidades" description="Penalidade dada errado por um árbitro? Altere os segundos ou revogue, com motivo; fica no registro." />
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <label className="relative block">
            <span className="sr-only">Buscar atleta</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar atleta" className={`${raceInput} pl-9`} type="search" />
          </label>
          <label className="block">
            <span className="sr-only">Categoria</span>
            <select value={divisionId} onChange={(event) => setDivisionId(event.target.value)} className={raceInput}>
              <option value="">Todas as categorias</option>
              {payload.divisions.map((division) => <option key={division.id} value={division.id}>{division.name}</option>)}
            </select>
          </label>
        </div>
        <p className="text-xs text-muted"><Clock className="mr-1 inline h-3 w-3" aria-hidden="true" />Atualizado às {updatedAt ? clock(updatedAt) : '—'} · atualiza a cada 20 s</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Situação das penalidades">
          {RACE_PENALTY_STATUSES.map((item) => (
            <button key={item} type="button" aria-pressed={status === item} onClick={() => setStatus(item)} className={`${raceButton} ${status === item ? 'border-primary text-primary' : ''}`}>
              {RACE_PENALTY_STATUS_LABELS[item]} <span className="tabular-nums text-muted">{counts[item]}</span>
            </button>
          ))}
        </div>
        {visiblePenalties.length === 0 ? (
          <p className="text-sm text-muted">{query ? `Nenhuma penalidade para "${query}" nesta situação.` : 'Nenhuma penalidade nesta situação.'}</p>
        ) : (
          <ul className="grid gap-3 xl:grid-cols-2">
            {visiblePenalties.map((item) => {
              const editable = item.status === 'confirmed' && (item.kind === 'penalty' || item.kind === 'warning');
              const log = decisions.filter((decision) => decision.infractionId === item.id);
              return (
                <li key={item.id} className="min-w-0 space-y-3 rounded-lg border border-card-border bg-dark-gray p-4" data-penalty-card>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="break-words font-bold">{item.athleteName}</p>
                      <p className="text-xs text-muted">{[runLabel(runById.get(item.runId)), item.stationName].filter(Boolean).join(' · ')}</p>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <span className={chip(STATUS_TONE[item.status])}>{item.status === 'confirmed' ? (item.kind === 'warning' || item.seconds === 0 ? 'Advertência' : 'Vigente') : RACE_PENALTY_STATUS_LABELS[item.status]}</span>
                      {item.altered && <span className={chip('border-sky-400/60 text-sky-300')}>Alterada</span>}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="min-w-0 break-words text-sm">{item.label}{item.kind === 'warning' || (item.status === 'confirmed' && item.seconds === 0) ? ' · advertência, não soma' : ''}</p>
                    <p className="text-lg font-bold tabular-nums">
                      {item.originalSeconds !== null && item.originalSeconds !== item.seconds && <span className="mr-2 text-sm text-muted line-through">{item.originalSeconds} s</span>}
                      {item.seconds} s
                    </p>
                  </div>
                  {item.note && <p className="break-words text-xs text-muted">Observação: {item.note}</p>}
                  <p className="text-xs text-muted">Lançada por {item.createdByName} às <span className="tabular-nums">{clock(item.createdAt)}</span></p>
                  <div className="flex flex-wrap gap-2">
                    {editable && <button type="button" className={raceButton} onClick={() => setModal({ kind: 'alter', penalty: item })}><Pencil className="h-4 w-4" aria-hidden="true" /> Alterar</button>}
                    {editable && <button type="button" className={raceButton} onClick={() => setModal({ kind: 'revoke', penalty: item })}><Undo2 className="h-4 w-4" aria-hidden="true" /> Revogar</button>}
                    <button type="button" className={raceButton} aria-expanded={Boolean(openLog[item.id])} onClick={() => toggleLog(item.id)}>
                      <History className="h-4 w-4" aria-hidden="true" /> Registro{log.length ? ` (${log.length})` : ''}
                    </button>
                  </div>
                  {openLog[item.id] && <DecisionLog items={log} origin={`Lançada por ${item.createdByName} às ${clock(item.createdAt)}.`} timeZone={payload.event.timeZone} />}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Corridas (AC7, AC8) */}
      <section className="space-y-4 rounded-xl border border-card-border bg-card p-5" aria-label="Corridas">
        <SectionHeader eyebrow="Tempo oficial" title="Corridas" description="Bruto = largada da onda até a liberação da última estação (D34). Oficial = bruto + penalidades vigentes. A busca e a categoria acima também filtram aqui." />
        {visibleRuns.length === 0 ? <p className="text-sm text-muted">Nenhuma corrida aberta ainda. As corridas nascem na largada da onda.</p> : (
          <ul className="grid gap-3 xl:grid-cols-2">
            {visibleRuns.map((run) => {
              const actions = raceRunActions(run.status);
              const log = decisions.filter((decision) => decision.runId === run.id && !decision.infractionId);
              const noTime = run.status === 'dnf';
              return (
                <li key={run.id} className="min-w-0 space-y-3 rounded-lg border border-card-border bg-dark-gray p-4" data-run-card={run.status}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="break-words font-bold">{run.athleteName}</p>
                      <p className="text-xs text-muted">{runLabel(run)}</p>
                    </div>
                    <span className={chip(run.status === 'finished' ? 'border-trading-up/60 text-trading-up' : 'border-card-border text-muted')}>{RACE_RUN_STATUS_LABELS[run.status]}</span>
                  </div>
                  <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                    <div><dt className="text-xs text-muted">Bruto</dt><dd className="tabular-nums">{noTime ? '—' : formatRaceDuration(run.grossSeconds)}</dd></div>
                    <div><dt className="text-xs text-muted">Penalidades</dt><dd className="tabular-nums">{run.penaltySeconds ? `+${formatRacePenalty(run.penaltySeconds)}` : '—'}</dd></div>
                    <div><dt className="text-xs text-muted">Oficial</dt><dd className="font-bold tabular-nums">{formatRaceDuration(run.officialSeconds)}</dd></div>
                    <div><dt className="text-xs text-muted">Origem</dt><dd>{run.timeSource === 'manual' ? 'Lançado à mão' : run.timeSource === 'sheet' ? 'Súmula' : '—'}</dd></div>
                  </dl>
                  <div className="flex flex-wrap gap-2">
                    {actions.adjustTime && <button type="button" className={raceButton} onClick={() => setModal({ kind: 'adjust', run })}><Clock className="h-4 w-4" aria-hidden="true" /> Ajustar tempo</button>}
                    {actions.markDnf && <button type="button" className={raceButton} onClick={() => setModal({ kind: 'dnf', run })}><UserX className="h-4 w-4" aria-hidden="true" /> Marcar DNF</button>}
                    {actions.undoDnf && <button type="button" className={raceButton} onClick={() => setModal({ kind: 'undnf', run })}><Undo2 className="h-4 w-4" aria-hidden="true" /> Desfazer DNF</button>}
                    <button type="button" className={raceButton} aria-expanded={Boolean(openLog[run.id])} onClick={() => toggleLog(run.id)}>
                      <History className="h-4 w-4" aria-hidden="true" /> Registro{log.length ? ` (${log.length})` : ''}
                    </button>
                  </div>
                  {openLog[run.id] && <DecisionLog items={log} origin={`Corrida aberta na largada${run.heatTitle ? ` da ${run.heatTitle}` : ''}.`} timeZone={payload.event.timeZone} />}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {modal && (
        <PanelModal
          modal={modal}
          payload={payload}
          runById={runById}
          decide={decide}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

function PanelModal({ modal, payload, runById, decide, onClose }: {
  modal: Modal;
  payload: RaceManagePayload;
  runById: Map<string, ManageRun>;
  decide: (body: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
}) {
  const [seconds, setSeconds] = useState(modal.kind === 'alter' ? String(modal.penalty.seconds) : '');
  const [label, setLabel] = useState(modal.kind === 'alter' ? modal.penalty.label : '');
  const [gross, setGross] = useState(modal.kind === 'adjust' ? (modal.run.grossSeconds !== null ? formatRaceDuration(Math.round(modal.run.grossSeconds)) : '') : '');
  const runSubtitle = (run: ManageRun | undefined) => (run ? [run.athleteName, run.divisionName, run.heatTitle].filter(Boolean).join(' · ') : '');

  if (modal.kind === 'revoke' || modal.kind === 'alter') {
    const item = modal.penalty;
    const run = runById.get(item.runId);
    const official = run?.officialSeconds ?? null;
    const nextSeconds = Number(seconds);
    const after = official === null ? null : modal.kind === 'revoke' ? official - item.seconds : official - item.seconds + (Number.isFinite(nextSeconds) ? nextSeconds : item.seconds);
    return (
      <RaceDecisionDialog
        title={modal.kind === 'revoke' ? 'Revogar penalidade' : 'Alterar penalidade'}
        subtitle={`${runSubtitle(run)} · ${item.stationName} · ${item.label} · ${item.seconds} s · lançada por ${item.createdByName}`}
        reasonLabel={modal.kind === 'revoke' ? 'Motivo da revogação' : 'Justificativa'}
        reasonHelp={modal.kind === 'revoke' ? 'Obrigatório. A penalidade sai do tempo oficial e o recálculo do motor não a traz de volta.' : undefined}
        officialBefore={official}
        officialAfter={after}
        confirmText={modal.kind === 'revoke' ? 'Revogar' : 'Salvar alteração'}
        danger={modal.kind === 'revoke'}
        validate={() => (modal.kind === 'alter' && (!Number.isInteger(nextSeconds) || nextSeconds < 0 || nextSeconds > 3600) ? 'Informe os segundos (0 a 3600).' : '')}
        onClose={onClose}
        onSubmit={(reason) => decide(modal.kind === 'revoke'
          ? { action: 'revoke_infraction', infractionId: item.id, reason }
          : { action: 'adjust_infraction', infractionId: item.id, seconds: nextSeconds, label, reason })}
      >
        {modal.kind === 'alter' && (
          <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
            <label className="block space-y-1"><span className="text-xs font-bold uppercase tracking-wider">Segundos</span>
              <input type="number" min={0} max={3600} step={1} inputMode="numeric" value={seconds} onChange={(event) => setSeconds(event.target.value)} className={raceInput} />
            </label>
            <label className="block space-y-1"><span className="text-xs font-bold uppercase tracking-wider">Motivo da infração</span>
              <input value={label} maxLength={200} onChange={(event) => setLabel(event.target.value)} className={raceInput} />
            </label>
          </div>
        )}
      </RaceDecisionDialog>
    );
  }

  const run = modal.run;
  const subtitle = runSubtitle(run);
  if (modal.kind === 'adjust') {
    const parsed = parseRaceDuration(gross);
    return (
      <RaceDecisionDialog
        title="Ajustar tempo"
        subtitle={`${subtitle} · bruto atual ${formatRaceDuration(run.grossSeconds)} · penalidades vigentes: ${run.penaltySeconds ? formatRacePenalty(run.penaltySeconds) : 'nenhuma'}`}
        officialBefore={run.officialSeconds}
        officialAfter={previewRaceOfficial(parsed, run.penaltySeconds)}
        consequence={run.status === 'racing' ? 'A corrida passa a Finalizada, com o tempo lançado à mão.' : 'O tempo passa a constar como lançado à mão.'}
        confirmText="Salvar tempo"
        validate={() => (parsed === null ? 'Use o formato H:MM:SS, por exemplo 1:12:40.' : '')}
        onClose={onClose}
        onSubmit={(reason) => decide({ action: 'adjust_time', runId: run.id, grossSeconds: parsed, reason })}
      >
        <label className="block space-y-1"><span className="text-xs font-bold uppercase tracking-wider">Novo tempo bruto (H:MM:SS)</span>
          <input value={gross} onChange={(event) => setGross(event.target.value)} placeholder="1:12:40" inputMode="numeric" className={raceInput} />
        </label>
      </RaceDecisionDialog>
    );
  }
  const on = modal.kind === 'dnf';
  return (
      <RaceDecisionDialog
        title={on ? 'Marcar DNF' : 'Desfazer DNF'}
        subtitle={`${subtitle} · ${on ? 'não largou ou não terminou.' : 'volta para a situação anterior.'}`}
        reasonLabel="Motivo"
        officialBefore={on ? run.officialSeconds : null}
        officialAfter={on ? null : restorePreview(run, payload.decisions, ['mark_dnf'])}
        consequence={on ? 'A corrida fica sem tempo oficial e aparece como DNF. Pode ser desfeito depois, com novo registro.' : 'A corrida volta à situação de antes do DNF; sem tempo fechado, feche pelo ajuste ou pelo lançamento manual.'}
        confirmText={on ? 'Marcar DNF' : 'Desfazer DNF'}
        danger={on}
        onClose={onClose}
        onSubmit={(reason) => decide({ action: on ? 'mark_dnf' : 'unmark_dnf', runId: run.id, reason })}
      />
  );
}
