import { NextResponse } from 'next/server';
import { mapScoreSubmissionFromDb, qualifierErrorStatus } from '@/lib/qualifierSubmissions';
import { parseScoreForWorkout } from '@/lib/scoring';
import { checkRateLimit, createSupabaseAdmin, requireSession, safeErrorMessage } from '@/lib/serverSecurity';
import { normalizeYouTubeVideoUrl } from '@/lib/videoProof';

const SUBMISSION_SELECT = 'id, event_id, workout_id, division_id, registration_id, user_id, athlete_id, submitted_result, submitted_value, video_url, video_id, athlete_note, status, final_result, final_value, penalty_percent, submitted_at, reviewed_at, reviewed_by, current_version, created_at, updated_at';

const readError = (error: unknown) => error && typeof error === 'object' && 'message' in error
  ? String(error.message)
  : '';

export async function GET(request: Request) {
  try {
    const auth = requireSession(request, ['athlete']);
    if (auth.response) return auth.response;

    const { searchParams } = new URL(request.url);
    const eventId = searchParams.get('event_id');
    const supabaseAdmin = createSupabaseAdmin();
    let query = supabaseAdmin
      .from('score_submissions')
      .select(SUBMISSION_SELECT)
      .eq('user_id', auth.user.id)
      .order('submitted_at', { ascending: false });
    if (eventId) query = query.eq('event_id', eventId);
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ submissions: (data || []).map(mapScoreSubmissionFromDb) });
  } catch (error) {
    console.error('[Qualifier Submissions API] Erro ao listar submissões:', error);
    return NextResponse.json({ error: safeErrorMessage(error, 'Erro ao listar submissões.') }, { status: 500 });
  }
}

const submit = async (request: Request) => {
  const auth = requireSession(request, ['athlete']);
  if (auth.response) return auth.response;
  const rateLimited = checkRateLimit({ key: `qualifier-submission:${auth.user.id}`, limit: 20, windowMs: 60 * 1000 });
  if (rateLimited) return rateLimited;

  const body = await request.json() as {
    eventId?: string;
    workoutId?: string;
    registrationId?: string;
    result?: string;
    videoUrl?: string;
    athleteNote?: string;
    expectedVersion?: number;
  };
  const eventId = String(body.eventId || '').trim();
  const workoutId = String(body.workoutId || '').trim();
  const registrationId = String(body.registrationId || '').trim();
  if (!eventId || !workoutId || !registrationId) {
    return NextResponse.json({ error: 'Evento, inscrição e prova são obrigatórios.' }, { status: 400 });
  }

  const supabaseAdmin = createSupabaseAdmin();
  const [{ data: workout, error: workoutError }, { data: registration, error: registrationError }] = await Promise.all([
    supabaseAdmin.from('workouts').select('id, event_id, type').eq('id', workoutId).eq('event_id', eventId).maybeSingle(),
    supabaseAdmin.from('registrations').select('id, event_id, user_id, athlete_id').eq('id', registrationId).eq('event_id', eventId).eq('user_id', auth.user.id).maybeSingle()
  ]);
  if (workoutError || !workout) return NextResponse.json({ error: 'Prova não encontrada para este evento.' }, { status: 404 });
  if (registrationError || !registration?.athlete_id) return NextResponse.json({ error: 'Inscrição elegível não encontrada para o atleta autenticado.' }, { status: 404 });

  let score;
  let video;
  try {
    score = parseScoreForWorkout(workout.type, body.result);
    video = normalizeYouTubeVideoUrl(body.videoUrl);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Dados de submissão inválidos.' }, { status: 400 });
  }

  const suppliedVersion = body.expectedVersion;
  const expectedVersion = suppliedVersion === undefined || suppliedVersion === null
    ? null
    : Number(suppliedVersion);
  if (expectedVersion !== null && (!Number.isInteger(expectedVersion) || expectedVersion < 0)) {
    return NextResponse.json({ error: 'Versão de submissão inválida.' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin.rpc('qualifier_submit_submission', {
    p_event_id: eventId,
    p_workout_id: workoutId,
    p_registration_id: registrationId,
    p_user_id: auth.user.id,
    p_athlete_id: registration.athlete_id,
    p_submitted_result: score.result,
    p_submitted_value: score.value,
    p_video_url: video.canonicalUrl,
    p_video_id: video.videoId,
    p_athlete_note: typeof body.athleteNote === 'string' ? body.athleteNote.trim() : null,
    p_expected_version: expectedVersion
  });
  if (error) {
    const message = readError(error);
    return NextResponse.json({ error: 'Não foi possível salvar a submissão.' }, { status: qualifierErrorStatus(message) });
  }

  return NextResponse.json({ success: true, submission: data });
};

export async function POST(request: Request) {
  try {
    return await submit(request);
  } catch (error) {
    console.error('[Qualifier Submissions API] Erro ao enviar submissão:', error);
    return NextResponse.json({ error: safeErrorMessage(error, 'Erro ao enviar submissão.') }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  return POST(request);
}
