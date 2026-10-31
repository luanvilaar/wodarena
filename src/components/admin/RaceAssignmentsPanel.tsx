'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, RefreshCw, RotateCcw, SlidersHorizontal, Trash2 } from 'lucide-react';

import { raceButton } from '@/components/admin/RaceDecisionDialog';
import {
  describeRaceAssignmentScope,
  raceAssignmentPairKey,
  raceStationsWithoutJudge,
  sameRaceAssignmentPairs,
  toggleRaceAssignment,
  type RaceAssignmentPair
} from '@/lib/raceAssignments';
import { formatRaceClock } from '@/lib/raceWaves';
import type { Event } from '@/types';

// Seção "Escala de judges" da aba Súmula Fitness Race (Story 1.104, AC5; D35,
// D38; visual do painel aprovado em telas/painel-organizador.html, D23).
// Escopo "Padrão do evento" e cada onda, com o selo "Segue o padrão" ou
// "Ajustada"; matriz estações x judges com marcação por toque; "Ajustar esta
// onda" copia o padrão para a onda antes de editar e "Voltar ao padrão" apaga
// as linhas da onda. A escala só orienta (D3): estação sem judge é aviso, não
// trava a gravação. Mudar a escala de uma onda que já largou vale dali em
// diante; os cartões já abertos ficam com o judge deles (Story 1.103, AC6).
// Sem raias, sem gerador de escala e sem head judge (D38).

type PairRow = RaceAssignmentPair & { orphan: boolean };
type Station = { key: string; name: string; kindLabel: string; meta: string; closesTime: boolean; categories: string[] };
type Wave = { id: string; title: string; time: string; startedAt: string | null; adjusted: boolean; rows: PairRow[]; effective: PairRow[] };
type Payload = {
  event: { timeZone: string };
  stations: Station[];
  judges: { id: string; name: string }[];
  waves: Wave[];
  defaultRows: PairRow[];
  hasAssignments: boolean;
};

const DEFAULT_SCOPE = 'default';

/**
 * Atalho "Escala desta onda" / "Montar a escala" do painel de cobertura
 * (Story 1.105, AC5, AC6): abre esta seção no escopo da onda (ou no padrão do
 * evento, com heatId nulo). Mesmo cuidado da troca de escopo pelo seletor:
 * alteração não gravada pede confirmação.
 */
export const RACE_ASSIGNMENTS_FOCUS_EVENT = 'woda:race-assignments-focus';
export const focusRaceAssignmentsWave = (heatId: string | null) => {
  window.dispatchEvent(new CustomEvent(RACE_ASSIGNMENTS_FOCUS_EVENT, { detail: { heatId } }));
};
const toPairs = (rows: readonly PairRow[]): RaceAssignmentPair[] => rows.map((row) => ({ judgeUserId: row.judgeUserId, stationKey: row.stationKey }));

const postAssignments = async (body: Record<string, unknown>) => {
  const response = await fetch('/api/race-sheets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Não foi possível gravar a escala.');
  return data as Payload;
};

const cellClass = (on: boolean, disabled: boolean) => [
  'inline-flex h-11 min-h-11 w-11 min-w-11 items-center justify-center rounded-md border-2 transition-colors',
  on ? 'border-primary bg-primary text-ink' : 'border-card-border bg-dark-gray text-muted',
  disabled ? 'cursor-not-allowed opacity-60' : 'hover:border-primary'
].join(' ');

