'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { History, Link2, ReceiptText, RotateCcw, Search, Trash2, UserPlus, UserRoundX, Wrench, X } from 'lucide-react';

import { LANE_STATE_CHIP, LANE_STATE_LABELS, ScoresheetBoard, type BoardRowSheet } from '@/components/admin/ScoresheetBoard';
import { useApp } from '@/context/AppContext';
import { SCORESHEET_REVIEW_LABELS, type ScoresheetReviewAction } from '@/lib/scoresheet';
import {
  buildScoresheetBoard,
  countBoardDivisions,
  groupScoresheetProvas,
  pickDefaultProva,
  splitTeamName,
  type BoardEntry,
  type BoardFilter,
  type BoardGroup,
  type BoardHeatItem,
  type BoardLaneState
} from '@/lib/scoresheetBoard';
import type { Event, Score } from '@/types';

// Aba "Súmulas" do evento presencial (Stories 1.49 e 1.51): os judges do
// evento (criar, remover) e as súmulas da arbitragem. A súmula enviada já está
// publicada (decisão 3 da E3); o gestor corrige o resultado (com
// justificativa), devolve ao judge ou cancela, e vê o histórico. Depois de cada
// ação, os scores das provas com súmula são trocados pelos do servidor.
//
// Organização por prova e bateria (Stories 1.141 a 1.143; desenho aprovado em
// docs/design/sumulas-organizacao/): sub-abas Súmulas e Judges, uma prova por
// código, faixa "Precisa de atenção", busca e filtros, a lista por bateria
// (ScoresheetBoard) e um painel de detalhe com as ações e o histórico.

const REFRESH_MS = 20_000;

type JudgeRow = { id: string; name: string; email: string };
type SheetRow = BoardRowSheet & {
  heatId: string | null;
  judgeUserId?: string | null;
  returnReason: string | null;
  createdAt: string;
  submittedAt: string | null;
};
type ReviewRow = {
  id: string;
  action: ScoresheetReviewAction;
  actorName: string;
  reason: string | null;
  previousResult: string | null;
  appliedResult: string | null;
  appliedTieBreak: string | null;
  createdAt: string;
};
type ScoreRow = { athleteId: string; workoutId: string; result: string; value: number; rank?: number; points?: number; splits?: Record<string, string> };
type Mode = { sheetId: string; kind: 'correct' | 'return' | 'cancel' | 'release' } | null;
// Linha aberta no painel de detalhe. Sem sheetId, o painel segue a súmula ativa da raia.
type Selection = { provaKey: string; entryKey: string; sheetId: string | null } | null;
type HistoryState = { sheetId: string; rows: ReviewRow[]; loading: boolean } | null;
// Link do comprovante do atleta (Story 1.146, D8), buscado ao abrir uma súmula já enviada.
type ReceiptLinkState = { sheetId: string; path: string | null; loading: boolean } | null;
type PendingKind = 'inProgress' | 'missing' | 'returned';

const adminAction = async (action: string, payload: Record<string, unknown>) => {
  const response = await fetch('/api/admin/persistence', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, payload })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a operação.');
  return data;
};

const sheetsRequest = async (body: Record<string, unknown>) => {
  const response = await fetch('/api/sheets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a operação.');
  return data;
};

const inputClass = 'w-full rounded-md border border-card-border bg-dark-gray px-3 py-2 text-sm text-white placeholder:text-muted focus:border-primary/50 focus:outline-none';
const smallButton = 'inline-flex min-h-9 items-center gap-1.5 rounded-md border border-card-border bg-dark-gray px-2.5 text-[11px] font-bold uppercase tracking-wider text-white transition-colors hover:border-primary disabled:cursor-not-allowed disabled:opacity-50';

const RESULT_HINT: Record<string, string> = { fortime: 'Tempo (MM:SS)', amrap: 'Total de repetições', maxweight: 'Carga em kg', reps: 'Repetições', distance: 'Distância em metros', tonnage: 'Tonelagem em kg (ex.: 830 ou 1.652,5)' };
const TYPE_LABEL: Record<string, string> = { fortime: 'For time', amrap: 'AMRAP', maxweight: 'Carga máxima', reps: 'Repetições', points: 'Pontos', distance: 'Distância', tonnage: 'Tonelagem' };

const PENDING_TEXT: Record<PendingKind, [string, string]> = {
  inProgress: ['em andamento', 'em andamento'],
  missing: ['raia sem súmula', 'raias sem súmula'],
  returned: ['devolvida', 'devolvidas']
};

const EMPTY_FILTER: BoardFilter = { divisionId: null, query: '', pendingOnly: false, showCancelled: false };

const formatWhen = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

const sheetState = (sheet: SheetRow): BoardLaneState => (sheet.status === 'cancelled' ? 'cancelled' : sheet.status);

