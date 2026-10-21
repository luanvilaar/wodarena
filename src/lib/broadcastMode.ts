// O que o telão mostra agora (Story 1.56). Puro. O telão detecta pelas súmulas
// quem está sendo julgado, sem depender do horário do cronograma (atrasos são
// comuns): o cronograma só dá a ordem das baterias, as raias e os nomes.
//
// Grupo = as súmulas de uma bateria (heat_id = id do item do cronograma) ou,
// sem bateria, as de uma prova e categoria. Regras do modo automático:
// 1. Ao vivo: o grupo com súmula em andamento que recebeu registro há pouco.
// 2. Intervalo: terminada a bateria (todas as súmulas enviadas, ou "Encerrar"
//    na mesa), o geral da categoria fica no ar por pelo menos 90 s.
// 3. Chamada: súmulas abertas da próxima bateria (judges nas raias, nenhum
//    toque ainda em nenhuma súmula do grupo) ou chamada liberada no cronograma.
// 4. Sem chamada, o geral da última bateria continua no ar; sem nenhuma
//    bateria terminada, a tela de espera.
// O gestor pode fixar uma bateria, o geral de uma categoria ou a espera.

export type BroadcastMode = 'auto' | 'pin_heat' | 'pin_standings' | 'standby';
export const BROADCAST_MODES: readonly BroadcastMode[] = ['auto', 'pin_heat', 'pin_standings', 'standby'];

/** Súmula sem registro novo há mais que isto não segura a bateria no ar (judge que esqueceu de enviar). */
export const LIVE_STALE_MS = 20 * 60_000;
/** Tempo mínimo do geral no ar depois que a bateria termina, antes de a chamada da próxima entrar. */
export const INTERVAL_MIN_MS = 90_000;

export type ModeSheet = {
  heatId: string | null;
  workoutId: string;
  divisionId: string | null;
  status: 'in_progress' | 'submitted' | 'returned' | 'cancelled';
  /** Registros no log (0 = aberta, sem toque). */
  seq: number;
  updatedAt: string;
  submittedAt: string | null;
};

export type ModeHeat = { id: string; order: number; isCallReleased: boolean };
export type HeatMark = { heatId: string; startedAt: string | null; finishedAt: string | null };

export type BroadcastResolution =
  | { screen: 'live'; groupKey: string; reason: 'auto' | 'pinned' }
  | { screen: 'call'; groupKey: string; reason: 'sheets_opened' | 'call_released' | 'pinned' }
  | { screen: 'interval'; groupKey: string | null; divisionIds: string[]; reason: 'auto' | 'pinned' }
  | { screen: 'standby'; reason: 'auto' | 'pinned' };

export type ResolveInput = {
  mode: BroadcastMode;
  pinnedHeatId: string | null;
  pinnedDivisionId: string | null;
  heats: readonly ModeHeat[];
  sheets: readonly ModeSheet[];
  marks: readonly HeatMark[];
  nowMs: number;
};

export const sheetGroupKey = (sheet: Pick<ModeSheet, 'heatId' | 'workoutId' | 'divisionId'>) => (
  sheet.heatId || `loose:${sheet.workoutId}:${sheet.divisionId ?? ''}`
);

type Group = {
  key: string;
  sheets: ModeSheet[];
  lastActivityMs: number;
  live: boolean;
  opened: boolean;
  finishedMs: number | null;
};

