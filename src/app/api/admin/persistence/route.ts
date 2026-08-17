import { NextResponse } from 'next/server';
import { ManagerAccessError, assertManagerOperationalAccess, managerAccessErrorResponse } from '@/lib/serverManagerAccess';
import { checkRateLimit, createSupabaseAdmin, hashPassword, requireSession, safeErrorMessage, SessionUser } from '@/lib/serverSecurity';

type DbClient = ReturnType<typeof createSupabaseAdmin>;

const ensureEventOwner = async (supabaseAdmin: DbClient, actor: SessionUser, eventId: string) => {
  const { data: event, error } = await supabaseAdmin
    .from('events')
    .select('id, name, organizer_id, event_type, event_schedule')
    .eq('id', eventId)
    .maybeSingle();

  if (error || !event) throw new Error('Evento nao encontrado.');
  if (actor.role !== 'owner' && event.organizer_id !== actor.id) {
    throw new Error('Acesso negado para este evento.');
  }
  return event;
};

const ensureDivisionOwner = async (supabaseAdmin: DbClient, actor: SessionUser, divisionId: string, eventId?: string) => {
  const { data: division, error } = await supabaseAdmin
    .from('divisions')
    .select('id, event_id')
    .eq('id', divisionId)
    .maybeSingle();

  if (error || !division) throw new Error('Categoria nao encontrada.');
  if (eventId && division.event_id !== eventId) throw new Error('Categoria nao pertence ao evento informado.');
  await ensureEventOwner(supabaseAdmin, actor, division.event_id);
  return division;
};

const ensureWorkoutOwner = async (supabaseAdmin: DbClient, actor: SessionUser, workoutId: string, eventId?: string) => {
  const { data: workout, error } = await supabaseAdmin
    .from('workouts')
    .select('id, event_id')
    .eq('id', workoutId)
    .maybeSingle();

  if (error || !workout) throw new Error('Prova nao encontrada.');
  if (eventId && workout.event_id !== eventId) throw new Error('Prova nao pertence ao evento informado.');
  await ensureEventOwner(supabaseAdmin, actor, workout.event_id);
  return workout;
};

// Allowlists dos campos editáveis via updateX — nunca aplicar payload.data cru
// num .update(), senão o cliente pode injetar colunas como event_id/organizer_id
// (mass assignment) e mudar o dono/tenant de um recurso já validado.
const EVENT_UPDATABLE_FIELDS = [
  'name', 'logo_url', 'banner_url', 'status', 'location', 'date', 'description',
  'format', 'ticket_price', 'ticket_slots', 'is_ticketing_active', 'time', 'city',
  'state', 'rules', 'instagram', 'website', 'event_type', 'event_schedule', 'mp_public_key'
] as const;

const DIVISION_UPDATABLE_FIELDS = [
  'name', 'category', 'type', 'slots_limit', 'price', 'is_active', 'order_index',
  'use_age_groups', 'age_groups', 'course_layout', 'is_course_published'
] as const;

const WORKOUT_UPDATABLE_FIELDS = [
  'name', 'description', 'type', 'time_cap', 'code', 'order_index', 'division_id', 'tie_breaker',
  'submission_opens_at', 'submission_closes_at'
] as const;

const COUPON_UPDATABLE_FIELDS = [
  'code', 'discount_type', 'discount_value', 'usage_limit', 'is_active'
] as const;

const pickAllowedFields = (input: unknown, allowedKeys: readonly string[]) => {
  const source = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const result: Record<string, unknown> = {};
  for (const key of allowedKeys) {
    if (key in source) result[key] = source[key];
  }
  return result;
};

const asTrimmed = (value: unknown, fallback = '') =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback;

// Escapa metacaracteres de LIKE/ILIKE (% _ \) antes de usar em .ilike(), senão
// um "code" de cupom com esses caracteres vira wildcard em vez de literal.
const escapeLikePattern = (value: string) => value.replace(/[\\%_]/g, (match) => `\\${match}`);

const optionalText = (value: unknown) => {
  const trimmed = asTrimmed(value);
  return trimmed || null;
};

const qualifierEventType = 'functional_fitness_qualifier';

const isQualifierEvent = (eventType: unknown) => eventType === qualifierEventType;

const assertQualifierSchedule = (eventType: unknown, schedule: unknown) => {
  if (!isQualifierEvent(eventType) || !Array.isArray(schedule)) return;
  if (schedule.some((item) => item && typeof item === 'object' && (item as Record<string, unknown>).kind === 'heat')) {
    throw new Error('Eventos Functional Fitness Qualifier não aceitam baterias no cronograma.');
  }
};

const validateQualifierWorkoutWindow = (eventType: unknown, workout: Record<string, unknown>) => {
  if (!isQualifierEvent(eventType)) return;
  const closesAt = asTrimmed(workout.submission_closes_at);
  const opensAt = asTrimmed(workout.submission_opens_at);
  if (!closesAt || Number.isNaN(new Date(closesAt).getTime())) {
    throw new Error('Eventos Qualifier exigem data e horário limite de submissão em cada prova.');
  }
  if (opensAt && Number.isNaN(new Date(opensAt).getTime())) {
    throw new Error('A abertura da janela de submissão é inválida.');
  }
  if (opensAt && new Date(opensAt).getTime() >= new Date(closesAt).getTime()) {
    throw new Error('A abertura da submissão deve ser anterior ao encerramento.');
  }
};

