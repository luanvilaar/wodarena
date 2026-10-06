import { sendQualifierResultUpdatedEmail } from '@/lib/resend';
import { createSupabaseAdmin } from '@/lib/serverSecurity';

export type QualifierResultChange = 'manager_entry' | 'validated' | 'penalized' | 'rejected' | 'manual_adjustment';

export const QUALIFIER_RESULT_CHANGE_LABELS: Record<QualifierResultChange, string> = {
  manager_entry: 'Lançado pela organização',
  validated: 'Validado',
  penalized: 'Penalizado (-15%)',
  rejected: 'Rejeitado',
  manual_adjustment: 'Ajuste manual'
};

type SubmissionRow = {
  event_id: string;
  workout_id: string;
  registration_id: string;
  final_result: string | null;
};

// Best-effort: a decisão já foi confirmada pelo banco. Falha no e-mail só é
// registrada em log e nunca desfaz nem falha a requisição.
export const notifyAthleteOfQualifierResult = async (
  supabaseAdmin: ReturnType<typeof createSupabaseAdmin>,
  params: { submissionId: string; change: QualifierResultChange; justification: string }
) => {
  try {
    const { data: submission } = await supabaseAdmin
      .from('score_submissions')
      .select('event_id, workout_id, registration_id, final_result')
      .eq('id', params.submissionId)
      .maybeSingle<SubmissionRow>();
    if (!submission) return;

    const [{ data: registration }, { data: event }, { data: workout }] = await Promise.all([
      supabaseAdmin.from('registrations').select('athlete_email, athlete_name').eq('id', submission.registration_id).maybeSingle(),
      supabaseAdmin.from('events').select('name').eq('id', submission.event_id).maybeSingle(),
      supabaseAdmin.from('workouts').select('name').eq('id', submission.workout_id).maybeSingle()
    ]);

    if (!registration?.athlete_email) {
      console.error('[Qualifier Result Notification] Inscrição sem e-mail do atleta; aviso não enviado.', params.submissionId);
      return;
    }

    await sendQualifierResultUpdatedEmail({
      to: registration.athlete_email,
      athleteName: registration.athlete_name || 'Atleta',
      eventName: event?.name || 'Evento WODArena',
      workoutName: workout?.name || 'Prova',
      launchedByOrganization: params.change === 'manager_entry',
      situationLabel: QUALIFIER_RESULT_CHANGE_LABELS[params.change],
      finalResult: submission.final_result || undefined,
      justification: params.justification
    });
  } catch (error) {
    console.error('[Qualifier Result Notification] Erro ao notificar atleta por e-mail:', error);
  }
};
