import { SCORESHEET_REVIEW_LABELS, type ScoresheetReviewAction } from '@/lib/scoresheet';
import { formatMeters, formatTonnageKg } from '@/lib/workoutStructure';

// Comprovante de envio da súmula digital (Stories 1.144 a 1.146; plano aprovado
// em docs/design/comprovante-sumula/). Módulo puro: monta o comprovante a partir
// das linhas do banco (súmula, prova, evento, atleta, bateria do cronograma,
// histórico e resultado atual do ranking). A rota, a página e as telas usam o
// que sai daqui; os testes importam direto.
//
// - O comprovante é sempre o estado atual da súmula (D5). Súmula nunca enviada
//   não tem comprovante.
// - Correção e lançamento à mão mostram também o que o judge enviou (D4). A
//   linha do tempo não traz justificativas nem o nome do gestor; ações do judge
//   mostram o nome dele, que é o árbitro do comprovante (D3).
// - Sem e-mail, telefone ou CPF: nada disso entra aqui.

export type SheetReceiptState = 'published' | 'corrected' | 'manual' | 'returned' | 'absent' | 'cancelled';

export const SHEET_RECEIPT_STATE_LABELS: Record<SheetReceiptState, string> = {
  published: 'Publicada',
  corrected: 'Corrigida pelo gestor',
  manual: 'Lançada à mão',
  returned: 'Devolvida',
  absent: 'Ausente',
  cancelled: 'Cancelada'
};

export type SheetReceiptInput = {
  sheet: {
    id: string;
    status: string;
    absent?: boolean | null;
    corrected?: boolean | null;
    official_result?: string | null;
    official_tie_break?: string | null;
    computed_result?: string | null;
    heat_number?: number | null;
    lane?: number | null;
    judge_name?: string | null;
    created_at?: string | null;
    submitted_at?: string | null;
    structure?: { format?: string | null; timeCapSeconds?: number | null } | null;
  };
  event: { name: string; date?: string | null; location?: string | null; city?: string | null; state?: string | null; time_zone?: string | null };
  workout: { code?: string | null; name?: string | null; description?: string | null; tie_breaker?: string | null } | null;
  athlete: { name?: string | null; box?: string | null } | null;
  divisionName?: string | null;
  heat: { date?: string | null; time?: string | null } | null;
  reviews: {
    action: string;
    actor_name?: string | null;
    actor_role?: string | null;
    previous_result?: string | null;
    applied_result?: string | null;
    created_at: string;
  }[];
  /** Resultado atual do ranking para o atleta nesta prova. */
  score: { result?: string | null; scoresheet_id?: string | null } | null;
  /** Resumo da súmula do judge ("6 rounds + 27 (total 387)"), quando dá para calcular. */
  summary?: string | null;
};

/** Linha da Área do Atleta: uma prova da inscrição, com o comprovante quando há súmula enviada. */
export type AthleteReceiptItem = {
  workoutId: string;
  code: string;
  receipt: {
    sheetId: string;
    state: SheetReceiptState;
    stateLabel: string;
    result: string;
    struck: boolean;
    heatNumber: number | null;
    lane: number | null;
    scheduled: string | null;
    judgeName: string;
    path: string;
  } | null;
};

export type AthleteReceiptRegistration = { registrationId: string; eventId: string; provas: AthleteReceiptItem[] };

export type SheetReceiptTimelineItem = { at: string; label: string; detail: string };

export type SheetReceipt = {
  sheetId: string;
  code: string;
  state: SheetReceiptState;
  stateLabel: string;
  seal: { title: string; text: string };
  event: { name: string; initials: string; subtitle: string };
  workout: { code: string; name: string; format: string; movements: string[]; tieBreaker: string };
  athlete: { name: string; members: string; box: string; division: string };
  heat: { number: number | null; lane: number | null; scheduled: string | null };
  judgeName: string;
  openedAt: string;
  sentAt: string;
  sentLabel: string;
  result: { value: string; unit: string; tieBreak: string | null; struck: boolean; official: boolean };
  /** O que o judge enviou, quando o resultado oficial é outro (corrigida ou lançada à mão). */
  judgeResult: string | null;
  summary: string | null;
  timeline: SheetReceiptTimelineItem[];
};

const DEFAULT_TIME_ZONE = 'America/Fortaleza';

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

