import { NextResponse } from 'next/server';
import {
  calculateContestationCredits,
  CONTESTATION_SUCCESS_MESSAGE,
  findWorkoutHeat,
  mapContestationFromDb,
  parseScheduleItems
} from '@/lib/contestations';
import { createSupabaseAdmin, requireSession } from '@/lib/serverSecurity';

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
    console.error('[Contestations API] Erro ao listar contestacoes:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro ao listar contestacoes.' }, { status: 500 });
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
      description?: string;
    };

    const eventId = String(body.eventId || '').trim();
    const registrationId = String(body.registrationId || '').trim();
    const workoutId = String(body.workoutId || '').trim();
    const heatId = String(body.heatId || '').trim();
    const lane = String(body.lane || '').trim();
    const description = String(body.description || '').trim();

    if (!eventId || !registrationId || !workoutId || !heatId || !lane || !description) {
      return NextResponse.json({ error: 'Evento, inscrição, prova, bateria, raia e descrição são obrigatórios.' }, { status: 400 });
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

    if ((event.event_type || 'functional_fitness') !== 'functional_fitness') {
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

    const scheduleItems = parseScheduleItems(event.event_schedule);
    const heat = findWorkoutHeat(scheduleItems, workoutId, heatId);

    if (!heat) {
      return NextResponse.json({ error: 'Bateria não encontrada para a prova selecionada.' }, { status: 400 });
    }

    const { data: existingRows, error: existingError } = await supabaseAdmin
      .from('contestations')
      .select('*')
      .eq('registration_id', registrationId)
      .eq('event_id', eventId);

    if (existingError) throw existingError;

    const existingContestations = (existingRows || []).map(mapContestationFromDb);
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
      heat_id: heat.id,
      heat_number: heat.heatNumber || null,
      lane,
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
    console.error('[Contestations API] Erro ao criar contestacao:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro ao criar contestacao.' }, { status: 500 });
  }
}
