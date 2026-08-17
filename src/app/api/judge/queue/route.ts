import { NextResponse } from 'next/server';
import { getQualifierEventIdsForActor, JudgeAccessError } from '@/lib/serverJudgeAccess';
import { mapScoreSubmissionFromDb } from '@/lib/qualifierSubmissions';
import { createSupabaseAdmin, requireSession, safeErrorMessage } from '@/lib/serverSecurity';

const SUBMISSION_SELECT = 'id, event_id, workout_id, division_id, registration_id, user_id, athlete_id, submitted_result, submitted_value, video_url, video_id, athlete_note, status, final_result, final_value, penalty_percent, submitted_at, reviewed_at, reviewed_by, current_version, created_at, updated_at';

export async function GET(request: Request) {
  try {
    const auth = requireSession(request, ['judge', 'manager', 'owner']);
    if (auth.response) return auth.response;
    const supabaseAdmin = createSupabaseAdmin();
    const { searchParams } = new URL(request.url);
    const requestedEventId = searchParams.get('event_id');
    const status = searchParams.get('status');
    const allowedEventIds = await getQualifierEventIdsForActor(supabaseAdmin, auth.user);
    if (requestedEventId && !allowedEventIds.includes(requestedEventId)) {
      return NextResponse.json({ error: 'Acesso negado para este evento.' }, { status: 403 });
    }
    const eventIds = requestedEventId ? [requestedEventId] : allowedEventIds;
    if (eventIds.length === 0) return NextResponse.json({ queue: [], events: [] });

    let submissionsQuery = supabaseAdmin
      .from('score_submissions')
      .select(SUBMISSION_SELECT)
      .in('event_id', eventIds)
      .order('submitted_at', { ascending: true });
    if (status && ['pending_review', 'validated', 'penalized', 'rejected'].includes(status)) {
      submissionsQuery = submissionsQuery.eq('status', status);
    }
    const [submissionsResult, registrationsResult, workoutsResult, eventsResult] = await Promise.all([
      submissionsQuery,
      supabaseAdmin.from('registrations').select('id, athlete_name, box').in('event_id', eventIds),
      supabaseAdmin.from('workouts').select('id, name, code, type').in('event_id', eventIds),
      supabaseAdmin.from('events').select('id, name').in('id', eventIds)
    ]);
    if (submissionsResult.error) throw submissionsResult.error;
    if (registrationsResult.error) throw registrationsResult.error;
    if (workoutsResult.error) throw workoutsResult.error;
    if (eventsResult.error) throw eventsResult.error;

    const registrations = new Map((registrationsResult.data || []).map(row => [String(row.id), row]));
    const workouts = new Map((workoutsResult.data || []).map(row => [String(row.id), row]));
    const events = new Map((eventsResult.data || []).map(row => [String(row.id), row]));
    const queue = (submissionsResult.data || []).map(row => {
      const submission = mapScoreSubmissionFromDb(row);
      const registration = registrations.get(submission.registrationId);
      const workout = workouts.get(submission.workoutId);
      const event = events.get(submission.eventId);
      return {
        ...submission,
        athleteName: registration?.athlete_name || 'Atleta',
        athleteBox: registration?.box || '',
        workoutName: workout?.name || 'Prova',
        workoutCode: workout?.code || '',
        workoutType: workout?.type || 'fortime',
        eventName: event?.name || 'Evento'
      };
    });
    return NextResponse.json({ queue, events: eventsResult.data || [] });
  } catch (error) {
    if (error instanceof JudgeAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[Judge Queue API] Erro ao carregar fila:', error);
    return NextResponse.json({ error: safeErrorMessage(error, 'Erro ao carregar a fila de revisão.') }, { status: 500 });
  }
}