export function ScoresheetsPanel({ event }: { event: Event }) {
  const { replaceWorkoutScores, athletes } = useApp();
  const [judges, setJudges] = useState<JudgeRow[]>([]);
  const [sheets, setSheets] = useState<SheetRow[] | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<Mode>(null);
  const [form, setForm] = useState({ result: '', tieBreak: '', reason: '', acknowledged: false });
  const [history, setHistory] = useState<HistoryState>(null);
  const [receiptLink, setReceiptLink] = useState<ReceiptLinkState>(null);
  const [judgeForm, setJudgeForm] = useState({ name: '', email: '', password: '' });
  const [view, setView] = useState<'sheets' | 'judges'>('sheets');
  const [chosenProva, setChosenProva] = useState<string | null>(null);
  const [filter, setFilter] = useState<BoardFilter>(EMPTY_FILTER);
  const [openGroups, setOpenGroups] = useState<Record<string, Record<string, boolean>>>({});
  const [selection, setSelection] = useState<Selection>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  // Provas do evento para escolher a prova inicial dentro do carregamento, sem
  // refazer o carregamento a cada mudança do evento.
  const workoutsRef = useRef(event.workouts);
  useEffect(() => {
    workoutsRef.current = event.workouts;
  }, [event.workouts]);

  const load = useCallback(async () => {
    const [judgesResult, manageResponse] = await Promise.all([
      adminAction('listJudges', { eventId: event.id }),
      fetch(`/api/sheets?view=manage&eventId=${encodeURIComponent(event.id)}`)
    ]);
    const manage = await manageResponse.json().catch(() => ({}));
    if (!manageResponse.ok) throw new Error(manage.error || 'Erro ao carregar as súmulas.');
    const list = (manage.sheets || []) as SheetRow[];
    setJudges(judgesResult.judges || []);
    setSheets(list);
    // A aba abre na prova da súmula atualizada por último (D7); depois, quem escolhe é o gestor.
    setChosenProva((current) => current ?? pickDefaultProva(groupScoresheetProvas(workoutsRef.current, list.map((sheet) => sheet.workoutId)), list));
    for (const [workoutId, scores] of Object.entries((manage.scores || {}) as Record<string, ScoreRow[]>)) {
      replaceWorkoutScores(workoutId, scores as Score[]);
    }
  }, [event.id, replaceWorkoutScores]);

  useEffect(() => {
    const refresh = () => void load().catch((error) => setNotice(error instanceof Error ? error.message : 'Erro ao carregar as súmulas.'));
    const first = window.setTimeout(refresh, 0);
    const interval = window.setInterval(refresh, REFRESH_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(interval);
    };
  }, [load]);

  // ---------------------------------------------------------------------------
  // Provas, baterias e pendências (Stories 1.141 e 1.142)
  // ---------------------------------------------------------------------------

  const heats = useMemo(() => (event.scheduleItems || []).filter((item) => item.kind === 'heat') as BoardHeatItem[], [event.scheduleItems]);
  const divisionOrder = useMemo(() => [...event.divisions].sort((a, b) => (a.orderIndex ?? 999) - (b.orderIndex ?? 999)).map((division) => division.id), [event.divisions]);
  const divisionNames = useMemo(() => Object.fromEntries(event.divisions.map((division) => [division.id, division.name])) as Record<string, string>, [event.divisions]);
  const eventAthletes = useMemo(() => {
    const divisionIds = new Set(event.divisions.map((division) => division.id));
    return athletes.filter((athlete) => divisionIds.has(athlete.divisionId)).map((athlete) => ({ id: athlete.id, name: athlete.name, box: athlete.box, divisionId: athlete.divisionId }));
  }, [athletes, event.divisions]);
  const provas = useMemo(() => groupScoresheetProvas(event.workouts, (sheets || []).map((sheet) => sheet.workoutId)), [event.workouts, sheets]);
  const boards = useMemo(() => new Map(provas.map((prova) => [prova.key, buildScoresheetBoard({
    workoutIds: prova.workoutIds,
    sheets: sheets || [],
    heats,
    athletes: eventAthletes,
    divisionOrder
  })])), [provas, sheets, heats, eventAthletes, divisionOrder]);

  const activeProva = provas.find((prova) => prova.key === chosenProva) ?? provas[0] ?? null;
  const activeBoard = activeProva ? boards.get(activeProva.key) ?? null : null;
  const totals = useMemo(() => {
    const sum = { inProgress: 0, missing: 0, returned: 0 };
    for (const board of boards.values()) {
      sum.inProgress += board.stats.inProgress;
      sum.missing += board.stats.missing;
      sum.returned += board.stats.returned;
    }
    return sum;
  }, [boards]);

  const chooseProva = (key: string) => {
    setChosenProva(key);
    setFilter((current) => ({ ...current, divisionId: null, query: '' }));
  };

  const focusPending = (kind: PendingKind) => {
    const target = provas.find((prova) => (boards.get(prova.key)?.stats[kind] ?? 0) > 0);
    if (target) setChosenProva(target.key);
    setFilter((current) => ({ ...current, divisionId: null, query: '', pendingOnly: true }));
  };

  const toggleGroup = (groupKey: string, open: boolean) => {
    if (!activeProva) return;
    const provaKey = activeProva.key;
    setOpenGroups((current) => ({ ...current, [provaKey]: { ...(current[provaKey] || {}), [groupKey]: open } }));
  };

  // ---------------------------------------------------------------------------
  // Painel de detalhe (Story 1.143)
  // ---------------------------------------------------------------------------

  // Última súmula pedida em cada busca do painel: resposta atrasada de outra súmula (ou depois de fechar) é descartada.
  // O número da busca do histórico também descarta uma resposta mais antiga da mesma súmula.
  const historyRequestRef = useRef<string | null>(null);
  const historySeqRef = useRef(0);
  const receiptRequestRef = useRef<string | null>(null);

  const loadHistory = useCallback(async (sheetId: string) => {
    historyRequestRef.current = sheetId;
    const seq = ++historySeqRef.current;
    setHistory({ sheetId, rows: [], loading: true });
    try {
      const response = await fetch(`/api/sheets?view=sheet&sheetId=${encodeURIComponent(sheetId)}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Erro ao carregar o histórico.');
      if (historyRequestRef.current !== sheetId || historySeqRef.current !== seq) return;
      setHistory({ sheetId, rows: data.reviews || [], loading: false });
    } catch (error) {
      if (historyRequestRef.current !== sheetId || historySeqRef.current !== seq) return;
      setHistory({ sheetId, rows: [], loading: false });
      setNotice(error instanceof Error ? error.message : 'Erro ao carregar o histórico.');
    }
  }, []);

  const loadReceiptLink = useCallback(async (sheetId: string) => {
    receiptRequestRef.current = sheetId;
    setReceiptLink({ sheetId, path: null, loading: true });
    try {
      const response = await fetch(`/api/sheet-receipts?sheetId=${encodeURIComponent(sheetId)}`, { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Erro ao carregar o comprovante.');
      if (receiptRequestRef.current !== sheetId) return;
      setReceiptLink({ sheetId, path: typeof data.path === 'string' ? data.path : null, loading: false });
    } catch (error) {
      if (receiptRequestRef.current !== sheetId) return;
      setReceiptLink({ sheetId, path: null, loading: false });
      setNotice(error instanceof Error ? error.message : 'Erro ao carregar o comprovante.');
    }
  }, []);

  const copyReceiptLink = async (path: string) => {
    const url = `${window.location.origin}${path}`;
    try {
      await navigator.clipboard.writeText(url);
      setNotice('Link do comprovante copiado. Envie ao atleta.');
    } catch {
      setNotice(`Não deu para copiar sozinho. Link do comprovante: ${url}`);
    }
  };

  const detail = useMemo(() => {
    if (!selection || !sheets) return null;
    let entry: BoardEntry<SheetRow> | null = null;
    let group: BoardGroup<SheetRow> | null = null;
    for (const candidate of boards.get(selection.provaKey)?.groups ?? []) {
      const found = candidate.entries.find((item) => item.key === selection.entryKey);
      if (found) {
        entry = found as BoardEntry<SheetRow>;
        group = candidate as BoardGroup<SheetRow>;
        break;
      }
    }
    const sheet = selection.sheetId ? sheets.find((item) => item.id === selection.sheetId) ?? null : entry?.sheet ?? null;
    if (!entry && !sheet) return null;
    return { prova: provas.find((prova) => prova.key === selection.provaKey) ?? null, entry, group, sheet };
  }, [selection, sheets, boards, provas]);

  const selectionKey = selection ? `${selection.entryKey}|${selection.sheetId ?? ''}` : '';
  useEffect(() => {
    if (selectionKey) closeRef.current?.focus();
  }, [selectionKey]);

  const openEntry = (entry: BoardEntry<BoardRowSheet>, sheetId: string | null, trigger: HTMLElement) => {
    if (!activeProva) return;
    triggerRef.current = trigger;
    setSelection({ provaKey: activeProva.key, entryKey: entry.key, sheetId });
    setMode(null);
    setNotice('');
    const target = sheetId ?? entry.sheet?.id ?? null;
    if (target) void loadHistory(target);
    else {
      historyRequestRef.current = null;
      setHistory(null);
    }
    const targetSheet = target ? (sheets || []).find((item) => item.id === target) : null;
    if (targetSheet?.submittedAt) void loadReceiptLink(targetSheet.id);
    else {
      receiptRequestRef.current = null;
      setReceiptLink(null);
    }
  };

  const openOtherSheet = (sheet: SheetRow) => {
    if (!selection) return;
    setSelection({ ...selection, sheetId: sheet.status === 'cancelled' ? sheet.id : null });
    setMode(null);
    setNotice('');
    void loadHistory(sheet.id);
    if (sheet.submittedAt) void loadReceiptLink(sheet.id);
    else {
      receiptRequestRef.current = null;
      setReceiptLink(null);
    }
  };

  const closeDetail = () => {
    const entryKey = selection?.entryKey;
    setSelection(null);
    setMode(null);
    setHistory(null);
    setReceiptLink(null);
    historyRequestRef.current = null;
    receiptRequestRef.current = null;
    const trigger = triggerRef.current?.isConnected
      ? triggerRef.current
      : entryKey ? document.querySelector<HTMLElement>(`[data-entry="${CSS.escape(entryKey)}"]`) : null;
    trigger?.focus();
  };

  const handleDialogKeyDown = (keyEvent: KeyboardEvent<HTMLDivElement>) => {
    if (keyEvent.key === 'Escape') {
      keyEvent.preventDefault();
      closeDetail();
      return;
    }
    if (keyEvent.key !== 'Tab') return;
    const nodes = [...keyEvent.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')];
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (keyEvent.shiftKey && document.activeElement === first) {
      keyEvent.preventDefault();
      last.focus();
    } else if (!keyEvent.shiftKey && document.activeElement === last) {
      keyEvent.preventDefault();
      first.focus();
    }
  };

  const startMode = (sheet: SheetRow, kind: NonNullable<Mode>['kind']) => {
    if (mode?.sheetId === sheet.id && mode.kind === kind) {
      setMode(null);
      return;
    }
    setForm({ result: kind === 'correct' ? sheet.officialResult || '' : '', tieBreak: kind === 'correct' ? sheet.officialTieBreak || '' : '', reason: '', acknowledged: false });
    setMode({ sheetId: sheet.id, kind });
    setNotice('');
  };

  const submitReview = async (formEvent: FormEvent, sheet: SheetRow) => {
    formEvent.preventDefault();
    if (!mode) return;
    // A raia aberta quando a ação começou: se o gestor trocar de linha durante o envio, o painel não é mexido.
    const entryKey = selection?.entryKey ?? null;
    setBusy(true);
    setNotice('');
    try {
      await sheetsRequest({
        action: 'review',
        sheetId: sheet.id,
        review: mode.kind,
        reason: form.reason,
        ...(mode.kind === 'correct' ? { result: form.result, tieBreak: form.tieBreak } : {})
      });
      setNotice(mode.kind === 'correct' ? `Resultado de ${sheet.athleteName} corrigido e publicado.`
        : mode.kind === 'return' ? `Súmula de ${sheet.athleteName} devolvida ao judge.`
          : mode.kind === 'release' ? `Súmula de ${sheet.athleteName} liberada. O próximo judge que abrir assume, com os registros.`
            : `Súmula de ${sheet.athleteName} cancelada.`);
      // A súmula cancelada deixa de ser a ativa da raia: o painel continua nela.
      if (mode.kind === 'cancel') setSelection((current) => (current && current.entryKey === entryKey ? { ...current, sheetId: sheet.id } : current));
      setMode(null);
      await load();
      // Só recarrega o histórico se o painel ainda está nesta súmula.
      if (historyRequestRef.current === sheet.id) await loadHistory(sheet.id);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Não foi possível concluir a operação.');
    } finally {
      setBusy(false);
    }
  };

  const createJudge = async (formEvent: FormEvent) => {
    formEvent.preventDefault();
    setBusy(true);
    setNotice('');
    try {
      await adminAction('createJudge', { eventId: event.id, ...judgeForm });
      setJudgeForm({ name: '', email: '', password: '' });
      setNotice('Judge criado e atribuído ao evento. Ele entra pelo login e abre a área "Quadra".');
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Erro ao criar o judge.');
    } finally {
      setBusy(false);
    }
  };

  const removeJudge = async (judge: JudgeRow) => {
    if (!window.confirm(`Remover ${judge.name} deste evento? As súmulas que ele já abriu ficam com o nome dele.`)) return;
    try {
      await adminAction('removeJudgeFromEvent', { eventId: event.id, judgeId: judge.id });
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Erro ao remover o judge.');
    }
  };

  const renderForm = (sheet: SheetRow, workoutType: string) => {
    if (!mode || mode.sheetId !== sheet.id) return null;
    const id = `${sheet.id}-${mode.kind}`;
    return (
      <form onSubmit={(formEvent) => void submitReview(formEvent, sheet)} className="space-y-3 border-t border-card-border pt-3">
        {mode.kind === 'correct' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={`${id}-result`} className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">{RESULT_HINT[workoutType] ?? 'Resultado'}</label>
              <input id={`${id}-result`} required value={form.result} onChange={(e) => setForm({ ...form, result: e.target.value })} className={`${inputClass} font-number`} />
            </div>
            <div>
              <label htmlFor={`${id}-tiebreak`} className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">Tie-break (MM:SS, opcional)</label>
              <input id={`${id}-tiebreak`} value={form.tieBreak} onChange={(e) => setForm({ ...form, tieBreak: e.target.value })} className={`${inputClass} font-number`} />
            </div>
          </div>
        )}
        <div>
          <label htmlFor={`${id}-reason`} className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
            {mode.kind === 'correct' ? 'Justificativa (fica no histórico)' : mode.kind === 'return' ? 'Motivo para o judge' : mode.kind === 'release' ? 'Motivo da liberação (fica no histórico)' : 'Motivo do cancelamento'}
          </label>
          <input id={`${id}-reason`} required minLength={3} maxLength={500} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className={inputClass} />
        </div>
        {mode.kind === 'release' && (
          <p className="text-xs text-muted">Tira {sheet.judgeName} desta súmula. Os registros ficam, e o próximo judge que abrir a súmula na quadra assume dali.</p>
        )}
        {mode.kind === 'cancel' && (
          <label className="flex items-start gap-2 text-xs text-white">
            <input type="checkbox" checked={form.acknowledged} onChange={(e) => setForm({ ...form, acknowledged: e.target.checked })} className="mt-0.5 accent-primary" />
            Entendo que o resultado desta súmula sai do ranking e que outra súmula poderá ser aberta para o atleta.
          </label>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={busy || (mode.kind === 'cancel' && !form.acknowledged)} className="inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-xs font-bold uppercase tracking-wider text-ink disabled:opacity-50">
            {mode.kind === 'correct' ? 'Publicar correção' : mode.kind === 'return' ? 'Devolver ao judge' : mode.kind === 'release' ? 'Liberar para outro judge' : 'Cancelar súmula'}
          </button>
          <button type="button" onClick={() => setMode(null)} className={smallButton}>Fechar</button>
        </div>
      </form>
    );
  };

  const renderDetail = () => {
    if (!detail) return null;
    const { prova, entry, sheet } = detail;
    const heatNumber = entry?.heatNumber ?? sheet?.heatNumber ?? null;
    const lane = entry?.lane ?? sheet?.lane ?? null;
    const where = heatNumber ? `Bateria ${heatNumber}${lane ? ` · Raia ${lane}` : ''}` : 'Sem bateria';
    const name = splitTeamName(sheet?.athleteName || entry?.athleteName || '');
    const divisionId = sheet?.divisionId || entry?.divisionId || '';
    const subtitle = [name.secondary, sheet?.box || entry?.box || '', divisionNames[divisionId] || ''].filter(Boolean).join(' · ');
    const state: BoardLaneState = sheet ? sheetState(sheet) : entry?.state ?? 'missing';
    const workoutType = event.workouts.find((workout) => workout.id === (sheet?.workoutId ?? entry?.workoutId))?.type ?? '';
    const others = entry
      ? [...(entry.sheet && entry.sheet.id !== sheet?.id ? [entry.sheet] : []), ...entry.cancelled.filter((item) => item.id !== sheet?.id)]
      : [];
    return (
      <>
        <div className="fixed inset-0 z-[120] bg-black/60" aria-hidden="true" onClick={closeDetail} />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="sheet-detail-title"
          onKeyDown={handleDialogKeyDown}
          className="fixed inset-y-0 right-0 z-[121] grid w-full max-w-md grid-rows-[auto_minmax(0,1fr)] border-l border-card-border bg-card pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-white shadow-2xl"
        >
          <div className="flex items-start justify-between gap-3 border-b border-card-border px-5 py-4">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">{prova?.label ? `${prova.label} · ` : ''}{where}</p>
              <h4 id="sheet-detail-title" className="mt-1 text-lg font-bold">{name.primary}</h4>
              {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
            </div>
            <button ref={closeRef} type="button" onClick={closeDetail} aria-label="Fechar" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-card-border bg-dark-gray hover:border-primary">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <div className="space-y-5 overflow-y-auto px-5 py-4">
            {!sheet ? (
              <div className="space-y-2 rounded-lg border border-card-border bg-dark-gray/40 p-4">
                <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${LANE_STATE_CHIP[state]}`}>{LANE_STATE_LABELS[state]}</span>
                <p className="text-sm text-muted">
                  {state === 'waiting'
                    ? 'A raia está no cronograma e a bateria ainda não começou.'
                    : 'A raia está no cronograma e não tem súmula ativa. O judge abre a súmula pela Quadra e pode marcar o atleta como ausente. O lançamento manual continua onde está.'}
                </p>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-card-border bg-dark-gray/40 p-4">
                <span className="font-number text-3xl font-bold leading-none">{sheet.officialResult || '—'}</span>
                {sheet.officialTieBreak && <span className="font-number text-xs text-muted">tb {sheet.officialTieBreak}</span>}
                {sheet.corrected && <span className="rounded border border-primary/50 px-1 text-[10px] uppercase text-primary">corrigido</span>}
                {sheet.absent && <span className="rounded border border-info/60 px-1 text-[10px] uppercase text-info">Ausente</span>}
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${LANE_STATE_CHIP[state]}`}>{LANE_STATE_LABELS[state]}</span>
                <p className="basis-full text-xs text-muted">
                  {sheet.judgeUserId === null && (sheet.status === 'in_progress' || sheet.status === 'returned')
                    ? `Sem judge (liberada; antes com ${sheet.judgeName})`
                    : `Judge ${sheet.judgeName}`} · {formatWhen(sheet.updatedAt)}
                </p>
                {sheet.status === 'returned' && sheet.returnReason && <p className="basis-full text-xs text-muted">“{sheet.returnReason}”</p>}
              </div>
            )}

            {sheet && sheet.status !== 'cancelled' && (
              <div className="flex flex-wrap gap-2">
                {(sheet.status === 'submitted' || sheet.status === 'returned') && (
                  <button type="button" onClick={() => startMode(sheet, 'correct')} aria-expanded={mode?.sheetId === sheet.id && mode.kind === 'correct'} className={smallButton}>
                    <Wrench className="h-3.5 w-3.5" aria-hidden="true" />Corrigir
                  </button>
                )}
                {sheet.status === 'submitted' && (
                  <button type="button" onClick={() => startMode(sheet, 'return')} aria-expanded={mode?.sheetId === sheet.id && mode.kind === 'return'} className={smallButton}>
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />Devolver
                  </button>
                )}
                {/* Story 1.148 (D8): tira o judge sem apagar os registros. */}
                {(sheet.status === 'in_progress' || sheet.status === 'returned') && sheet.judgeUserId && (
                  <button type="button" onClick={() => startMode(sheet, 'release')} aria-expanded={mode?.sheetId === sheet.id && mode.kind === 'release'} className={smallButton}>
                    <UserRoundX className="h-3.5 w-3.5" aria-hidden="true" />Liberar para outro judge
                  </button>
                )}
                <button type="button" onClick={() => startMode(sheet, 'cancel')} aria-expanded={mode?.sheetId === sheet.id && mode.kind === 'cancel'} className={smallButton}>
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />Cancelar
                </button>
              </div>
            )}
            {sheet && renderForm(sheet, workoutType)}
            {notice && <p role="status" aria-live="polite" className="rounded-md border border-card-border bg-dark-gray/40 px-3 py-2 text-xs text-white">{notice}</p>}

            {sheet?.submittedAt && (
              <section className="space-y-2" aria-labelledby="sheet-detail-receipt">
                <h5 id="sheet-detail-receipt" className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Comprovante do atleta</h5>
                {receiptLink?.sheetId === sheet.id && receiptLink.path ? (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => void copyReceiptLink(receiptLink.path as string)} className={smallButton}>
                      <Link2 className="h-3.5 w-3.5" aria-hidden="true" />Copiar link
                    </button>
                    <a href={receiptLink.path} target="_blank" rel="noopener" className={smallButton}>
                      <ReceiptText className="h-3.5 w-3.5" aria-hidden="true" />Abrir comprovante
                    </a>
                  </div>
                ) : receiptLink?.sheetId === sheet.id && receiptLink.loading ? (
                  <p className="text-xs text-muted" role="status">Carregando…</p>
                ) : (
                  <button type="button" onClick={() => void loadReceiptLink(sheet.id)} className={smallButton}>
                    <ReceiptText className="h-3.5 w-3.5" aria-hidden="true" />Ver comprovante
                  </button>
                )}
              </section>
            )}

            {sheet && (
              <section className="space-y-2" aria-labelledby="sheet-detail-history">
                <h5 id="sheet-detail-history" className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Histórico</h5>
                {history?.sheetId !== sheet.id ? (
                  <button type="button" onClick={() => void loadHistory(sheet.id)} className={smallButton}>
                    <History className="h-3.5 w-3.5" aria-hidden="true" />Ver histórico
                  </button>
                ) : history.loading ? (
                  <p className="text-xs text-muted" role="status">Carregando…</p>
                ) : history.rows.length === 0 ? (
                  <p className="text-xs text-muted">Sem registros.</p>
                ) : (
                  <ol className="space-y-2.5 border-l border-card-border pl-3 text-xs" aria-label={`Histórico da súmula de ${sheet.athleteName}`}>
                    {history.rows.map((review) => (
                      <li key={review.id} className="flex flex-wrap gap-x-2">
                        <span className="font-number text-muted">{formatWhen(review.createdAt)}</span>
                        <span className="font-bold text-white">{SCORESHEET_REVIEW_LABELS[review.action] ?? review.action}</span>
                        <span className="text-muted">por {review.actorName}</span>
                        {review.appliedResult && <span className="font-number text-white">{review.previousResult ? `${review.previousResult} → ` : ''}{review.appliedResult}{review.appliedTieBreak ? ` (tb ${review.appliedTieBreak})` : ''}</span>}
                        {review.reason && <span className="w-full text-muted">“{review.reason}”</span>}
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            )}

            {others.length > 0 && (
              <section className="space-y-2" aria-labelledby="sheet-detail-others">
                <h5 id="sheet-detail-others" className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Outras súmulas deste atleta nesta prova</h5>
                <ul className="space-y-1.5">
                  {others.map((other) => (
                    <li key={other.id}>
                      <button type="button" onClick={() => openOtherSheet(other)} className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-card-border px-3 py-2 text-left text-xs hover:border-primary">
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${LANE_STATE_CHIP[sheetState(other)]}`}>{LANE_STATE_LABELS[sheetState(other)]}</span>
                        <span className="text-muted">{other.judgeName} · {formatWhen(other.updatedAt)}</span>
                        {other.officialResult && <span className="font-number font-bold">{other.officialResult}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
      </>
    );
  };

  // ---------------------------------------------------------------------------
  // Tela
  // ---------------------------------------------------------------------------

  const hasStructuredWorkouts = event.workouts.some((workout) => workout.structure);
  const pendingTotal = totals.inProgress + totals.missing + totals.returned;
  const divisionCounts = activeBoard ? countBoardDivisions(activeBoard) : {};
  const provaDivisions = divisionOrder.filter((id) => divisionCounts[id]);
  const heatCount = activeBoard ? activeBoard.groups.filter((group) => group.kind === 'heat' || group.kind === 'sheet_heat').length : 0;

  const renderSheets = () => {
    if (provas.length === 0) {
      return sheets === null && hasStructuredWorkouts
        ? <p className="text-sm text-muted" role="status">Carregando súmulas…</p>
        : <p className="text-sm text-muted">Nenhuma prova com súmula digital. Estruture a súmula na aba Provas.</p>;
    }
    if (sheets === null) return <p className="text-sm text-muted" role="status">Carregando súmulas…</p>;
    return (
      <>
        {pendingTotal > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/35 bg-primary/10 px-3 py-2.5" role="group" aria-label="Precisa de atenção">
            <span className="mr-1 text-[11px] font-bold uppercase tracking-[0.12em] text-primary">Precisa de atenção</span>
            {(['inProgress', 'missing', 'returned'] as PendingKind[]).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => focusPending(kind)}
                disabled={totals[kind] === 0}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-card-border bg-dark-gray px-3 text-xs font-semibold text-white disabled:cursor-default disabled:text-muted"
              >
                <span className="font-number font-bold">{totals[kind]}</span>{PENDING_TEXT[kind][totals[kind] === 1 ? 0 : 1]}
              </button>
            ))}
          </div>
        )}

        <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Provas">
          {provas.map((prova) => {
            const stats = boards.get(prova.key)?.stats;
            const total = stats?.total ?? 0;
            const published = stats?.published ?? 0;
            const pending = stats?.pending ?? 0;
            const selected = prova.key === activeProva?.key;
            return (
              <button
                key={prova.key}
                type="button"
                onClick={() => chooseProva(prova.key)}
                aria-pressed={selected}
                className={`relative grid min-w-28 shrink-0 gap-0.5 rounded-lg border bg-card px-3 py-2 text-left transition-colors motion-reduce:transition-none ${selected ? 'border-primary ring-1 ring-primary' : 'border-card-border hover:border-muted'}`}
              >
                <span className="pr-6 text-[12.5px] font-extrabold uppercase tracking-wide">{prova.label}</span>
                <span className="font-number text-xs text-muted">{published}/{total} publicadas</span>
                <span className="mt-1 block h-[3px] overflow-hidden rounded-full bg-card-border" aria-hidden="true">
                  <span className="block h-full bg-trading-up" style={{ width: `${total ? Math.round((published / total) * 100) : 0}%` }} />
                </span>
                {pending > 0 && (
                  <span className="absolute right-2 top-1.5 rounded-full bg-primary px-1.5 font-number text-[10.5px] font-bold leading-[17px] text-ink">
                    {pending}<span className="sr-only"> {pending === 1 ? 'pendência' : 'pendências'}</span>
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {activeProva && activeBoard && (
          <div className="rounded-xl border border-card-border bg-card">
            <div className="space-y-3 border-b border-card-border px-4 py-3.5">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h4 className="text-[17px] font-extrabold uppercase tracking-wide">{activeProva.label}</h4>
                <span className="text-xs text-muted">
                  {[TYPE_LABEL[activeProva.workouts[0]?.type ?? ''] ?? '', `${provaDivisions.length} ${provaDivisions.length === 1 ? 'categoria' : 'categorias'}`, heatCount ? `${heatCount} ${heatCount === 1 ? 'bateria' : 'baterias'}` : 'sem bateria'].filter(Boolean).join(' · ')}
                </span>
              </div>
              <label className="flex max-w-md items-center gap-2 rounded-md border border-card-border bg-dark-gray px-3 focus-within:border-primary/50">
                <Search className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
                <span className="sr-only">Buscar atleta, time ou box</span>
                <input
                  id="sheets-search"
                  type="search"
                  value={filter.query}
                  onChange={(e) => setFilter({ ...filter, query: e.target.value })}
                  placeholder="Buscar atleta, time ou box"
                  className="w-full bg-transparent py-2 text-sm text-white placeholder:text-muted focus:outline-none"
                />
              </label>
              <div className="flex flex-wrap items-center gap-1.5">
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Categoria">
                  {[{ id: null as string | null, name: 'Todas', count: activeBoard.stats.total }, ...provaDivisions.map((id) => ({ id: id as string | null, name: divisionNames[id] ?? 'Sem categoria', count: divisionCounts[id] }))].map((option) => (
                    <button
                      key={option.id ?? 'all'}
                      type="button"
                      onClick={() => setFilter({ ...filter, divisionId: option.id })}
                      aria-pressed={filter.divisionId === option.id}
                      className={`min-h-8 rounded-full border px-2.5 text-xs font-semibold ${filter.divisionId === option.id ? 'border-white bg-white text-ink' : 'border-card-border text-muted hover:border-muted'}`}
                    >
                      {option.name} <span className="font-number">{option.count}</span>
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 sm:ml-auto">
                  <label className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 text-xs text-muted">
                    <input type="checkbox" checked={filter.pendingOnly} onChange={(e) => setFilter({ ...filter, pendingOnly: e.target.checked })} className="accent-primary" />
                    Só pendências ({activeBoard.stats.pending})
                  </label>
                  <label className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 text-xs text-muted">
                    <input type="checkbox" checked={filter.showCancelled} onChange={(e) => setFilter({ ...filter, showCancelled: e.target.checked })} className="accent-primary" />
                    Canceladas ({activeBoard.stats.cancelled})
                  </label>
                </div>
              </div>
            </div>
            <ScoresheetBoard
              idPrefix="sheets-board"
              groups={activeBoard.groups}
              filter={filter}
              openGroups={openGroups[activeProva.key] || {}}
              divisionNames={divisionNames}
              onToggleGroup={toggleGroup}
              onSelect={openEntry}
              formatWhen={formatWhen}
            />
          </div>
        )}
      </>
    );
  };

  return (
    <div className="space-y-5 text-white">
      {notice && !detail && <p role="status" aria-live="polite" className="rounded-md border border-card-border bg-dark-gray/40 px-3 py-2 text-xs text-white">{notice}</p>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-card-border bg-dark-gray p-1" role="group" aria-label="Seção da aba">
          {([['sheets', 'Súmulas'], ['judges', `Judges · ${judges.length}`]] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setView(id)}
              aria-pressed={view === id}
              className={`min-h-9 rounded-md px-3.5 text-xs font-bold uppercase tracking-wider ${view === id ? 'bg-elevated text-white' : 'text-muted hover:text-white'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted">Atualiza a cada 20 s. A súmula enviada já está no ranking; corrigir, devolver e cancelar ficam no histórico.</p>
      </div>

      {view === 'sheets' ? (
        <section className="space-y-4" aria-labelledby="sheets-title">
          <h3 id="sheets-title" className="sr-only">Súmulas</h3>
          {renderSheets()}
        </section>
      ) : (
        <section className="space-y-4 rounded-xl border border-card-border bg-card p-5" aria-labelledby="judges-title">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Equipe de arbitragem</p>
            <h3 id="judges-title" className="mt-1 text-lg font-bold uppercase">Judges do evento</h3>
            <p className="mt-1 text-xs text-muted">O judge entra com este e-mail e senha, abre a área &quot;Quadra&quot; no celular e escolhe a bateria e a raia.</p>
          </div>
          <form onSubmit={(formEvent) => void createJudge(formEvent)} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="sr-only" htmlFor="sheet-judge-name">Nome do judge</label>
            <input id="sheet-judge-name" required minLength={3} value={judgeForm.name} onChange={(e) => setJudgeForm({ ...judgeForm, name: e.target.value })} placeholder="Nome do judge" className={inputClass} />
            <label className="sr-only" htmlFor="sheet-judge-email">E-mail</label>
            <input id="sheet-judge-email" required type="email" value={judgeForm.email} onChange={(e) => setJudgeForm({ ...judgeForm, email: e.target.value })} placeholder="E-mail" className={inputClass} />
            <label className="sr-only" htmlFor="sheet-judge-password">Senha inicial</label>
            <input id="sheet-judge-password" required minLength={8} type="password" autoComplete="new-password" value={judgeForm.password} onChange={(e) => setJudgeForm({ ...judgeForm, password: e.target.value })} placeholder="Senha inicial (mín. 8)" className={inputClass} />
            <button type="submit" disabled={busy} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-md bg-primary px-4 text-xs font-bold uppercase tracking-wider text-ink disabled:opacity-60">
              <UserPlus className="h-4 w-4" aria-hidden="true" />{busy ? 'Criando…' : 'Criar judge'}
            </button>
          </form>
          <ul className="space-y-2">
            {judges.length === 0 ? <li className="text-sm text-muted">Nenhum judge atribuído.</li> : judges.map((judge) => (
              <li key={judge.id} className="flex items-center justify-between gap-3 rounded-md border border-card-border bg-dark-gray/30 p-3">
                <div className="min-w-0"><p className="truncate text-sm font-bold">{judge.name}</p><p className="truncate text-xs text-muted">{judge.email}</p></div>
                <button type="button" onClick={() => void removeJudge(judge)} className="min-h-9 text-xs font-bold uppercase tracking-wider text-trading-down hover:underline">Remover</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {renderDetail()}
    </div>
  );
}
