import { NextResponse } from 'next/server';
import {
  calculateContestationCredits,
  CONTESTATION_SUCCESS_MESSAGE,
  findWorkoutHeat,
  mapContestationFromDb,
  parseScheduleItems
} from '@/lib/contestations';
import { ManagerAccessError, assertManagerOperationalAccess, managerAccessErrorResponse } from '@/lib/serverManagerAccess';
import { createSupabaseAdmin, requireSession, safeErrorMessage } from '@/lib/serverSecurity';

const createContestationId = () => `contest-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const ensureManagerEventAccess = async (
  supabaseAdmin: ReturnType<typeof createSupabaseAdmin>,
  actorId: string,
  eventId: string
) => {
  const { data: event, error } = await supabaseAdmin
    .from('events')
    .select('id, organizer_id')
    .eq('id', eventId)
    .maybeSingle();

  if (error || !event) {
    throw new Error('Evento nao encontrado.');
  }

  if (event.organizer_id !== actorId) {
    throw new Error('Acesso negado para este evento.');
  }
};

export async function GET(request: Request) {
  try {
    const auth = requireSession(request, ['athlete', 'manager', 'owner']);
    if (auth.response) return auth.response;

    const actor = auth.user;
    const supabaseAdmin = createSupabaseAdmin();
    const { searchParams } = new URL(request.url);
    const eventId = searchParams.get('event_id');
    const registrationId = searchParams.get('registration_id');

    let query = supabaseAdmin
      .from('contestations')
      .select('*')
      .order('created_at', { ascending: false });

    if (actor.role === 'athlete') {
      query = query.eq('user_id', actor.id);
      if (eventId) query = query.eq('event_id', eventId);
      if (registrationId) query = query.eq('registration_id', registrationId);
    } else if (actor.role === 'manager') {
      if (!eventId) {
        return NextResponse.json({ error: 'Parâmetro event_id obrigatório para gestor.' }, { status: 400 });
      }
      await assertManagerOperationalAccess(supabaseAdmin, actor);
      await ensureManagerEventAccess(supabaseAdmin, actor.id, eventId);
      query = query.eq('event_id', eventId);
    } else if (eventId) {
      query = query.eq('event_id', eventId);
    }

    const { data, error } = await query;
    if (error) throw error;

    const contestations = (data || []).map(mapContestationFromDb);
    const credits = actor.role === 'athlete' && registrationId
      ? calculateContestationCredits(contestations.filter(contestation => contestation.registrationId === registrationId))
      : null;

    return NextResponse.json({ contestations, credits });
  } catch (err) {
    if (err instanceof ManagerAccessError) {
      return managerAccessErrorResponse(err);
    }
    console.error('[Contestations API] Erro ao listar contestacoes:', err);
    return NextResponse.json({ error: safeErrorMessage(err, 'Erro ao listar contestacoes.') }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const auth = requireSession(request, ['athlete']);
    if (auth.response) return auth.response;

    const actor = auth.user;
    const supabaseAdmin = createSupabaseAdmin();
    const body = await request.json() as {
      eventId?: string;
      registrationId?: string;
      workoutId?: string;
      heatId?: string;
      lane?: string;
      submissionId?: string;
      description?: string;
    };

    const eventId = String(body.eventId || '').trim();
    const registrationId = String(body.registrationId || '').trim();
    const workoutId = String(body.workoutId || '').trim();
    const heatId = String(body.heatId || '').trim();
    const lane = String(body.lane || '').trim();
    const submissionId = String(body.submissionId || '').trim();
    const description = String(body.description || '').trim();

    if (!eventId || !registrationId || !workoutId || !description) {
      return NextResponse.json({ error: 'Evento, inscrição, prova e descrição são obrigatórios.' }, { status: 400 });
    }
    if (description.length > 2000) {
      return NextResponse.json({ error: 'A descrição da contestação deve ter no máximo 2.000 caracteres.' }, { status: 400 });
    }

    const { data: registration, error: registrationError } = await supabaseAdmin
      .from('registrations')
      .select('id, event_id, user_id, athlete_id, payment_status')
      .eq('id', registrationId)
      .eq('event_id', eventId)
      .maybeSingle();

    if (registrationError || !registration || registration.user_id !== actor.id) {
      return NextResponse.json({ error: 'Inscrição não encontrada para o atleta autenticado.' }, { status: 404 });
    }

    if ((registration.payment_status || 'payment_approved') !== 'payment_approved') {
      return NextResponse.json({ error: 'Contestação disponível apenas para inscrições com pagamento aprovado.' }, { status: 403 });
    }

    const { data: event, error: eventError } = await supabaseAdmin
      .from('events')
      .select('id, event_type, event_schedule')
      .eq('id', eventId)
      .maybeSingle();

    if (eventError || !event) {
      return NextResponse.json({ error: 'Evento não encontrado.' }, { status: 404 });
    }

    const eventType = event.event_type || 'functional_fitness';
    if (eventType !== 'functional_fitness' && eventType !== 'functional_fitness_qualifier') {
      return NextResponse.json({ error: 'Contestação disponível apenas para eventos de Functional Fitness.' }, { status: 403 });
    }

    const { data: workout, error: workoutError } = await supabaseAdmin
      .from('workouts')
      .select('id, event_id')
      .eq('id', workoutId)
      .eq('event_id', eventId)
      .maybeSingle();

    if (workoutError || !workout) {
      return NextResponse.json({ error: 'Prova não encontrada para este evento.' }, { status: 404 });
    }

    let heat: ReturnType<typeof findWorkoutHeat> | null = null;
    if (eventType === 'functional_fitness') {
      if (!heatId || !lane) {
        return NextResponse.json({ error: 'Bateria e raia são obrigatórias para eventos presenciais.' }, { status: 400 });
      }
      const scheduleItems = parseScheduleItems(event.event_schedule);
      heat = findWorkoutHeat(scheduleItems, workoutId, heatId);
      if (!heat) {
        return NextResponse.json({ error: 'Bateria não encontrada para a prova selecionada.' }, { status: 400 });
      }
    } else {
      if (!submissionId) {
        return NextResponse.json({ error: 'Selecione a submissão de resultado que deseja contestar.' }, { status: 400 });
      }
      const { data: submission, error: submissionError } = await supabaseAdmin
        .from('score_submissions')
        .select('id, event_id, registration_id, workout_id, user_id, status')
        .eq('id', submissionId)
        .maybeSingle();
      if (submissionError || !submission
        || submission.event_id !== eventId
        || submission.registration_id !== registrationId
        || submission.workout_id !== workoutId
        || submission.user_id !== actor.id
        || submission.status === 'pending_review') {
        return NextResponse.json({ error: 'Submissão finalizada não encontrada para contestação.' }, { status: 404 });
      }
    }

    const { data: existingRows, error: existingError } = await supabaseAdmin
      .from('contestations')
      .select('*')
      .eq('registration_id', registrationId)
      .eq('event_id', eventId);

    if (existingError) throw existingError;

    const existingContestations = (existingRows || []).map(mapContestationFromDb);
    if (eventType === 'functional_fitness_qualifier' && existingContestations.some(contestation => (
      contestation.submissionId === submissionId && contestation.status === 'under_review'
    ))) {
      return NextResponse.json({ error: 'Já existe uma contestação em análise para esta submissão.' }, { status: 409 });
    }
    const credits = calculateContestationCredits(existingContestations);

    if (credits.available <= 0) {
      return NextResponse.json({ error: 'Todos os créditos de contestação já foram utilizados para esta inscrição.' }, { status: 400 });
    }

    const payload = {
      id: createContestationId(),
      event_id: eventId,
      registration_id: registrationId,
      user_id: actor.id,
      athlete_id: registration.athlete_id || null,
      workout_id: workoutId,
      heat_id: heat?.id || null,
      heat_number: heat?.heatNumber || null,
      lane: eventType === 'functional_fitness' ? lane : null,
      submission_id: eventType === 'functional_fitness_qualifier' ? submissionId : null,
      description,
      status: 'under_review',
      credit_consumed: true,
      credit_refunded: false,
      manager_note: null,
      resolved_at: null
    };

    const { data: insertedRow, error: insertError } = await supabaseAdmin
      .from('contestations')
      .insert(payload)
      .select('*')
      .maybeSingle();

    if (insertError || !insertedRow) throw insertError || new Error('Falha ao registrar contestação.');

    const contestation = mapContestationFromDb(insertedRow);
    const nextCredits = calculateContestationCredits([...existingContestations, contestation]);

    return NextResponse.json({
      success: true,
      message: CONTESTATION_SUCCESS_MESSAGE,
      contestation,
      credits: nextCredits
    });
  } catch (err) {
    if (err instanceof ManagerAccessError) {
      return managerAccessErrorResponse(err);
    }
    console.error('[Contestations API] Erro ao criar contestacao:', err);
    return NextResponse.json({ error: safeErrorMessage(err, 'Erro ao criar contestacao.') }, { status: 500 });
  }
}
