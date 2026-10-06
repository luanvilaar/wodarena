import { NextResponse } from 'next/server';
import { mapScoreSubmissionReviewFromDb, qualifierErrorStatus } from '@/lib/qualifierSubmissions';
import { parseScoreForWorkout } from '@/lib/scoring';
import { assertQualifierJudgeAccess, JudgeAccessError } from '@/lib/serverJudgeAccess';
import { notifyAthleteOfQualifierResult, type QualifierResultChange } from '@/lib/qualifierNotifications';
import { checkRateLimit, createSupabaseAdmin, requireSession, safeErrorMessage } from '@/lib/serverSecurity';

const readError = (error: unknown) => error && typeof error === 'object' && 'message' in error
  ? String(error.message)
  : '';

const REVIEW_ERROR_MESSAGES: Record<string, string> = {
  qualifier_review_edit_not_allowed: 'Apenas o gestor organizador do evento pode editar resultados já revisados.'
};

const reviewErrorMessage = (message: string) => {
  const code = Object.keys(REVIEW_ERROR_MESSAGES).find(key => message.includes(key));
  return code ? REVIEW_ERROR_MESSAGES[code] : 'Não foi possível aplicar a revisão.';
};

const getAuthorizedSubmission = async (
  supabaseAdmin: ReturnType<typeof createSupabaseAdmin>,
  submissionId: string,
  actor: { id: string; name: string; email: string; role: 'owner' | 'manager' | 'athlete' | 'judge'; organization?: string }
) => {
  const { data: submission, error } = await supabaseAdmin
    .from('score_submissions')
    .select('id, event_id, workout_id, current_version, status')
    .eq('id', submissionId)
    .maybeSingle();
  if (error) throw error;
  if (!submission) throw new JudgeAccessError('Submissão não encontrada.', 404);
  await assertQualifierJudgeAccess(supabaseAdmin, actor, String(submission.event_id));
  return submission;
};

export async function GET(request: Request) {
  try {
    const auth = requireSession(request, ['judge', 'manager', 'owner']);
    if (auth.response) return auth.response;
    const submissionId = new URL(request.url).searchParams.get('submission_id');
    if (!submissionId) return NextResponse.json({ error: 'submission_id é obrigatório.' }, { status: 400 });
    const supabaseAdmin = createSupabaseAdmin();
    await getAuthorizedSubmission(supabaseAdmin, submissionId, auth.user);
    const { data, error } = await supabaseAdmin
      .from('score_submission_reviews')
      .select('*')
      .eq('submission_id', submissionId)
      .order('reviewed_at', { ascending: true });
    if (error) throw error;
    return NextResponse.json({ reviews: (data || []).map(mapScoreSubmissionReviewFromDb) });
  } catch (error) {
    if (error instanceof JudgeAccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('[Judge Reviews API] Erro ao consultar histórico:', error);
    return NextResponse.json({ error: safeErrorMessage(error, 'Erro ao consultar histórico.') }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const auth = requireSession(request, ['judge', 'manager', 'owner']);
    if (auth.response) return auth.response;
    const rateLimited = checkRateLimit({ key: `qualifier-review:${auth.user.id}`, limit: 30, windowMs: 60 * 1000 });
    if (rateLimited) return rateLimited;
    const body = await request.json() as {
      submissionId?: string;
      expectedVersion?: number;
      decision?: string;
      justification?: string;
      manualResult?: string;
    };
    const submissionId = String(body.submissionId || '').trim();
    const decision = String(body.decision || '').trim();
    const expectedVersion = Number(body.expectedVersion);
    if (!submissionId || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
      return NextResponse.json({ error: 'Submissão e versão são obrigatórias.' }, { status: 400 });
    }
    if (!['validated', 'penalized', 'rejected', 'manual_adjustment'].includes(decision)) {
      return NextResponse.json({ error: 'Decisão de revisão inválida.' }, { status: 400 });
    }
    const supabaseAdmin = createSupabaseAdmin();
    const submission = await getAuthorizedSubmission(supabaseAdmin, submissionId, auth.user);
    // Revisar uma submissão pendente é de judge/gestor/owner; editar um resultado
    // já revisado é exclusivo do gestor organizador (o banco também impõe).
    const isEdit = submission.status !== 'pending_review';
    if (isEdit && auth.user.role !== 'manager') {
      return NextResponse.json({ error: REVIEW_ERROR_MESSAGES.qualifier_review_edit_not_allowed }, { status: 403 });
    }
    let manualResult: { result: string; value: number } | null = null;
    if (decision === 'manual_adjustment') {
      const { data: workout, error } = await supabaseAdmin
        .from('workouts')
        .select('type')
        .eq('id', submission.workout_id)
        .maybeSingle();
      if (error || !workout) return NextResponse.json({ error: 'Prova da submissão não encontrada.' }, { status: 404 });
      try {
        manualResult = parseScoreForWorkout(workout.type, body.manualResult);
      } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Resultado manual inválido.' }, { status: 400 });
      }
    }
    const { data, error } = await supabaseAdmin.rpc('qualifier_apply_review', {
      p_submission_id: submissionId,
      p_expected_version: expectedVersion,
      p_actor_id: auth.user.id,
      p_decision: decision,
      p_justification: typeof body.justification === 'string' ? body.justification.trim() : null,
      p_manual_result: manualResult?.result || null,
      p_manual_value: manualResult?.value ?? null
    });
    if (error) {
      const message = readError(error);
      return NextResponse.json({ error: reviewErrorMessage(message) }, { status: qualifierErrorStatus(message) });
    }
    // Edição de um resultado já revisado: o atleta é avisado por e-mail.
    if (isEdit) {
      await notifyAthleteOfQualifierResult(supabaseAdmin, {
        submissionId,
        change: decision as QualifierResultChange,
        justification: typeof body.justification === 'string' ? body.justification.trim() : ''
      });
    }
    return NextResponse.json({ success: true, review: data });
  } catch (error) {
    if (error instanceof JudgeAccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('[Judge Reviews API] Erro ao aplicar revisão:', error);
    return NextResponse.json({ error: safeErrorMessage(error, 'Erro ao aplicar revisão.') }, { status: 500 });
  }
}
