import { NextResponse } from 'next/server';
import { qualifierErrorStatus } from '@/lib/qualifierSubmissions';
import { sendQualifierResubmissionRequestedEmail } from '@/lib/resend';
import { assertQualifierEventManagerAccess, JudgeAccessError } from '@/lib/serverJudgeAccess';
import { checkRateLimit, createSupabaseAdmin, requireSession, safeErrorMessage } from '@/lib/serverSecurity';

type SubmissionRow = {
  id: string;
  event_id: string;
  workout_id: string;
  registration_id: string;
};

const readError = (error: unknown) => error && typeof error === 'object' && 'message' in error
  ? String(error.message)
  : '';

// Mensagens amigáveis para os erros conhecidos de qualifier_request_resubmission.
// O código cru do banco nunca é devolvido ao cliente.
const RESUBMISSION_ERROR_MESSAGES: Record<string, string> = {
  qualifier_submission_not_found: 'Submissão não encontrada.',
  qualifier_request_resubmission_not_allowed: 'Apenas o organizador do evento ou o owner podem excluir este resultado.',
  qualifier_manager_access_expired: 'O período de uso da plataforma para este gestor expirou.',
  qualifier_event_required: 'Esta operação é exclusiva de eventos Functional Fitness Qualifier.',
  qualifier_submission_not_reviewed: 'Só é possível excluir resultados já revisados (validados, penalizados ou rejeitados).',
  qualifier_review_state_conflict: 'Este resultado foi alterado desde que a lista foi carregada. Recarregue a lista e tente novamente.',
  qualifier_workout_not_found: 'Prova da submissão não encontrada.',
  qualifier_submission_deadline_required: 'A prova não possui prazo de envio configurado.',
  qualifier_submission_window_closed: 'O prazo de envio desta prova já foi encerrado. O atleta não conseguiria reenviar o resultado.',
  qualifier_open_contestation_exists: 'Existe uma contestação em análise para esta submissão. Resolva a contestação antes de excluir o resultado.',
  qualifier_request_resubmission_justification_required: 'Informe uma justificativa de até 2.000 caracteres.'
};

const resubmissionErrorMessage = (message: string) => {
  const code = Object.keys(RESUBMISSION_ERROR_MESSAGES).find(key => message.includes(key));
  return code ? RESUBMISSION_ERROR_MESSAGES[code] : 'Não foi possível excluir o resultado.';
};

// Best-effort: a exclusão já foi confirmada pelo banco. Falha no e-mail só é
// registrada em log e nunca desfaz nem falha a requisição.
const notifyAthlete = async (
  supabaseAdmin: ReturnType<typeof createSupabaseAdmin>,
  submission: SubmissionRow,
  justification: string
) => {
  try {
    const [{ data: registration }, { data: event }, { data: workout }] = await Promise.all([
      supabaseAdmin
        .from('registrations')
        .select('athlete_email, athlete_name')
        .eq('id', submission.registration_id)
        .maybeSingle(),
      supabaseAdmin
        .from('events')
        .select('name')
        .eq('id', submission.event_id)
        .maybeSingle(),
      supabaseAdmin
        .from('workouts')
        .select('name')
        .eq('id', submission.workout_id)
        .maybeSingle()
    ]);

    if (!registration?.athlete_email) {
      console.error('[Qualifier Resubmission API] Inscrição sem e-mail do atleta; aviso de reenvio não enviado.', submission.id);
      return;
    }

    await sendQualifierResubmissionRequestedEmail({
      to: registration.athlete_email,
      athleteName: registration.athlete_name || 'Atleta',
      eventName: event?.name || 'Evento WODArena',
      workoutName: workout?.name || 'Prova',
      justification
    });
  } catch (error) {
    console.error('[Qualifier Resubmission API] Erro ao notificar atleta por e-mail:', error);
  }
};

export async function POST(request: Request) {
  try {
    // Exclusão para reenvio é exclusiva do organizador (manager) e do owner.
    // Judges revisam submissões, mas não podem apagar resultados.
    const auth = requireSession(request, ['manager', 'owner']);
    if (auth.response) return auth.response;
    const rateLimited = checkRateLimit({ key: `qualifier-resubmission:${auth.user.id}`, limit: 10, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const body = await request.json() as {
      submissionId?: string;
      expectedReviewedAt?: string | null;
      justification?: string;
    };
    const submissionId = String(body.submissionId || '').trim();
    const justification = typeof body.justification === 'string' ? body.justification.trim() : '';
    // Token de concorrência: repassado exatamente como veio do banco. Converter
    // com new Date() trunca os microssegundos e o RPC sempre acusaria conflito.
    const expectedReviewedAt = typeof body.expectedReviewedAt === 'string' ? body.expectedReviewedAt : null;

    if (!submissionId) {
      return NextResponse.json({ error: 'Submissão é obrigatória.' }, { status: 400 });
    }
    if (!justification) {
      return NextResponse.json({ error: 'Informe a justificativa para excluir o resultado.' }, { status: 400 });
    }

    const supabaseAdmin = createSupabaseAdmin();
    const { data: submission, error: submissionError } = await supabaseAdmin
      .from('score_submissions')
      .select('id, event_id, workout_id, registration_id')
      .eq('id', submissionId)
      .maybeSingle<SubmissionRow>();
    if (submissionError) throw submissionError;
    if (!submission) throw new JudgeAccessError('Submissão não encontrada.', 404);
    await assertQualifierEventManagerAccess(supabaseAdmin, auth.user, String(submission.event_id));

    const { data, error } = await supabaseAdmin.rpc('qualifier_request_resubmission', {
      p_submission_id: submissionId,
      p_actor_id: auth.user.id,
      p_expected_reviewed_at: expectedReviewedAt,
      p_justification: justification
    });
    if (error) {
      const message = readError(error);
      return NextResponse.json({ error: resubmissionErrorMessage(message) }, { status: qualifierErrorStatus(message) });
    }

    await notifyAthlete(supabaseAdmin, submission, justification);

    return NextResponse.json({ success: true, result: data });
  } catch (error) {
    if (error instanceof JudgeAccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('[Qualifier Resubmission API] Erro ao excluir resultado para reenvio:', error);
    return NextResponse.json({ error: safeErrorMessage(error, 'Erro ao excluir resultado para reenvio.') }, { status: 500 });
  }
}
