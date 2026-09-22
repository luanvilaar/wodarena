import { ScoreSubmission, ScoreSubmissionReview } from '@/types';

type DbRow = Record<string, unknown>;

const optionalText = (value: unknown) => typeof value === 'string' && value.length > 0 ? value : undefined;
const optionalNumber = (value: unknown) => {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const mapScoreSubmissionFromDb = (row: DbRow): ScoreSubmission => ({
  id: String(row.id),
  eventId: String(row.event_id),
  workoutId: String(row.workout_id),
  divisionId: String(row.division_id),
  registrationId: String(row.registration_id),
  userId: String(row.user_id),
  athleteId: optionalText(row.athlete_id),
  submittedResult: String(row.submitted_result),
  submittedValue: Number(row.submitted_value),
  videoUrl: String(row.video_url),
  videoId: String(row.video_id),
  athleteNote: optionalText(row.athlete_note),
  status: String(row.status) as ScoreSubmission['status'],
  finalResult: optionalText(row.final_result),
  finalValue: optionalNumber(row.final_value),
  penaltyPercent: optionalNumber(row.penalty_percent),
  submittedAt: String(row.submitted_at),
  reviewedAt: optionalText(row.reviewed_at),
  reviewedBy: optionalText(row.reviewed_by),
  currentVersion: Number(row.current_version || 1),
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at)
});

export const mapScoreSubmissionReviewFromDb = (row: DbRow): ScoreSubmissionReview => ({
  id: String(row.id),
  submissionId: String(row.submission_id),
  submissionVersion: Number(row.submission_version),
  eventId: String(row.event_id),
  judgeUserId: optionalText(row.judge_user_id),
  judgeName: String(row.judge_name),
  judgeRole: String(row.judge_role) as ScoreSubmissionReview['judgeRole'],
  decision: String(row.decision) as ScoreSubmissionReview['decision'],
  penaltyPercent: optionalNumber(row.penalty_percent),
  previousResult: optionalText(row.previous_result),
  previousValue: optionalNumber(row.previous_value),
  appliedResult: optionalText(row.applied_result),
  appliedValue: optionalNumber(row.applied_value),
  justification: optionalText(row.justification),
  reviewedAt: String(row.reviewed_at)
});

export const qualifierErrorStatus = (message: string) => {
  if (message.includes('window_') || message.includes('version_conflict') || message.includes('already_reviewed') || message.includes('already_pending') || message.includes('conflict_of_interest')) return 409;
  if (message.includes('qualifier_submission_not_reviewed') || message.includes('qualifier_review_state_conflict') || message.includes('qualifier_open_contestation_exists') || message.includes('awaiting_resubmission')) return 409;
  if (message.includes('not_found')) return 404;
  if (message.includes('not_allowed') || message.includes('not_assigned') || message.includes('access_expired') || message.includes('not_eligible')) return 403;
  return 400;
};