const createJudgeId = () => `judge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const judgeCreationErrorResponse = (error: unknown) => {
  const details = error && typeof error === 'object' ? error as { code?: unknown; message?: unknown } : null;
  const code = typeof details?.code === 'string' ? details.code : '';
  const message = typeof details?.message === 'string' ? details.message : '';

  if (message === 'qualifier_judge_email_exists') {
    return NextResponse.json({
      error: 'Este e-mail já está cadastrado. Use um e-mail que não pertença a atleta, gestor, owner ou outro judge.'
    }, { status: 409 });
  }
  if (message === 'qualifier_manager_access_expired') {
    return NextResponse.json({ error: 'O acesso deste gestor está expirado. Renove o acesso para cadastrar judges.' }, { status: 403 });
  }
  if (message === 'qualifier_judge_creation_not_allowed' || message === 'qualifier_judge_parent_not_allowed') {
    return NextResponse.json({ error: 'Você não tem permissão para cadastrar judge neste evento.' }, { status: 403 });
  }
  if (message === 'qualifier_invalid_judge_payload') {
    return NextResponse.json({ error: 'Informe nome, e-mail válido e senha com ao menos 8 caracteres para o judge.' }, { status: 400 });
  }
  if (code === 'PGRST202') {
    return NextResponse.json({
      error: 'O recurso de Judge ainda não está disponível neste ambiente. Aplique as migrations pendentes antes de tentar novamente.'
    }, { status: 503 });
  }
  return null;
};

const qualifierDeleteErrorResponse = (error: unknown) => {
  const details = error && typeof error === 'object' ? error as { code?: unknown; message?: unknown } : null;
  const code = typeof details?.code === 'string' ? details.code : '';
  const message = typeof details?.message === 'string' ? details.message : '';

  if (message === 'qualifier_event_delete_confirmation_invalid') {
    return NextResponse.json({ error: 'Digite o nome exato do evento para confirmar a exclusão.' }, { status: 400 });
  }
  if (message === 'qualifier_event_delete_not_allowed') {
    return NextResponse.json({ error: 'Você não tem permissão para excluir este evento.' }, { status: 403 });
  }
  if (message === 'qualifier_manager_access_expired') {
    return NextResponse.json({ error: 'O acesso deste gestor está expirado. Renove o acesso antes de excluir o evento.' }, { status: 403 });
  }
  if (message === 'qualifier_event_not_found') {
    return NextResponse.json({ error: 'Evento não encontrado.' }, { status: 404 });
  }
  if (code === 'PGRST202') {
    return NextResponse.json({
      error: 'A exclusão de Qualifier ainda não está disponível neste ambiente. Aplique as migrations pendentes antes de tentar novamente.'
    }, { status: 503 });
  }
  return null;
};

const parseRefundAmount = (value: unknown, required = false) => {
  if (value === null || value === undefined || value === '') {
    if (required) throw new Error('Informe o valor do reembolso manual.');
    return null;
  }

  const normalized = typeof value === 'string'
    ? Number(value.replace(/\./g, '').replace(',', '.'))
    : Number(value);

  if (!Number.isFinite(normalized) || normalized < 0) {
    throw new Error('Valor de reembolso invalido.');
  }

  return normalized;
};

const mapRegistrationForClient = (registration: Record<string, unknown>) => ({
  id: registration.id,
  eventId: registration.event_id,
  divisionId: registration.division_id,
  userId: registration.user_id || undefined,
  athleteId: registration.athlete_id || undefined,
  athleteName: registration.athlete_name,
  athleteEmail: registration.athlete_email,
  athletePhone: registration.athlete_phone,
  box: registration.box,
  gender: registration.gender,
  ticketType: registration.ticket_type,
  ticketPrice: Number(registration.ticket_price),
  quantity: Number(registration.quantity),
  totalPaid: Number(registration.total_paid),
  createdAt: registration.created_at,
  couponCode: registration.coupon_code || undefined,
  paymentStatus: registration.payment_status || undefined,
  paymentMethod: registration.payment_method || undefined,
  paymentId: registration.payment_id || undefined,
  paymentStatusDetail: registration.payment_status_detail || undefined,
  paymentErrorMessage: registration.payment_error_message || undefined,
  cancellationReason: registration.cancellation_reason || undefined,
  cancelledAt: registration.cancelled_at || undefined,
  cancelledBy: registration.cancelled_by || undefined,
  refundStatus: registration.refund_status || 'not_requested',
  refundAmount: registration.refund_amount !== null && registration.refund_amount !== undefined ? Number(registration.refund_amount) : undefined,
  refundMethod: registration.refund_method || undefined,
  refundNote: registration.refund_note || undefined,
  refundProcessedAt: registration.refund_processed_at || undefined,
  refundProcessedBy: registration.refund_processed_by || undefined,
  updatedAt: registration.updated_at || undefined
});

export async function POST(request: Request) {
  try {
    const auth = requireSession(request, ['manager', 'owner']);
    if (auth.response) return auth.response;
    const actor = auth.user;

    const rateLimited = checkRateLimit({
      key: `admin-persistence:${actor.id}`,
      limit: 120,
      windowMs: 60 * 1000
    });
    if (rateLimited) return rateLimited;

    const supabaseAdmin = createSupabaseAdmin();
    await assertManagerOperationalAccess(supabaseAdmin, actor);
    const { action, payload } = await request.json();

    switch (action) {
      case 'createEvent': {
        const { event, divisions = [], workouts = [] } = payload;
        if (actor.role !== 'owner' && event.organizer_id !== actor.id) {
          return NextResponse.json({ error: 'Acesso negado para criar evento em outro gestor.' }, { status: 403 });
        }

        assertQualifierSchedule(event.event_type, event.event_schedule);
        if (isQualifierEvent(event.event_type)) {
          for (const workout of workouts as Record<string, unknown>[]) {
            validateQualifierWorkoutWindow(event.event_type, workout);
          }
        }

        delete event.is_featured;
        const { error: eventError } = await supabaseAdmin.from('events').insert(event);
        if (eventError) throw eventError;

        // event_id de cada divisão/prova é sempre sobrescrito com o evento
        // recém-validado — nunca confiar no que o payload trouxer, senão o
        // gestor pode "plantar" conteúdo dentro do evento de outro organizador.
        const scopedDivisions = (divisions as Record<string, unknown>[]).map((division) => ({
          ...division,
          event_id: event.id
        }));
        const scopedWorkouts = (workouts as Record<string, unknown>[]).map((workout) => ({
          ...workout,
          event_id: event.id
        }));

        if (scopedDivisions.length > 0) {
          const { error } = await supabaseAdmin.from('divisions').insert(scopedDivisions);
          if (error) {
            await supabaseAdmin.from('events').delete().eq('id', event.id);
            throw error;
          }
        }

        if (scopedWorkouts.length > 0) {
          const { error } = await supabaseAdmin.from('workouts').insert(scopedWorkouts);
          if (error) {
            await supabaseAdmin.from('events').delete().eq('id', event.id);
            throw error;
          }
        }

        return NextResponse.json({ success: true });
      }

      case 'deleteEvent': {
        const event = await ensureEventOwner(supabaseAdmin, actor, payload.eventId);
        const confirmation = asTrimmed(payload.confirmation);
        if (!confirmation || confirmation !== event.name) {
          return NextResponse.json({ error: 'Digite o nome exato do evento para confirmar a exclusão.' }, { status: 400 });
        }

        if (isQualifierEvent(event.event_type)) {
          const { error } = await supabaseAdmin.rpc('qualifier_purge_event', {
            p_actor_id: actor.id,
            p_event_id: event.id,
            p_event_name_confirmation: confirmation
          });
          if (error) {
            const response = qualifierDeleteErrorResponse(error);
            if (response) return response;
            throw error;
          }
          return NextResponse.json({ success: true });
        }

        const { error } = await supabaseAdmin.from('events').delete().eq('id', payload.eventId);
        if (error) throw error;
        return NextResponse.json({ success: true });
      }

      case 'updateEvent': {
        const currentEvent = await ensureEventOwner(supabaseAdmin, actor, payload.eventId);
        if (payload.data && typeof payload.data === 'object' && 'is_featured' in payload.data) {
          return NextResponse.json({ error: 'Use a acao setFeaturedHomeEvent para alterar o destaque da home.' }, { status: 400 });
        }

        const allowedData = pickAllowedFields(payload.data, EVENT_UPDATABLE_FIELDS);
        const nextEventType = allowedData.event_type || currentEvent.event_type || 'functional_fitness';
        const nextSchedule = allowedData.event_schedule === undefined ? currentEvent.event_schedule : allowedData.event_schedule;
        assertQualifierSchedule(nextEventType, nextSchedule);
        if (isQualifierEvent(nextEventType) && !isQualifierEvent(currentEvent.event_type)) {
          const { data: existingWorkouts, error: workoutsError } = await supabaseAdmin
            .from('workouts')
            .select('id, submission_closes_at')
            .eq('event_id', payload.eventId);
          if (workoutsError) throw workoutsError;
          if ((existingWorkouts || []).some(workout => !workout.submission_closes_at)) {
            return NextResponse.json({ error: 'Defina o prazo de submissão em todas as provas antes de converter o evento em Qualifier.' }, { status: 409 });
          }
        }
        const { error } = await supabaseAdmin.from('events').update(allowedData).eq('id', payload.eventId);
        if (error) throw error;
        return NextResponse.json({ success: true });
      }

      case 'setFeaturedHomeEvent': {
        if (actor.role !== 'owner') {
          return NextResponse.json({ error: 'Apenas o owner pode alterar o destaque da home.' }, { status: 403 });
        }

        const eventId = typeof payload.eventId === 'string' && payload.eventId.length > 0 ? payload.eventId : null;
        const { error } = await supabaseAdmin.rpc('admin_set_featured_home_event', { p_event_id: eventId });
        if (error) throw error;
        return NextResponse.json({ success: true });
      }

      case 'createDivision': {
        await ensureEventOwner(supabaseAdmin, actor, payload.division.event_id);
        const { error } = await supabaseAdmin.from('divisions').insert(payload.division);
        if (error) throw error;

        if (payload.autoWorkout) {
          // event_id da prova automática é sempre o da divisão já validada,
          // nunca o que vier em payload.autoWorkout.
          const scopedAutoWorkout = { ...payload.autoWorkout, event_id: payload.division.event_id };
          const { error: workoutError } = await supabaseAdmin.from('workouts').insert(scopedAutoWorkout);
          if (workoutError) {
            await supabaseAdmin.from('divisions').delete().eq('id', payload.division.id);
            throw workoutError;
          }
        }

        return NextResponse.json({ success: true });
      }

      case 'updateDivision': {
        await ensureDivisionOwner(supabaseAdmin, actor, payload.divisionId, payload.eventId);
        const allowedData = pickAllowedFields(payload.data, DIVISION_UPDATABLE_FIELDS);
        const { error } = await supabaseAdmin
          .from('divisions')
          .update(allowedData)
          .eq('id', payload.divisionId);
        if (error) throw error;
        return NextResponse.json({ success: true });
      }

      case 'reorderDivisions': {
        await ensureEventOwner(supabaseAdmin, actor, payload.eventId);

        const orderedIds: unknown = payload.orderedIds;
        if (!Array.isArray(orderedIds) || orderedIds.some((id) => typeof id !== 'string' || !id)) {
          return NextResponse.json({ error: 'Lista de categorias invalida.' }, { status: 400 });
        }

        const { data: eventDivisions, error: divisionsError } = await supabaseAdmin
          .from('divisions')
          .select('id')
          .eq('event_id', payload.eventId);
        if (divisionsError) throw divisionsError;

        const currentIds = new Set((eventDivisions || []).map((division) => division.id));
        const receivedIds = new Set(orderedIds as string[]);
        const coversAllDivisions = receivedIds.size === orderedIds.length
          && receivedIds.size === currentIds.size
          && (orderedIds as string[]).every((id) => currentIds.has(id));

        if (!coversAllDivisions) {
          return NextResponse.json(
            { error: 'A ordem enviada nao corresponde as categorias deste evento.' },
            { status: 400 }
          );
        }

        for (const [index, divisionId] of (orderedIds as string[]).entries()) {
          const { error } = await supabaseAdmin
            .from('divisions')
            .update({ order_index: index + 1 })
            .eq('id', divisionId)
            .eq('event_id', payload.eventId);
          if (error) throw error;
        }

        return NextResponse.json({ success: true });
      }

      case 'deleteDivision': {
        await ensureDivisionOwner(supabaseAdmin, actor, payload.divisionId, payload.eventId);
        const { error } = await supabaseAdmin.from('divisions').delete().eq('id', payload.divisionId);
        if (error) throw error;
        return NextResponse.json({ success: true });
      }

      case 'createWorkout': {
        const event = await ensureEventOwner(supabaseAdmin, actor, payload.workout.event_id);
        validateQualifierWorkoutWindow(event.event_type, payload.workout);
        const { error } = await supabaseAdmin.from('workouts').insert(payload.workout);
        if (error) throw error;
        return NextResponse.json({ success: true });
      }

      case 'updateWorkout': {
        const workout = await ensureWorkoutOwner(supabaseAdmin, actor, payload.workoutId, payload.eventId);
        const allowedData = pickAllowedFields(payload.data, WORKOUT_UPDATABLE_FIELDS);
        const event = await ensureEventOwner(supabaseAdmin, actor, workout.event_id);
        if (isQualifierEvent(event.event_type) && (
          'submission_opens_at' in allowedData || 'submission_closes_at' in allowedData
        )) {
          const { data: currentWorkout, error: currentWorkoutError } = await supabaseAdmin
            .from('workouts')
            .select('submission_opens_at, submission_closes_at')
            .eq('id', payload.workoutId)
            .maybeSingle();
          if (currentWorkoutError || !currentWorkout) return NextResponse.json({ error: 'Prova não encontrada.' }, { status: 404 });
          validateQualifierWorkoutWindow(event.event_type, {
            submission_opens_at: allowedData.submission_opens_at ?? currentWorkout.submission_opens_at,
            submission_closes_at: allowedData.submission_closes_at ?? currentWorkout.submission_closes_at
          });
        }

        if (typeof allowedData.division_id === 'string' && allowedData.division_id) {
          const { data: targetDivision, error: divisionError } = await supabaseAdmin
            .from('divisions')
            .select('id')
            .eq('id', allowedData.division_id)
            .eq('event_id', workout.event_id)
            .maybeSingle();
          if (divisionError || !targetDivision) {
            return NextResponse.json({ error: 'Categoria de destino nao pertence a este evento.' }, { status: 400 });
          }
        }

        const { error } = await supabaseAdmin
          .from('workouts')
          .update(allowedData)
          .eq('id', payload.workoutId);
        if (error) throw error;
        return NextResponse.json({ success: true });
      }

      case 'deleteWorkout': {
        await ensureWorkoutOwner(supabaseAdmin, actor, payload.workoutId, payload.eventId);
        const { error } = await supabaseAdmin.from('workouts').delete().eq('id', payload.workoutId);
        if (error) throw error;
        return NextResponse.json({ success: true });
      }

      case 'listJudges': {
        const event = await ensureEventOwner(supabaseAdmin, actor, payload.eventId);
        if (!isQualifierEvent(event.event_type)) {
          return NextResponse.json({ error: 'Judges são exclusivos de eventos Functional Fitness Qualifier.' }, { status: 400 });
        }
        const { data: assignments, error: assignmentsError } = await supabaseAdmin
          .from('event_judges')
          .select('judge_user_id, created_at')
          .eq('event_id', payload.eventId)
          .order('created_at', { ascending: true });
        if (assignmentsError) throw assignmentsError;
        const judgeIds = (assignments || []).map(assignment => String(assignment.judge_user_id));
        const { data: judges, error: judgesError } = judgeIds.length > 0
          ? await supabaseAdmin
            .from('users')
            .select('id, name, email, role, parent_manager_id')
            .in('id', judgeIds)
            .eq('role', 'judge')
          : { data: [], error: null };
        if (judgesError) throw judgesError;
        return NextResponse.json({ judges: judges || [] });
      }

      case 'createJudge': {
        const event = await ensureEventOwner(supabaseAdmin, actor, payload.eventId);
        if (!isQualifierEvent(event.event_type)) {
          return NextResponse.json({ error: 'Judges são exclusivos de eventos Functional Fitness Qualifier.' }, { status: 400 });
        }
        const name = asTrimmed(payload.name);
        const email = asTrimmed(payload.email).toLowerCase();
        const password = asTrimmed(payload.password);
        if (name.length < 3 || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8) {
          return NextResponse.json({ error: 'Informe nome, e-mail válido e senha com ao menos 8 caracteres para o judge.' }, { status: 400 });
        }
        const judgeId = createJudgeId();
        const { data: judge, error: judgeError } = await supabaseAdmin.rpc('qualifier_create_and_assign_judge', {
          p_actor_id: actor.id,
          p_parent_manager_id: event.organizer_id,
          p_event_id: payload.eventId,
          p_judge_id: judgeId,
          p_name: name,
          p_email: email,
          p_password_hash: hashPassword(password)
        });
        if (judgeError) {
          const response = judgeCreationErrorResponse(judgeError);
          if (response) return response;
          throw judgeError;
        }
        return NextResponse.json({ success: true, judge });
      }

      case 'assignJudgeToEvent': {
        const event = await ensureEventOwner(supabaseAdmin, actor, payload.eventId);
        if (!isQualifierEvent(event.event_type)) {
          return NextResponse.json({ error: 'Judges são exclusivos de eventos Functional Fitness Qualifier.' }, { status: 400 });
        }
        const { error } = await supabaseAdmin.rpc('qualifier_assign_judge', {
          p_actor_id: actor.id,
          p_event_id: payload.eventId,
          p_judge_id: asTrimmed(payload.judgeId)
        });
        if (error) throw error;
        return NextResponse.json({ success: true });
      }

      case 'removeJudgeFromEvent': {
        const event = await ensureEventOwner(supabaseAdmin, actor, payload.eventId);
        if (!isQualifierEvent(event.event_type)) {
          return NextResponse.json({ error: 'Judges são exclusivos de eventos Functional Fitness Qualifier.' }, { status: 400 });
        }
        const { error } = await supabaseAdmin.rpc('qualifier_remove_judge', {
          p_actor_id: actor.id,
          p_event_id: payload.eventId,
          p_judge_id: asTrimmed(payload.judgeId)
        });
        if (error) throw error;
        return NextResponse.json({ success: true });
      }

      case 'createCoupon': {
        await ensureEventOwner(supabaseAdmin, actor, payload.coupon.event_id);
        const { error } = await supabaseAdmin.from('coupons').insert(payload.coupon);
        if (error) throw error;
        return NextResponse.json({ success: true });
      }

      case 'incrementCouponUsage': {
        await ensureEventOwner(supabaseAdmin, actor, payload.eventId);
        const { data: coupon, error: couponError } = await supabaseAdmin
          .from('coupons')
          .select('id, usage_count')
          .eq('event_id', payload.eventId)
          .ilike('code', escapeLikePattern(asTrimmed(payload.code)))
          .maybeSingle();
        if (couponError) throw couponError;
        if (coupon) {
          const { error } = await supabaseAdmin
            .from('coupons')
            .update({ usage_count: (coupon.usage_count || 0) + 1 })
            .eq('id', coupon.id);
          if (error) throw error;
        }
        return NextResponse.json({ success: true });
      }

      case 'updateCoupon': {
        await ensureEventOwner(supabaseAdmin, actor, payload.eventId);
        const { data: existingCoupon, error: findError } = await supabaseAdmin
          .from('coupons')
          .select('id, event_id')
          .eq('id', payload.couponId)
          .eq('event_id', payload.eventId)
          .maybeSingle();
        if (findError || !existingCoupon) {
          return NextResponse.json({ error: 'Cupom nao encontrado para este evento.' }, { status: 404 });
        }
        const allowedData = pickAllowedFields(payload.data, COUPON_UPDATABLE_FIELDS);
        const { error } = await supabaseAdmin
          .from('coupons')
          .update(allowedData)
          .eq('id', payload.couponId);
        if (error) throw error;
        return NextResponse.json({ success: true });
      }

      case 'cancelRegistration': {
        const { registrationId, eventId, data } = payload as {
          registrationId: string;
          eventId: string;
          data: Record<string, unknown>;
        };

        await ensureEventOwner(supabaseAdmin, actor, eventId);

        const reason = asTrimmed(data?.reason);
        if (!reason) {
          return NextResponse.json({ error: 'Informe o motivo do cancelamento.' }, { status: 400 });
        }

        let refundAmount: number | null = null;
        try {
          refundAmount = parseRefundAmount(data?.refundAmount);
        } catch (error) {
          return NextResponse.json({ error: error instanceof Error ? error.message : 'Valor de reembolso invalido.' }, { status: 400 });
        }

        const { data: existingRegistration, error: existingError } = await supabaseAdmin
          .from('registrations')
          .select('id, event_id, payment_status, cancelled_at')
          .eq('id', registrationId)
          .eq('event_id', eventId)
          .maybeSingle();

        if (existingError || !existingRegistration) {
          return NextResponse.json({ error: 'Inscrição não encontrada para este evento.' }, { status: 404 });
        }

        const now = new Date().toISOString();
        const { data: updatedRegistration, error: updateError } = await supabaseAdmin
          .from('registrations')
          .update({
            payment_status: 'payment_cancelled',
            payment_status_detail: 'manager_cancelled',
            cancellation_reason: reason,
            cancelled_at: existingRegistration.cancelled_at || now,
            cancelled_by: actor.id,
            refund_status: 'manual_pending',
            refund_amount: refundAmount,
            refund_method: optionalText(data?.refundMethod),
            refund_note: optionalText(data?.refundNote),
            updated_at: now
          })
          .eq('id', registrationId)
          .eq('event_id', eventId)
          .select('*')
          .maybeSingle();

        if (updateError || !updatedRegistration) {
          console.error('[Admin Persistence API] Erro ao cancelar inscrição:', updateError);
          return NextResponse.json({ error: 'Erro ao cancelar a inscrição.' }, { status: 500 });
        }

        return NextResponse.json({
          success: true,
          registration: mapRegistrationForClient(updatedRegistration)
        });
      }

      case 'markRegistrationRefunded': {
        const { registrationId, eventId, data } = payload as {
          registrationId: string;
          eventId: string;
          data: Record<string, unknown>;
        };

        await ensureEventOwner(supabaseAdmin, actor, eventId);

        const method = asTrimmed(data?.refundMethod);
        if (!method) {
          return NextResponse.json({ error: 'Informe o método usado no reembolso manual.' }, { status: 400 });
        }

        let refundAmount: number;
        try {
          refundAmount = parseRefundAmount(data?.refundAmount, true) as number;
        } catch (error) {
          return NextResponse.json({ error: error instanceof Error ? error.message : 'Valor de reembolso invalido.' }, { status: 400 });
        }

        const { data: existingRegistration, error: existingError } = await supabaseAdmin
          .from('registrations')
          .select('id, event_id, payment_status')
          .eq('id', registrationId)
          .eq('event_id', eventId)
          .maybeSingle();

        if (existingError || !existingRegistration) {
          return NextResponse.json({ error: 'Inscrição não encontrada para este evento.' }, { status: 404 });
        }

        if (existingRegistration.payment_status !== 'payment_cancelled') {
          return NextResponse.json({ error: 'Cancele a inscrição antes de marcar o reembolso manual.' }, { status: 400 });
        }

        const now = new Date().toISOString();
        const { data: updatedRegistration, error: updateError } = await supabaseAdmin
          .from('registrations')
          .update({
            refund_status: 'manual_refunded',
            refund_amount: refundAmount,
            refund_method: method,
            refund_note: optionalText(data?.refundNote),
            refund_processed_at: now,
            refund_processed_by: actor.id,
            updated_at: now
          })
          .eq('id', registrationId)
          .eq('event_id', eventId)
          .select('*')
          .maybeSingle();

        if (updateError || !updatedRegistration) {
          console.error('[Admin Persistence API] Erro ao registrar reembolso manual:', updateError);
          return NextResponse.json({ error: 'Erro ao registrar o reembolso manual.' }, { status: 500 });
        }

        return NextResponse.json({
          success: true,
          registration: mapRegistrationForClient(updatedRegistration)
        });
      }

      case 'updateRegistration': {
        const { registrationId, eventId, data } = payload as {
          registrationId: string;
          eventId: string;
          data: Record<string, unknown>;
        };

        await ensureEventOwner(supabaseAdmin, actor, eventId);

        const { data: registration, error: regError } = await supabaseAdmin
          .from('registrations')
          .select('*')
          .eq('id', registrationId)
          .eq('event_id', eventId)
          .maybeSingle();

        if (regError || !registration) {
          return NextResponse.json({ error: 'Inscrição não encontrada para este evento.' }, { status: 404 });
        }

        const cleanInstagram = (value: unknown) => asTrimmed(value).replace(/^@+/, '');
        const normalizeMembers = (value: unknown) => (Array.isArray(value) ? value : [])
          .map((member) => {
            const m = (member ?? {}) as Record<string, unknown>;
            return {
              name: asTrimmed(m.name),
              instagram: cleanInstagram(m.instagram),
              shirtSize: asTrimmed(m.shirtSize)
            };
          })
          .filter((member) => member.name);

        // Categoria de destino (relocação). Mantém a atual se não for informada.
        const targetDivisionId = asTrimmed(data.divisionId, registration.division_id);
        if (targetDivisionId) {
          const { data: division, error: divisionError } = await supabaseAdmin
            .from('divisions')
            .select('id, name, event_id')
            .eq('id', targetDivisionId)
            .eq('event_id', eventId)
            .maybeSingle();
          if (divisionError || !division) {
            return NextResponse.json({ error: 'Categoria de destino não encontrada para este evento.' }, { status: 400 });
          }
        }

        const nextAthleteName = asTrimmed(data.athleteName, registration.athlete_name);
        const nextBox = asTrimmed(data.box, registration.box || 'Independente');
        const nextEmail = asTrimmed(data.athleteEmail, registration.athlete_email);
        const nextPhone = asTrimmed(data.athletePhone, registration.athlete_phone);
        const nextGender = data.gender === 'female' || data.gender === 'male'
          ? data.gender
          : registration.gender;
        const nextInstagram = cleanInstagram(data.instagram);
        const nextShirtSize = asTrimmed(data.shirtSize);
        const nextIsTeam = typeof data.isTeam === 'boolean' ? data.isTeam : undefined;
        const nextMembers = data.teamMembers !== undefined ? normalizeMembers(data.teamMembers) : undefined;

        const parseMembers = (value: unknown) => {
          if (Array.isArray(value)) return value;
          if (typeof value === 'string') {
            try {
              const parsed = JSON.parse(value);
              return Array.isArray(parsed) ? parsed : [];
            } catch {
              return [];
            }
          }
          return [];
        };

        // O valor pago (total_paid) e preservado: relocacao de categoria e
        // correcao de cadastro, nao recobranca. A RPC executa inscricao,
        // atleta vinculado e leaderboard na mesma transacao do banco.
        const { data: rpcResult, error: updateError } = await supabaseAdmin
          .rpc('admin_update_registration_details', {
            p_registration_id: registrationId,
            p_event_id: eventId,
            p_division_id: targetDivisionId,
            p_athlete_name: nextAthleteName,
            p_box: nextBox,
            p_athlete_email: nextEmail,
            p_athlete_phone: nextPhone,
            p_gender: nextGender,
            p_instagram: nextInstagram,
            p_shirt_size: nextShirtSize,
            p_is_team: nextIsTeam ?? null,
            p_team_members: nextMembers ?? null
          });

        if (updateError || !rpcResult) {
          console.error('[Admin Persistence API] Erro ao atualizar inscrição via RPC:', updateError);
          const message = updateError?.message || '';
          if (message.includes('registration_not_found')) {
            return NextResponse.json({ error: 'Inscrição não encontrada para este evento.' }, { status: 404 });
          }
          if (message.includes('target_division_not_found')) {
            return NextResponse.json({ error: 'Categoria de destino não encontrada para este evento.' }, { status: 400 });
          }
          return NextResponse.json({ error: 'Erro ao atualizar a inscrição.' }, { status: 500 });
        }

        const normalizedResult = rpcResult as {
          registration?: Record<string, unknown>;
          athlete?: Record<string, unknown> | null;
          leaderboardEntry?: Record<string, unknown> | null;
        };
        const updatedRegistration = normalizedResult.registration;
        const updatedAthlete = normalizedResult.athlete;
        const leaderboardEntry = normalizedResult.leaderboardEntry || null;

        if (!updatedRegistration) {
          console.error('[Admin Persistence API] RPC retornou inscrição vazia:', rpcResult);
          return NextResponse.json({ error: 'Erro ao atualizar a inscrição.' }, { status: 500 });
        }

        return NextResponse.json({
          success: true,
          registration: {
            id: updatedRegistration.id,
            eventId: updatedRegistration.event_id,
            divisionId: updatedRegistration.division_id,
            userId: updatedRegistration.user_id || undefined,
            athleteId: updatedRegistration.athlete_id || undefined,
            athleteName: updatedRegistration.athlete_name,
            athleteEmail: updatedRegistration.athlete_email,
            athletePhone: updatedRegistration.athlete_phone,
            box: updatedRegistration.box,
            gender: updatedRegistration.gender,
            ticketType: updatedRegistration.ticket_type,
            ticketPrice: Number(updatedRegistration.ticket_price),
            quantity: Number(updatedRegistration.quantity),
            totalPaid: Number(updatedRegistration.total_paid),
            createdAt: updatedRegistration.created_at,
            couponCode: updatedRegistration.coupon_code || undefined,
            paymentStatus: updatedRegistration.payment_status || undefined,
            paymentMethod: updatedRegistration.payment_method || undefined,
            paymentId: updatedRegistration.payment_id || undefined,
            paymentStatusDetail: updatedRegistration.payment_status_detail || undefined,
            paymentErrorMessage: updatedRegistration.payment_error_message || undefined,
            cancellationReason: updatedRegistration.cancellation_reason || undefined,
            cancelledAt: updatedRegistration.cancelled_at || undefined,
            cancelledBy: updatedRegistration.cancelled_by || undefined,
            refundStatus: updatedRegistration.refund_status || 'not_requested',
            refundAmount: updatedRegistration.refund_amount !== null && updatedRegistration.refund_amount !== undefined ? Number(updatedRegistration.refund_amount) : undefined,
            refundMethod: updatedRegistration.refund_method || undefined,
            refundNote: updatedRegistration.refund_note || undefined,
            refundProcessedAt: updatedRegistration.refund_processed_at || undefined,
            refundProcessedBy: updatedRegistration.refund_processed_by || undefined,
            updatedAt: updatedRegistration.updated_at || undefined
          },
          athlete: updatedAthlete ? {
            id: updatedAthlete.id,
            name: updatedAthlete.name,
            box: updatedAthlete.box,
            country: updatedAthlete.country || 'BR',
            divisionId: updatedAthlete.division_id,
            birthDate: updatedAthlete.birth_date || undefined,
            gender: updatedAthlete.gender || undefined,
            city: updatedAthlete.city || undefined,
            state: updatedAthlete.state || undefined,
            instagram: updatedAthlete.instagram || undefined,
            photoUrl: updatedAthlete.photo_url || undefined,
            shirtSize: updatedAthlete.shirt_size || undefined,
            email: updatedAthlete.email || undefined,
            phone: updatedAthlete.phone || undefined,
            isTeam: Boolean(updatedAthlete.is_team),
            teamMembers: parseMembers(updatedAthlete.team_members)
          } : null,
          leaderboardEntry
        });
      }

      case 'upsertScores': {
        const scores = Array.isArray(payload.scores) ? payload.scores : [];
        const workoutIds = [...new Set(
          scores.map((score: { workout_id?: string }) => score.workout_id).filter(Boolean)
        )] as string[];

        if (workoutIds.length === 0) {
          return NextResponse.json({ error: 'Nenhum resultado informado.' }, { status: 400 });
        }

        // A autorização é derivada dos workout_id efetivamente gravados em
        // payload.scores — nunca de um array de eventIds separado enviado pelo
        // cliente, que poderia não corresponder aos dados realmente mutados.
        const { data: scoreWorkouts, error: workoutsError } = await supabaseAdmin
          .from('workouts')
          .select('id, event_id')
          .in('id', workoutIds);
        if (workoutsError) throw workoutsError;

        const foundWorkoutIds = new Set((scoreWorkouts || []).map((workout) => workout.id));
        const missingWorkoutId = workoutIds.find((id) => !foundWorkoutIds.has(id));
        if (missingWorkoutId) {
          return NextResponse.json({ error: 'Prova nao encontrada para um dos resultados.' }, { status: 404 });
        }

        const eventIds = [...new Set((scoreWorkouts || []).map((workout) => workout.event_id))];
        for (const eventId of eventIds) {
          await ensureEventOwner(supabaseAdmin, actor, eventId);
        }

        const { data: scoreEvents, error: scoreEventsError } = await supabaseAdmin
          .from('events')
          .select('id, event_type')
          .in('id', eventIds);
        if (scoreEventsError) throw scoreEventsError;
        if ((scoreEvents || []).some(event => isQualifierEvent(event.event_type))) {
          return NextResponse.json({ error: 'Scores de Qualifier devem ser definidos exclusivamente pela revisão de submissões.' }, { status: 409 });
        }

        const { error } = await supabaseAdmin
          .from('scores')
          .upsert(scores, { onConflict: 'athlete_id,workout_id' });
        if (error) throw error;
        return NextResponse.json({ success: true });
      }

      case 'repairWorkouts': {
        const eventIds = [...new Set((payload.workouts || []).map((workout: { event_id: string }) => workout.event_id))];
        for (const eventId of eventIds) {
          await ensureEventOwner(supabaseAdmin, actor, String(eventId));
        }
        const { error } = await supabaseAdmin.from('workouts').insert(payload.workouts);
        if (error) throw error;
        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json({ error: 'Acao de persistencia invalida.' }, { status: 400 });
    }
  } catch (err) {
    if (err instanceof ManagerAccessError) {
      return managerAccessErrorResponse(err);
    }
    console.error('[Admin Persistence API] Erro ao persistir dados:', err);
    return NextResponse.json({
      error: safeErrorMessage(err, 'Erro ao persistir dados.')
    }, { status: 500 });
  }
}