export function RaceAssignmentsPanel({ event }: { event: Event }) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState('');
  const [scope, setScope] = useState<string>(DEFAULT_SCOPE);
  const [draft, setDraft] = useState<RaceAssignmentPair[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/race-sheets?view=assignments&eventId=${encodeURIComponent(event.id)}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Erro ao carregar a escala.');
      setPayload(data as Payload);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erro ao carregar a escala.');
    }
  }, [event.id]);

  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(first);
  }, [load]);

  const wave = payload?.waves.find((item) => item.id === scope) ?? null;
  const isDefault = scope === DEFAULT_SCOPE || !wave;
  // Onda que segue o padrão mostra o padrão e só edita depois de "Ajustar esta onda".
  const following = !isDefault && !wave?.adjusted;
  const saved: RaceAssignmentPair[] = !payload ? [] : isDefault ? toPairs(payload.defaultRows) : toPairs(wave?.adjusted ? wave.rows : wave?.effective ?? []);
  const pairs = draft ?? saved;
  const editable = !following || draft !== null;
  const dirty = draft !== null && (following || !sameRaceAssignmentPairs(draft, saved));
  const stationKeys = (payload?.stations ?? []).map((station) => station.key);
  const known = new Set(stationKeys);
  const orphanKeys = [...new Set(pairs.map((pair) => pair.stationKey).filter((key) => !known.has(key)))];
  const uncovered = pairs.length > 0 ? raceStationsWithoutJudge(stationKeys, pairs) : [];
  const stationName = (key: string) => payload?.stations.find((station) => station.key === key)?.name ?? key;
  const selected = new Set(pairs.map(raceAssignmentPairKey));

  const changeScope = (next: string) => {
    if (next === scope) return;
    if (dirty && !window.confirm('Descartar as alterações não gravadas desta escala?')) return;
    setScope(next);
    setDraft(null);
    setNotice(null);
  };

  // Atalho do painel de cobertura (Story 1.105): escopo da onda pedida e rolagem até a seção.
  const sectionRef = useRef<HTMLElement>(null);
  const focusScope = (heatId: string | null) => changeScope(heatId && payload?.waves.some((item) => item.id === heatId) ? heatId : DEFAULT_SCOPE);
  const focusScopeRef = useRef(focusScope);
  useEffect(() => {
    focusScopeRef.current = focusScope;
  });
  useEffect(() => {
    const onFocus = (incoming: globalThis.Event) => {
      const heatId = (incoming as CustomEvent<{ heatId?: string | null }>).detail?.heatId ?? null;
      focusScopeRef.current(heatId);
      sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    window.addEventListener(RACE_ASSIGNMENTS_FOCUS_EVENT, onFocus);
    return () => window.removeEventListener(RACE_ASSIGNMENTS_FOCUS_EVENT, onFocus);
  }, []);

  const toggle = (pair: RaceAssignmentPair) => {
    if (!editable || busy) return;
    setDraft(toggleRaceAssignment(pairs, pair));
    setNotice(null);
  };

  const removeOrphan = (stationKey: string) => {
    setDraft(pairs.filter((pair) => pair.stationKey !== stationKey));
    setNotice(null);
  };

  const run = async (body: Record<string, unknown>, success: string) => {
    setBusy(true);
    setNotice(null);
    try {
      const data = await postAssignments({ eventId: event.id, ...body });
      setPayload(data);
      setDraft(null);
      setNotice({ tone: 'ok', text: success });
    } catch (cause) {
      setNotice({ tone: 'error', text: cause instanceof Error ? cause.message : 'Não foi possível gravar a escala.' });
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    const heatId = isDefault ? null : scope;
    const emptyWave = !isDefault && pairs.length === 0;
    void run(
      { action: 'save_assignments', heatId, assignments: pairs },
      emptyWave
        ? 'Escala gravada. A onda ficou sem nenhum judge e por isso segue o padrão do evento.'
        : isDefault ? 'Escala do padrão do evento gravada.' : `Escala da ${wave?.title ?? 'onda'} gravada.`
    );
  };

  const backToDefault = () => {
    if (!wave || !window.confirm(`Voltar a ${wave.title} ao padrão do evento? As linhas próprias desta onda serão apagadas.`)) return;
    void run({ action: 'clear_wave_assignments', heatId: wave.id }, `${wave.title} voltou a seguir o padrão do evento.`);
  };

  const adjustWave = () => {
    // Copia o padrão (sem as estações que saíram do percurso) para a onda ter um conjunto explícito.
    setDraft(toPairs(payload?.defaultRows ?? []).filter((pair) => known.has(pair.stationKey)));
    setNotice(null);
  };

  const scopeButton = (id: string, label: string, badge: string | null, sub?: string) => (
    <button
      key={id}
      type="button"
      role="radio"
      aria-checked={scope === id}
      onClick={() => changeScope(id)}
      className={`flex min-h-11 flex-col items-start justify-center rounded-md border-2 px-3 py-2 text-left ${scope === id ? 'border-primary bg-primary/10' : 'border-card-border bg-dark-gray hover:border-primary'}`}
    >
      <span className="text-sm font-bold">{label}</span>
      <span className="flex flex-wrap items-center gap-1 text-[11px] text-muted">
        {sub && <span className="tabular-nums">{sub}</span>}
        {badge && (
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${badge === 'Ajustada' ? 'border-primary text-primary' : 'border-card-border text-muted'}`}>{badge}</span>
        )}
      </span>
    </button>
  );

  return (
    <section ref={sectionRef} id="race-assignments" className="scroll-mt-4 space-y-4 rounded-xl border border-card-border bg-card p-5" aria-labelledby="race-assignments-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Equipe de arbitragem</p>
          <h3 id="race-assignments-title" className="text-lg font-bold uppercase">Escala de judges</h3>
          <p className="max-w-[60ch] text-xs text-muted">
            Quem fica em cada estação, no evento todo e, quando precisar, onda a onda. A escala orienta o judge e o painel de cobertura; um judge fora dela ainda abre a estação em que estiver.
          </p>
        </div>
        <button type="button" className={raceButton} onClick={() => void load()} disabled={busy}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" /> Atualizar
        </button>
      </div>

      {error ? (
        <p role="alert" className="rounded-md border border-red-500/40 bg-red-950/20 px-3 py-2 text-sm">{error}</p>
      ) : !payload ? (
        <p role="status" className="text-sm text-muted">Carregando a escala…</p>
      ) : payload.judges.length === 0 ? (
        <p className="text-sm text-muted">Nenhum judge atribuído ao evento. Atribua os judges na seção &quot;Judges do evento&quot; e toque em Atualizar.</p>
      ) : payload.stations.length === 0 && orphanKeys.length === 0 ? (
        <p className="text-sm text-muted">Nenhuma estação no percurso. Monte o percurso das categorias na construção da prova.</p>
      ) : (
        <>
          <div role="radiogroup" aria-label="Escopo da escala" className="flex flex-wrap gap-2">
            {scopeButton(DEFAULT_SCOPE, 'Padrão do evento', null, 'Vale para toda onda que não for ajustada')}
            {payload.waves.map((item) => scopeButton(item.id, item.title, describeRaceAssignmentScope(item.adjusted), item.time ? `${item.time} previsto` : undefined))}
          </div>

          {!isDefault && wave && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-card-border bg-dark-gray/40 px-3 py-2">
              <p className="text-xs text-muted">
                {following && draft === null
                  ? `${wave.title} segue o padrão do evento. Para tirar ou trocar um judge só nesta onda, ajuste a onda.`
                  : following
                    ? `Ajustando ${wave.title} a partir do padrão. Grave para a onda passar a ter a escala própria.`
                    : `${wave.title} tem a escala própria: ela substitui o padrão nesta onda.`}
                {wave.startedAt && ` Esta onda largou às ${formatRaceClock(wave.startedAt, payload.event.timeZone)}: a mudança vale daqui em diante e os cartões já abertos ficam com o judge deles.`}
              </p>
              {following && draft === null ? (
                <button type="button" className={raceButton} onClick={adjustWave} disabled={busy}>
                  <SlidersHorizontal className="h-4 w-4" aria-hidden="true" /> Ajustar esta onda
                </button>
              ) : wave.adjusted ? (
                <button type="button" className={raceButton} onClick={backToDefault} disabled={busy}>
                  <RotateCcw className="h-4 w-4" aria-hidden="true" /> Voltar ao padrão
                </button>
              ) : null}
            </div>
          )}

          <div className="overflow-x-auto rounded-lg border border-card-border">
            <table className="w-full min-w-max border-collapse text-sm" aria-label="Matriz estações x judges">
              <thead>
                <tr className="bg-dark-gray">
                  <th scope="col" className="sticky left-0 bg-dark-gray px-3 py-2 text-left text-xs font-bold uppercase tracking-wider">Estação</th>
                  {payload.judges.map((judge) => (
                    <th key={judge.id} scope="col" className="px-2 py-2 text-center text-xs font-bold">{judge.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {payload.stations.map((station) => {
                  const empty = pairs.length > 0 && uncovered.includes(station.key);
                  return (
                    <tr key={station.key} className="border-t border-card-border">
                      <th scope="row" className="sticky left-0 bg-card px-3 py-2 text-left align-middle">
                        <span className="block font-bold">{station.name}</span>
                        <span className="block text-[11px] font-normal text-muted">
                          {[station.kindLabel, station.meta, station.categories.join(', ')].filter(Boolean).join(' · ')}
                        </span>
                        {empty && <span className="mt-1 inline-block rounded-full border border-amber-400/60 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">Sem judge</span>}
                      </th>
                      {payload.judges.map((judge) => {
                        const pair = { judgeUserId: judge.id, stationKey: station.key };
                        const on = selected.has(raceAssignmentPairKey(pair));
                        return (
                          <td key={judge.id} className="px-2 py-1 text-center">
                            <button
                              type="button"
                              aria-pressed={on}
                              aria-label={`${judge.name} em ${station.name}`}
                              disabled={!editable || busy}
                              onClick={() => toggle(pair)}
                              className={cellClass(on, !editable || busy)}
                            >
                              {on && <Check className="h-5 w-5" aria-hidden="true" />}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                {orphanKeys.map((key) => (
                  <tr key={key} className="border-t border-card-border bg-amber-950/20">
                    <th scope="row" className="sticky left-0 bg-card px-3 py-2 text-left align-middle">
                      <span className="block font-bold">{key}</span>
                      <span className="block text-[11px] font-normal text-amber-300">Estação que saiu do percurso (renomeada ou removida)</span>
                    </th>
                    <td colSpan={payload.judges.length} className="px-2 py-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-muted">
                          {pairs.filter((pair) => pair.stationKey === key).map((pair) => payload.judges.find((judge) => judge.id === pair.judgeUserId)?.name ?? pair.judgeUserId).join(', ')}
                        </span>
                        {editable && (
                          <button type="button" className={raceButton} onClick={() => removeOrphan(key)} disabled={busy}>
                            <Trash2 className="h-4 w-4" aria-hidden="true" /> Remover linha
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {uncovered.length > 0 && (
            <p role="note" className="flex items-start gap-2 rounded-md border border-amber-400/50 bg-amber-950/30 px-3 py-2 text-xs">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
              <span>
                Sem judge escalado: {uncovered.map(stationName).join(', ')}. Dá para gravar assim: a estação funciona com o judge que estiver nela.
              </span>
            </p>
          )}
          {pairs.length === 0 && (
            <p className="text-xs text-muted">
              {isDefault ? 'Nenhum judge escalado no padrão do evento.' : 'Nenhum judge marcado. Onda ajustada sem nenhum judge volta a seguir o padrão do evento.'}
            </p>
          )}
          {orphanKeys.length > 0 && (
            <p role="note" className="text-xs text-amber-300">
              Há linhas de estação que não está mais no percurso. Elas não são apagadas sozinhas: remova a linha e grave.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={!dirty || busy}
              className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md bg-primary px-4 text-xs font-bold uppercase tracking-wider text-ink disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Gravando…' : 'Gravar escala'}
            </button>
            {draft !== null && (
              <button type="button" className={raceButton} onClick={() => { setDraft(null); setNotice(null); }} disabled={busy}>
                Descartar
              </button>
            )}
            {dirty && <span className="text-xs text-muted">Alterações não gravadas</span>}
          </div>
        </>
      )}

      {notice && (
        <p
          role={notice.tone === 'error' ? 'alert' : 'status'}
          aria-live="polite"
          className={`rounded-md border px-3 py-2 text-sm ${notice.tone === 'error' ? 'border-red-500/40 bg-red-950/20' : 'border-trading-up/50 bg-dark-gray/40'}`}
        >
          {notice.text}
        </p>
      )}
    </section>
  );
}
