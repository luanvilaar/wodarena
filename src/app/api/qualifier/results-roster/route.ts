import { NextResponse } from 'next/server';
import { mapScoreSubmissionFromDb } from '@/lib/qualifierSubmissions';
import { assertQualifierEventOrganizerAccess, JudgeAccessError } from '@/lib/serverJudgeAccess';
import { createSupabaseAdmin, requireSession, safeErrorMessage } from '@/lib/serverSecurity';

const SUBMISSION_SELECT = 'id, event_id, workout_id, division_id, registration_id, user_id, athlete_id, submitted_result, submitted_value, video_url, video_id, athlete_note, entry_source, status, final_result, final_value, penalty_percent, submitted_at, reviewed_at, reviewed_by, current_version, created_at, updated_at';
// Um evento Qualifier tem uma linha por inscrição aprovada em cada prova; o teto
// evita o limite padrão de 1000 linhas do PostgREST truncar a lista em silêncio.
const MAX_ROWS = 5000;

// Lista, para UMA prova, todos os atletas elegíveis (inscrição aprovada na
// categoria da prova) com a submissão de cada um, se houver. É a base da tela de
// lançamento de scores do gestor: inclui quem ainda não enviou nada.
export async function GET(request: Request) {
  try {
    const auth = requireSession(request, ['manager']);
    if (auth.response) return auth.response;
    const { searchParams } = new URL(request.url);
    const eventId = String(searchParams.get('event_id') || '').trim();
    const workoutId = String(searchParams.get('workout_id') || '').trim();
    if (!eventId || !workoutId) {
      return NextResponse.json({ error: 'event_id e workout_id são obrigatórios.' }, { status: 400 });
    }

    const supabaseAdmin = createSupabaseAdmin();
    await assertQualifierEventOrganizerAccess(supabaseAdmin, auth.user, eventId);

    const { data: workout, error: workoutError } = await supabaseAdmin
      .from('workouts')
      .select('id, division_id')
      .eq('id', workoutId)
      .eq('event_id', eventId)
      .maybeSingle();
    if (workoutError) throw workoutError;
    if (!workout) return NextResponse.json({ error: 'Prova não encontrada neste evento.' }, { status: 404 });

    let registrationsQuery = supabaseAdmin
      .from('registrations')
      .select('id, athlete_name, box, division_id')
      .eq('event_id', eventId)
      .eq('payment_status', 'payment_approved')
      .not('athlete_id', 'is', null)
      .order('athlete_name', { ascending: true })
      .range(0, MAX_ROWS - 1);
    if (workout.division_id) registrationsQuery = registrationsQuery.eq('division_id', workout.division_id);

    const [registrationsResult, submissionsResult, divisionsResult] = await Promise.all([
      registrationsQuery,
      supabaseAdmin.from('score_submissions').select(SUBMISSION_SELECT).eq('workout_id', workoutId).range(0, MAX_ROWS - 1),
      supabaseAdmin.from('divisions').select('id, name').eq('event_id', eventId)
    ]);
    if (registrationsResult.error) throw registrationsResult.error;
    if (submissionsResult.error) throw submissionsResult.error;
    if (divisionsResult.error) throw divisionsResult.error;

    const submissions = (submissionsResult.data || []).map(mapScoreSubmissionFromDb);
    const reviewerIds = [...new Set(submissions.map(item => item.reviewedBy).filter((id): id is string => Boolean(id)))];
    const reviewerNames = new Map<string, string>();
    if (reviewerIds.length > 0) {
      const { data: reviewers, error: reviewersError } = await supabaseAdmin.from('users').select('id, name').in('id', reviewerIds);
      if (reviewersError) throw reviewersError;
      for (const reviewer of reviewers || []) reviewerNames.set(String(reviewer.id), String(reviewer.name));
    }

    const submissionByRegistration = new Map(submissions.map(item => [item.registrationId, item]));
    const divisionNames = new Map((divisionsResult.data || []).map(division => [String(division.id), String(division.name)]));
    const rows = (registrationsResult.data || []).map(registration => {
      const submission = submissionByRegistration.get(String(registration.id));
      return {
        registrationId: String(registration.id),
        athleteName: String(registration.athlete_name || 'Atleta'),
        box: String(registration.box || ''),
        divisionId: String(registration.division_id),
        divisionName: divisionNames.get(String(registration.division_id)) || '',
        submission: submission
          ? {
            id: submission.id,
            status: submission.status,
            entrySource: submission.entrySource,
            submittedResult: submission.submittedResult,
            finalResult: submission.finalResult,
            currentVersion: submission.currentVersion,
            reviewedAt: submission.reviewedAt,
            reviewedByName: submission.reviewedBy ? reviewerNames.get(submission.reviewedBy) : undefined,
            videoUrl: submission.videoUrl
          }
          : null
      };
    });

    return NextResponse.json({ rows });
  } catch (error) {
    if (error instanceof JudgeAccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('[Qualifier Results Roster API] Erro ao carregar a lista de resultados:', error);
    return NextResponse.json({ error: safeErrorMessage(error, 'Erro ao carregar a lista de resultados.') }, { status: 500 });
  }
}
