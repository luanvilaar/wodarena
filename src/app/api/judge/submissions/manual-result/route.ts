import { NextResponse } from 'next/server';
import { notifyAthleteOfQualifierResult } from '@/lib/qualifierNotifications';
import { qualifierErrorStatus } from '@/lib/qualifierSubmissions';
import { parseScoreForWorkout } from '@/lib/scoring';
import { assertQualifierEventOrganizerAccess, JudgeAccessError } from '@/lib/serverJudgeAccess';
import { checkRateLimit, createSupabaseAdmin, requireSession, safeErrorMessage } from '@/lib/serverSecurity';

const readError = (error: unknown) => error && typeof error === 'object' && 'message' in error
  ? String(error.message)
  : '';

// Mensagens amigáveis para os erros conhecidos de qualifier_manager_enter_result.
// O código cru do banco nunca é devolvido ao cliente.
const MANUAL_RESULT_ERROR_MESSAGES: Record<string, string> = {
  qualifier_manual_result_not_allowed: 'Apenas o gestor organizador deste evento pode lançar resultados.',
  qualifier_manager_access_expired: 'O período de uso da plataforma para este gestor expirou.',
  qualifier_event_not_found: 'Evento não encontrado.',
  qualifier_event_required: 'Esta operação é exclusiva de eventos Functional Fitness Qualifier.',
  qualifier_workout_not_found: 'Prova não encontrada neste evento.',
  qualifier_registration_not_eligible: 'A inscrição não está elegível (pagamento não aprovado ou sem atleta vinculado).',
  qualifier_workout_division_mismatch: 'A categoria do atleta não corresponde à categoria desta prova.',
  qualifier_reviewer_conflict_of_interest: 'Você não pode lançar o resultado da sua própria inscrição.',
  qualifier_submission_already_pending: 'Este atleta já enviou o resultado e ele está em análise. Revise a submissão em vez de lançar um novo resultado.',
  qualifier_submission_already_reviewed: 'Este atleta já tem um resultado ativo nesta prova. Edite o resultado existente ou exclua-o para reenvio.',
  qualifier_manual_result_required: 'Informe um resultado válido.',
  qualifier_manual_result_justification_required: 'Informe a justificativa do lançamento manual.',
  qualifier_review_justification_too_long: 'A justificativa deve ter no máximo 2.000 caracteres.'
};

const manualResultErrorMessage = (message: string) => {
  const code = Object.keys(MANUAL_RESULT_ERROR_MESSAGES).find(key => message.includes(key));
  return code ? MANUAL_RESULT_ERROR_MESSAGES[code] : 'Não foi possível lançar o resultado.';
};

export async function POST(request: Request) {
  try {
    // Lançar resultado é exclusivo do gestor organizador. Nem owner nem judge.
    const auth = requireSession(request, ['manager']);
    if (auth.response) return auth.response;
    const rateLimited = checkRateLimit({ key: `qualifier-manual-result:${auth.user.id}`, limit: 30, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const body = await request.json() as {
      eventId?: string;
      workoutId?: string;
      registrationId?: string;
      result?: string;
      justification?: string;
    };
    const eventId = String(body.eventId || '').trim();
    const workoutId = String(body.workoutId || '').trim();
    const registrationId = String(body.registrationId || '').trim();
    const justification = typeof body.justification === 'string' ? body.justification.trim() : '';
    if (!eventId || !workoutId || !registrationId) {
      return NextResponse.json({ error: 'Evento, prova e inscrição são obrigatórios.' }, { status: 400 });
    }
    if (!justification) {
      return NextResponse.json({ error: 'Informe a justificativa do lançamento manual.' }, { status: 400 });
    }

    const supabaseAdmin = createSupabaseAdmin();
    await assertQualifierEventOrganizerAccess(supabaseAdmin, auth.user, eventId);

    const { data: workout, error: workoutError } = await supabaseAdmin
      .from('workouts')
      .select('id, type')
      .eq('id', workoutId)
      .eq('event_id', eventId)
      .maybeSingle();
    if (workoutError) throw workoutError;
    if (!workout) return NextResponse.json({ error: 'Prova não encontrada neste evento.' }, { status: 404 });

    let parsed: { result: string; value: number };
    try {
      parsed = parseScoreForWorkout(workout.type, body.result);
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Resultado inválido.' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin.rpc('qualifier_manager_enter_result', {
      p_event_id: eventId,
      p_workout_id: workoutId,
      p_registration_id: registrationId,
      p_actor_id: auth.user.id,
      p_result: parsed.result,
      p_value: parsed.value,
      p_justification: justification
    });
    if (error) {
      const message = readError(error);
      return NextResponse.json({ error: manualResultErrorMessage(message) }, { status: qualifierErrorStatus(message) });
    }

    const submissionId = data && typeof data === 'object' && 'submissionId' in data ? String(data.submissionId) : '';
    if (submissionId) {
      await notifyAthleteOfQualifierResult(supabaseAdmin, { submissionId, change: 'manager_entry', justification });
    }

    return NextResponse.json({ success: true, result: data });
  } catch (error) {
    if (error instanceof JudgeAccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('[Qualifier Manual Result API] Erro ao lançar resultado:', error);
    return NextResponse.json({ error: safeErrorMessage(error, 'Erro ao lançar resultado.') }, { status: 500 });
  }
}
