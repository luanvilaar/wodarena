import type { ScoreSubmission } from '@/types';

// Situação do envio como o atleta lê na área dele (Story 1.109): mesmos nomes
// do e-mail da decisão (qualifierDecisionEmail.ts) e do painel do gestor.

export type QualifierAthleteSituation =
  | 'pending_review'
  | 'validated'
  | 'adjusted'
  | 'penalized'
  | 'rejected'
  | 'awaiting_resubmission';

export const QUALIFIER_ATHLETE_SITUATION_LABELS: Record<QualifierAthleteSituation, string> = {
  pending_review: 'Em análise',
  validated: 'Validado',
  adjusted: 'Ajustado',
  penalized: 'Penalizado (−15%)',
  rejected: 'Rejeitado',
  awaiting_resubmission: 'Novo envio solicitado'
};

// Texto e cor juntos no selo; a cor nunca é a única pista.
export const QUALIFIER_ATHLETE_SITUATION_CLASSES: Record<QualifierAthleteSituation, string> = {
  pending_review: 'border-card-border bg-dark-gray text-muted',
  validated: 'border-trading-up/40 bg-trading-up/10 text-trading-up',
  adjusted: 'border-info/40 bg-info/10 text-info',
  penalized: 'border-primary/40 bg-primary/10 text-primary',
  rejected: 'border-trading-down/40 bg-trading-down/10 text-trading-down',
  awaiting_resubmission: 'border-primary/40 bg-primary/10 text-primary'
};

type SubmissionView = Pick<ScoreSubmission, 'status' | 'entrySource' | 'latestDecision' | 'submittedResult' | 'finalResult'>;

export const getQualifierAthleteSituation = (submission: SubmissionView): QualifierAthleteSituation => {
  // O ajuste manual grava status 'validated'; o lançamento pela organização
  // também grava a decisão 'manual_adjustment', mas não é um ajuste do envio.
  if (submission.status === 'validated'
    && submission.entrySource === 'athlete'
    && submission.latestDecision?.decision === 'manual_adjustment') return 'adjusted';
  return submission.status;
};

export const getQualifierAthleteOfficialResult = (submission: SubmissionView) => (
  submission.status === 'pending_review' || submission.status === 'awaiting_resubmission'
    ? undefined
    : submission.finalResult
);

export const getQualifierAthleteNoteLabel = (submission: SubmissionView) => (
  submission.latestDecision?.decidedBy === 'judge' ? 'Observação da arbitragem' : 'Observação da organização'
);