/** "15/11, 10:59" no fuso do evento. */
export const formatReceiptMoment = (iso: string | null | undefined, timeZone?: string | null): string => {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const options: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false };
  try {
    return date.toLocaleString('pt-BR', { ...options, timeZone: timeZone || DEFAULT_TIME_ZONE });
  } catch {
    return date.toLocaleString('pt-BR', { ...options, timeZone: DEFAULT_TIME_ZONE });
  }
};

/** Código curto da súmula para citar numa contestação. */
export const getSheetReceiptCode = (sheetId: string) => sheetId.replace(/[^a-zA-Z0-9]/g, '').slice(-8).toUpperCase();

const eventInitials = (name: string) => {
  const words = name.split(/\s+/).filter((word) => /[a-zA-ZÀ-ÿ0-9]/.test(word) && word.length > 2);
  const picked = (words.length ? words : name.split(/\s+/)).slice(0, 2).map((word) => word[0] ?? '');
  return picked.join('').toUpperCase() || 'W';
};

const minutes = (seconds: number) => (seconds % 60 === 0 ? `${seconds / 60} min` : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`);

/** "AMRAP 12 min", "For time · cap 10 min", "Carga máxima"... */
export const formatReceiptWorkoutFormat = (structure: SheetReceiptInput['sheet']['structure']) => {
  const cap = typeof structure?.timeCapSeconds === 'number' && structure.timeCapSeconds > 0 ? structure.timeCapSeconds : null;
  switch (structure?.format) {
    case 'amrap': return cap ? `AMRAP ${minutes(cap)}` : 'AMRAP';
    case 'for_time': return cap ? `For time · cap ${minutes(cap)}` : 'For time';
    case 'max_load': return cap ? `Carga máxima · janela de ${minutes(cap)}` : 'Carga máxima';
    case 'interval': return cap ? `Intervalado · ${minutes(cap)}` : 'Intervalado';
    case 'distance': return cap ? `Distância · ${minutes(cap)}` : 'Distância';
    case 'tonnage': return cap ? `Tonelagem · ${minutes(cap)}` : 'Tonelagem';
    default: return '';
  }
};

/** Resultado como a súmula o escreve, separado da unidade. */
export const formatReceiptResult = (raw: string | null | undefined, format: string | null | undefined): { value: string; unit: string } => {
  const value = text(raw);
  if (!value) return { value: '—', unit: '' };
  const numeric = Number(value);
  if (format === 'distance' && Number.isFinite(numeric)) return { value: formatMeters(numeric), unit: 'm' };
  if (format === 'tonnage' && Number.isFinite(numeric)) return { value: formatTonnageKg(numeric), unit: 'kg' };
  if (format === 'max_load') return { value: value.replace('.', ','), unit: 'kg' };
  if (format === 'amrap' && /^\d+$/.test(value)) return { value, unit: 'reps' };
  return { value, unit: '' };
};

const splitTeam = (name: string) => {
  const match = /^(.+?)\s*\((.+)\)$/.exec(name);
  return match ? { name: match[1].trim(), members: match[2].trim() } : { name, members: '' };
};

const scheduledLabel = (heat: SheetReceiptInput['heat']) => {
  const time = text(heat?.time);
  if (!time) return null;
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text(heat?.date));
  return date ? `${date[3]}/${date[2]}, ${time}` : time;
};

const byTime = (a: { created_at: string }, b: { created_at: string }) => a.created_at.localeCompare(b.created_at);

/** Monta o comprovante. Súmula nunca enviada: null. */
export const buildSheetReceipt = (input: SheetReceiptInput): SheetReceipt | null => {
  const { sheet } = input;
  if (!sheet.submitted_at) return null;
  const tz = input.event.time_zone;
  const format = sheet.structure?.format ?? null;
  const reviews = [...input.reviews].sort(byTime);
  const last = (actions: string[]) => [...reviews].reverse().find((review) => actions.includes(review.action)) ?? null;

  const lastSend = last(['submitted', 'absent']);
  const judgeSent = text(lastSend?.applied_result) || text(sheet.computed_result) || text(sheet.official_result);
  const scoreFromOther = Boolean(input.score && text(input.score.result) && input.score.scoresheet_id !== sheet.id);

  let state: SheetReceiptState;
  let official = text(sheet.official_result);
  let changedAt: string | null = null;
  if (sheet.status === 'cancelled') {
    state = 'cancelled';
    changedAt = last(['cancelled'])?.created_at ?? null;
  } else if (scoreFromOther) {
    state = 'manual';
    official = text(input.score?.result);
    changedAt = last(['manual_override'])?.created_at ?? null;
  } else if (sheet.status === 'returned') {
    state = 'returned';
    changedAt = last(['returned'])?.created_at ?? null;
  } else if (sheet.absent) {
    state = 'absent';
  } else if (sheet.corrected) {
    state = 'corrected';
    changedAt = last(['corrected'])?.created_at ?? null;
  } else {
    state = 'published';
  }

  const shown = formatReceiptResult(official, format);
  const sentAt = formatReceiptMoment(sheet.submitted_at, tz);
  const changedLabel = formatReceiptMoment(changedAt, tz);
  const unitText = shown.unit ? ` ${shown.unit}` : '';
  const seal: Record<SheetReceiptState, { title: string; text: string }> = {
    published: { title: 'Publicada no ranking', text: `Enviada pelo judge em ${sentAt}.` },
    corrected: { title: 'Corrigida pelo gestor', text: `O ranking usa ${shown.value}${unitText}${changedLabel ? ` desde ${changedLabel}` : ''}.` },
    manual: { title: 'Resultado lançado à mão pelo gestor', text: `O ranking usa o resultado lançado${changedLabel ? ` desde ${changedLabel}` : ''}.` },
    returned: { title: 'Devolvida ao judge para correção', text: 'O resultado acima continua no ranking até o novo envio.' },
    absent: { title: 'Atleta ausente', text: `Marcado em ${sentAt}.` },
    cancelled: { title: 'Súmula cancelada pelo gestor', text: `O resultado saiu do ranking${changedLabel ? ` em ${changedLabel}` : ''}. Se outra súmula for aberta para o atleta, ela terá o próprio comprovante.` }
  };

  const judgeResult = (state === 'corrected' || state === 'manual') && judgeSent && judgeSent !== official
    ? (() => {
      const sent = formatReceiptResult(judgeSent, format);
      return `${sent.value}${sent.unit ? ` ${sent.unit}` : ''}`;
    })()
    : null;

  const team = splitTeam(text(input.athlete?.name));
  const place = [text(input.event.location), [text(input.event.city), text(input.event.state)].filter(Boolean).join('/')].filter(Boolean).join(', ');
  const eventName = text(input.event.name) || 'Evento';

  return {
    sheetId: sheet.id,
    code: getSheetReceiptCode(sheet.id),
    state,
    stateLabel: SHEET_RECEIPT_STATE_LABELS[state],
    seal: seal[state],
    event: { name: eventName, initials: eventInitials(eventName), subtitle: [text(input.event.date), place].filter(Boolean).join(' · ') },
    workout: {
      code: text(input.workout?.code) || text(input.workout?.name) || 'Prova',
      name: text(input.workout?.name),
      format: formatReceiptWorkoutFormat(sheet.structure),
      movements: text(input.workout?.description).split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
      tieBreaker: text(input.workout?.tie_breaker)
    },
    athlete: { name: team.name || 'Atleta', members: team.members, box: text(input.athlete?.box), division: text(input.divisionName) },
    heat: { number: sheet.heat_number ?? null, lane: sheet.lane ?? null, scheduled: scheduledLabel(input.heat) },
    judgeName: text(sheet.judge_name),
    openedAt: formatReceiptMoment(sheet.created_at, tz),
    sentAt,
    sentLabel: state === 'absent' ? 'Ausência marcada' : 'Enviada',
    result: { value: shown.value, unit: shown.unit, tieBreak: state === 'manual' ? null : text(sheet.official_tie_break) || null, struck: state === 'cancelled', official: state === 'corrected' || state === 'manual' },
    judgeResult,
    summary: text(input.summary) || null,
    timeline: reviews.map((review) => {
      const byJudge = review.actor_role === 'judge';
      const previous = text(review.previous_result);
      const applied = text(review.applied_result);
      const change = previous && applied && previous !== applied ? `${previous} → ${applied}` : applied;
      return {
        at: formatReceiptMoment(review.created_at, tz),
        label: SCORESHEET_REVIEW_LABELS[review.action as ScoresheetReviewAction] ?? review.action,
        detail: [byJudge ? `por ${text(review.actor_name) || 'judge'}` : 'pelo gestor', change].filter(Boolean).join(' · ')
      };
    })
  };
};