const time = (iso: string | null | undefined) => {
  const parsed = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

export const buildGroups = (input: Pick<ResolveInput, 'sheets' | 'marks' | 'nowMs'>) => {
  const marks = new Map(input.marks.map((mark) => [mark.heatId, mark]));
  const byKey = new Map<string, ModeSheet[]>();
  for (const sheet of input.sheets) {
    if (sheet.status === 'cancelled') continue;
    const key = sheetGroupKey(sheet);
    byKey.set(key, [...(byKey.get(key) ?? []), sheet]);
  }
  const groups: Group[] = [];
  for (const [key, sheets] of byKey) {
    const mark = marks.get(key);
    const manualFinish = time(mark?.finishedAt);
    const fresh = (sheet: ModeSheet) => (time(sheet.updatedAt) ?? 0) >= input.nowMs - LIVE_STALE_MS;
    const running = sheets.filter((sheet) => sheet.status === 'in_progress' && fresh(sheet));
    const lastActivityMs = Math.max(0, ...sheets.map((sheet) => time(sheet.updatedAt) ?? 0));
    const live = manualFinish === null && running.some((sheet) => sheet.seq > 0);
    const submitted = sheets.filter((sheet) => sheet.status === 'submitted');
    // Chamada só antes do primeiro toque: se a bateria já tem registro ou envio,
    // uma súmula aberta e sem toque (raia vazia, aberta por engano) não a segura
    // como "aberta" nem impede o fim automático pelo último envio.
    // Troca aceita: no grupo sem bateria (`loose:`, prova e categoria), depois do
    // primeiro envio a próxima leva da mesma prova e categoria não ganha mais
    // Chamada; o geral fica no ar até o primeiro registro dela, que vai ao vivo.
    const touched = submitted.length > 0 || sheets.some((sheet) => sheet.seq > 0);
    const opened = manualFinish === null && !live && !touched && running.length > 0;
    const autoFinish = !live && !opened && submitted.length > 0
      ? Math.max(...submitted.map((sheet) => time(sheet.submittedAt) ?? time(sheet.updatedAt) ?? 0))
      : null;
    groups.push({ key, sheets, lastActivityMs, live, opened, finishedMs: manualFinish ?? autoFinish });
  }
  return groups;
};

const divisionsOf = (group: Group | undefined) => (
  group ? [...new Set(group.sheets.map((sheet) => sheet.divisionId).filter((id): id is string => Boolean(id)))] : []
);

const latest = (groups: Group[], pick: (group: Group) => number | null) => groups
  .map((group) => ({ group, at: pick(group) }))
  .filter((item): item is { group: Group; at: number } => item.at !== null)
  .sort((a, b) => b.at - a.at)[0]?.group;

/** `groups` aceita o resultado de buildGroups já calculado pelo chamador (mesma entrada). */
export const resolveBroadcast = (input: ResolveInput, groups: Group[] = buildGroups(input)): BroadcastResolution => {
  const byKey = new Map(groups.map((group) => [group.key, group]));

  if (input.mode === 'standby') return { screen: 'standby', reason: 'pinned' };
  if (input.mode === 'pin_standings' && input.pinnedDivisionId) {
    return { screen: 'interval', groupKey: null, divisionIds: [input.pinnedDivisionId], reason: 'pinned' };
  }
  if (input.mode === 'pin_heat' && input.pinnedHeatId) {
    const pinned = byKey.get(input.pinnedHeatId);
    const started = pinned?.sheets.some((sheet) => sheet.seq > 0);
    return started
      ? { screen: 'live', groupKey: input.pinnedHeatId, reason: 'pinned' }
      : { screen: 'call', groupKey: input.pinnedHeatId, reason: 'pinned' };
  }

  const live = latest(groups.filter((group) => group.live), (group) => group.lastActivityMs);
  if (live) return { screen: 'live', groupKey: live.key, reason: 'auto' };

  const finished = latest(groups, (group) => group.finishedMs);
  const interval = finished
    ? { screen: 'interval' as const, groupKey: finished.key, divisionIds: divisionsOf(finished), reason: 'auto' as const }
    : null;
  if (interval && finished && input.nowMs - (finished.finishedMs as number) < INTERVAL_MIN_MS) return interval;

  const opened = latest(groups.filter((group) => group.opened), (group) => group.lastActivityMs);
  if (opened) return { screen: 'call', groupKey: opened.key, reason: 'sheets_opened' };

  const released = nextHeat(input.heats, groups, (heat) => heat.isCallReleased);
  if (released) return { screen: 'call', groupKey: released.id, reason: 'call_released' };

  return interval ?? { screen: 'standby', reason: 'auto' };
};

/** Próxima bateria do cronograma ainda sem súmula, na ordem oficial (o filtro opcional restringe). */
export const nextHeat = <H extends ModeHeat>(
  heats: readonly H[],
  groups: readonly Pick<Group, 'key' | 'finishedMs'>[],
  accept: (heat: H) => boolean = () => true
): H | undefined => {
  const touched = new Set(groups.map((group) => group.key));
  const lastDone = Math.max(-1, ...heats.filter((heat) => touched.has(heat.id)).map((heat) => heat.order));
  return [...heats]
    .sort((a, b) => a.order - b.order)
    .find((heat) => heat.order > lastDone && !touched.has(heat.id) && accept(heat));
};
