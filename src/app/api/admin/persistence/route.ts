import { NextResponse } from 'next/server';
import { createSupabaseAdmin, requireSession, SessionUser } from '@/lib/serverSecurity';

type DbClient = ReturnType<typeof createSupabaseAdmin>;

const ensureEventOwner = async (supabaseAdmin: DbClient, actor: SessionUser, eventId: string) => {
  const { data: event, error } = await supabaseAdmin
    .from('events')
    .select('id, organizer_id')
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

export async function POST(request: Request) {
  try {
    const auth = requireSession(request, ['manager', 'owner']);
    if (auth.response) return auth.response;
    const actor = auth.user;
    const supabaseAdmin = createSupabaseAdmin();
    const { action, payload } = await request.json();

    switch (action) {
      case 'createEvent': {
        const { event, divisions = [], workouts = [] } = payload;
        if (actor.role !== 'owner' && event.organizer_id !== actor.id) {
          return NextResponse.json({ error: 'Acesso negado para criar evento em outro gestor.' }, { status: 403 });
        }

        const { error: eventError } = await supabaseAdmin.from('events').insert(event);
        if (eventError) throw eventError;

        if (divisions.length > 0) {
          const { error } = await supabaseAdmin.from('divisions').insert(divisions);
          if (error) {
            await supabaseAdmin.from('events').delete().eq('id', event.id);
            throw error;
          }
        }

        if (workouts.length > 0) {
          const { error } = await supabaseAdmin.from('workouts').insert(workouts);
          if (error) {
            await supabaseAdmin.from('events').delete().eq('id', event.id);
            throw error;
          }
        }

        return NextResponse.json({ success: true });
      }

      case 'deleteEvent': {
        await ensureEventOwner(supabaseAdmin, actor, payload.eventId);
        const { error } = await supabaseAdmin.from('events').delete().eq('id', payload.eventId);
        if (error) throw error;
        return NextResponse.json({ success: true });
      }

      case 'updateEvent': {
        await ensureEventOwner(supabaseAdmin, actor, payload.eventId);
        const { error } = await supabaseAdmin.from('events').update(payload.data).eq('id', payload.eventId);
        if (error) throw error;
        return NextResponse.json({ success: true });
      }

      case 'createDivision': {
        await ensureEventOwner(supabaseAdmin, actor, payload.division.event_id);
        const { error } = await supabaseAdmin.from('divisions').insert(payload.division);
        if (error) throw error;

        if (payload.autoWorkout) {
          const { error: workoutError } = await supabaseAdmin.from('workouts').insert(payload.autoWorkout);
          if (workoutError) {
            await supabaseAdmin.from('divisions').delete().eq('id', payload.division.id);
            throw workoutError;
          }
        }

        return NextResponse.json({ success: true });
      }

      case 'updateDivision': {
        await ensureDivisionOwner(supabaseAdmin, actor, payload.divisionId, payload.eventId);
        const { error } = await supabaseAdmin
          .from('divisions')
          .update(payload.data)
          .eq('id', payload.divisionId);
        if (error) throw error;
        return NextResponse.json({ success: true });
      }

      case 'deleteDivision': {
        await ensureDivisionOwner(supabaseAdmin, actor, payload.divisionId, payload.eventId);
        const { error } = await supabaseAdmin.from('divisions').delete().eq('id', payload.divisionId);
        if (error) throw error;
        return NextResponse.json({ success: true });
      }

      case 'createWorkout': {
        await ensureEventOwner(supabaseAdmin, actor, payload.workout.event_id);
        const { error } = await supabaseAdmin.from('workouts').insert(payload.workout);
        if (error) throw error;
        return NextResponse.json({ success: true });
      }

      case 'updateWorkout': {
        await ensureWorkoutOwner(supabaseAdmin, actor, payload.workoutId, payload.eventId);
        const { error } = await supabaseAdmin
          .from('workouts')
          .update(payload.data)
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
          .ilike('code', payload.code)
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

      case 'upsertScores': {
        const eventIds = Array.isArray(payload.eventIds) ? payload.eventIds : [];
        for (const eventId of eventIds) {
          await ensureEventOwner(supabaseAdmin, actor, eventId);
        }
        const { error } = await supabaseAdmin
          .from('scores')
          .upsert(payload.scores, { onConflict: 'athlete_id,workout_id' });
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
    console.error('[Admin Persistence API] Erro ao persistir dados:', err);
    return NextResponse.json({
      error: err instanceof Error ? err.message : 'Erro ao persistir dados.'
    }, { status: 500 });
  }
}
