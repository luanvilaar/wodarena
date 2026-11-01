import type { AppLocale, ScoreSubmissionStatus } from '@/types';
import { sendQualifierDecisionEmail } from '@/lib/resend';
import { createSupabaseAdmin } from '@/lib/serverSecurity';
import {
  getQualifierDecisionActor,
  type QualifierDecisionKind,
  type QualifierReviewDecision
} from '@/lib/qualifierDecisionEmail';

export type { QualifierDecisionKind, QualifierReviewDecision };

type SubmissionRow = {
  event_id: string;
  workout_id: string;
  division_id: string | null;
  registration_id: string;
  submitted_result: string | null;
  final_result: string | null;
};

// Best-effort: a decisão já foi confirmada pelo banco. Falha no e-mail só é
// registrada em log e nunca desfaz nem falha a requisição.
export const notifyAthleteOfQualifierResult = async (
  supabaseAdmin: ReturnType<typeof createSupabaseAdmin>,
  params: {
    submissionId: string;
    change: QualifierDecisionKind;
    // Papel de quem decidiu: judge vira "a arbitragem"; gestor e owner, "a organização".
    actorRole: string;
    justification: string;
    // Lido antes do RPC: na edição e no novo envio o resultado anterior some depois dele.
    previous?: { status: ScoreSubmissionStatus; result: string | null };
    editDecision?: QualifierReviewDecision;
  }
) => {
  try {
    const { data: submission, error } = await supabaseAdmin
      .from('score_submissions')
      .select('event_id, workout_id, division_id, registration_id, submitted_result, final_result')
      .eq('id', params.submissionId)
      .maybeSingle<SubmissionRow>();
    if (error) throw error;
    if (!submission) {
      console.error('[Qualifier Result Notification] Submissão não encontrada; aviso não enviado.', params.submissionId);
      return;
    }

    const [{ data: registration }, { data: event }, { data: workout }, { data: division }] = await Promise.all([
      supabaseAdmin.from('registrations').select('athlete_email, athlete_name, locale').eq('id', submission.registration_id).maybeSingle(),
      supabaseAdmin.from('events').select('name').eq('id', submission.event_id).maybeSingle(),
      supabaseAdmin.from('workouts').select('name, type, submission_closes_at').eq('id', submission.workout_id).maybeSingle(),
      submission.division_id
        ? supabaseAdmin.from('divisions').select('name').eq('id', submission.division_id).maybeSingle()
        : Promise.resolve({ data: null })
    ]);

    if (!registration?.athlete_email) {
      console.error('[Qualifier Result Notification] Inscrição sem e-mail do atleta; aviso não enviado.', params.submissionId);
      return;
    }

    await sendQualifierDecisionEmail({
      to: registration.athlete_email,
      eventId: submission.event_id,
      email: {
        locale: (registration.locale || 'pt-br') as AppLocale,
        kind: params.change,
        actor: getQualifierDecisionActor(params.actorRole),
        athleteName: registration.athlete_name || 'Atleta',
        eventName: event?.name || 'Evento WODArena',
        workoutName: workout?.name || 'Prova',
        workoutType: workout?.type,
        divisionName: division?.name,
        submittedResult: submission.submitted_result,
        officialResult: submission.final_result,
        previousStatus: params.previous?.status,
        previousResult: params.previous?.result,
        editDecision: params.editDecision,
        justification: params.justification,
        submissionClosesAt: workout?.submission_closes_at
      }
    });
  } catch (error) {
    console.error('[Qualifier Result Notification] Erro ao notificar atleta por e-mail:', error);
  }
};
