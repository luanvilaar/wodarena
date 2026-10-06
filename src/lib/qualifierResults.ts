import type { ScoreSubmissionEntrySource, ScoreSubmissionStatus } from '@/types';

/**
 * Estado de um atleta em uma prova na tela de lançamento de scores do Qualifier.
 * 'no_submission' = inscrição aprovada, mas sem nenhuma submissão.
 */
export type QualifierResultState = 'no_submission' | ScoreSubmissionStatus;

export type QualifierResultSubmission = {
  id: string;
  status: ScoreSubmissionStatus;
  entrySource: ScoreSubmissionEntrySource;
  submittedResult: string;
  finalResult?: string;
  currentVersion: number;
  // String crua de reviewed_at vinda da API. É o token de concorrência da
  // exclusão para reenvio e deve ser reenviada sem passar por new Date().
  reviewedAt?: string;
  reviewedByName?: string;
  videoUrl: string;
};

export type QualifierResultRow = {
  registrationId: string;
  athleteName: string;
  box: string;
  divisionId: string;
  divisionName: string;
  submission: QualifierResultSubmission | null;
};

export const QUALIFIER_RESULT_STATE_LABELS: Record<QualifierResultState, string> = {
  no_submission: 'Sem envio',
  pending_review: 'Em análise',
  validated: 'Validado',
  penalized: 'Penalizado (-15%)',
  rejected: 'Rejeitado',
  awaiting_resubmission: 'Aguardando reenvio do atleta'
};

export const QUALIFIER_RESULT_STATES = Object.keys(QUALIFIER_RESULT_STATE_LABELS) as QualifierResultState[];

const REVIEWED_STATES: QualifierResultState[] = ['validated', 'penalized', 'rejected'];

export const getQualifierResultState = (row: Pick<QualifierResultRow, 'submission'>): QualifierResultState =>
  row.submission?.status ?? 'no_submission';

/**
 * Quais ações cada estado permite. Espelha as regras do banco:
 *  - lançar: só sem resultado ativo (sem envio ou aguardando reenvio);
 *  - editar: submissão pendente (revisão) ou resultado já revisado;
 *  - excluir para reenvio: apenas resultado já revisado.
 */
export const getQualifierResultActions = (state: QualifierResultState) => ({
  canEnter: state === 'no_submission' || state === 'awaiting_resubmission',
  canEdit: state === 'pending_review' || REVIEWED_STATES.includes(state),
  canRequestResubmission: REVIEWED_STATES.includes(state)
});

const normalizeText = (value: string) => value
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .trim();

export const filterQualifierResultRows = (
  rows: QualifierResultRow[],
  filters: { search?: string; divisionId?: string; state?: QualifierResultState | 'all' }
) => {
  const search = normalizeText(filters.search || '');
  return rows.filter(row => {
    if (filters.divisionId && row.divisionId !== filters.divisionId) return false;
    if (filters.state && filters.state !== 'all' && getQualifierResultState(row) !== filters.state) return false;
    if (!search) return true;
    return normalizeText(row.athleteName).includes(search) || normalizeText(row.box).includes(search);
  });
};

export const summarizeQualifierResultRows = (rows: QualifierResultRow[]) => {
  const summary: Record<QualifierResultState, number> & { total: number } = {
    total: rows.length,
    no_submission: 0,
    pending_review: 0,
    validated: 0,
    penalized: 0,
    rejected: 0,
    awaiting_resubmission: 0
  };
  for (const row of rows) summary[getQualifierResultState(row)] += 1;
  return summary;
};
