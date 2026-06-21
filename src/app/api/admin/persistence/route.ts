import { NextResponse } from 'next/server';
import { ManagerAccessError, assertManagerOperationalAccess, managerAccessErrorResponse } from '@/lib/serverManagerAccess';
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
    await assertManagerOperationalAccess(supabaseAdmin, actor);
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
        const { error } = await supabaseAdmin
          .from('coupons')
          .update(payload.data)
          .eq('id', payload.couponId);
        if (error) throw error;
        return NextResponse.json({ success: true });
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

        const asTrimmed = (value: unknown, fallback = '') =>
          typeof value === 'string' && value.trim() ? value.trim() : fallback;
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
        let targetDivision: { id: string; name: string; event_id: string } | null = null;
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
          targetDivision = division;
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

        // Atualiza a inscrição. O valor pago (total_paid) é preservado: relocação
        // de categoria é correção de cadastro, não recobrança.
        const registrationUpdate: Record<string, unknown> = {
          athlete_name: nextAthleteName,
          box: nextBox,
          athlete_email: nextEmail,
          athlete_phone: nextPhone,
          gender: nextGender,
          division_id: targetDivisionId,
          ticket_type: targetDivision ? targetDivision.name : registration.ticket_type,
          updated_at: new Date().toISOString()
        };

        const { data: updatedRegistration, error: updateRegError } = await supabaseAdmin
          .from('registrations')
          .update(registrationUpdate)
          .eq('id', registrationId)
          .eq('event_id', eventId)
          .select('*')
          .single();

        if (updateRegError || !updatedRegistration) {
          console.error('[Admin Persistence API] Erro ao atualizar inscrição:', updateRegError);
          return NextResponse.json({ error: 'Erro ao atualizar a inscrição.' }, { status: 500 });
        }

        // Resolve o atleta vinculado (por id quando disponível; senão pelo nome +
        // categoria anteriores) e o mantém em sincronia com a inscrição.
        let athleteRow: Record<string, unknown> | null = null;
        if (registration.athlete_id) {
          const { data } = await supabaseAdmin
            .from('athletes')
            .select('*')
            .eq('id', registration.athlete_id)
            .maybeSingle();
          athleteRow = data;
        }
        if (!athleteRow) {
          const { data } = await supabaseAdmin
            .from('athletes')
            .select('*')
            .eq('division_id', registration.division_id)
            .ilike('name', registration.athlete_name)
            .maybeSingle();
          athleteRow = data;
        }

        const athleteUpdate: Record<string, unknown> = {
          name: nextAthleteName,
          box: nextBox,
          division_id: targetDivisionId,
          instagram: nextInstagram || null,
          shirt_size: nextShirtSize || null,
          email: nextEmail || null,
          phone: nextPhone || null,
          gender: nextGender || null
        };
        if (nextIsTeam !== undefined) athleteUpdate.is_team = nextIsTeam;
        if (nextMembers !== undefined) athleteUpdate.team_members = JSON.stringify(nextMembers);

        let updatedAthlete: Record<string, unknown> | null = null;
        if (athleteRow) {
          const { data, error: athleteUpdateError } = await supabaseAdmin
            .from('athletes')
            .update(athleteUpdate)
            .eq('id', athleteRow.id as string)
            .select('*')
            .single();
          if (athleteUpdateError) {
            console.error('[Admin Persistence API] Erro ao atualizar atleta vinculado:', athleteUpdateError);
            return NextResponse.json({ error: 'Erro ao atualizar os dados do atleta.' }, { status: 500 });
          }
          updatedAthlete = data;
        } else {
          const newAthleteId = registration.athlete_id || `ath-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          const { data, error: athleteInsertError } = await supabaseAdmin
            .from('athletes')
            .insert({
              id: newAthleteId,
              country: 'BR',
              ...athleteUpdate,
              is_team: nextIsTeam ?? false,
              team_members: nextMembers !== undefined ? JSON.stringify(nextMembers) : '[]'
            })
            .select('*')
            .single();
          if (athleteInsertError) {
            console.error('[Admin Persistence API] Erro ao criar atleta vinculado:', athleteInsertError);
            return NextResponse.json({ error: 'Erro ao registrar os dados do atleta.' }, { status: 500 });
          }
          updatedAthlete = data;
          if (!registration.athlete_id) {
            await supabaseAdmin
              .from('registrations')
              .update({ athlete_id: newAthleteId })
              .eq('id', registrationId);
            updatedRegistration.athlete_id = newAthleteId;
          }
        }

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
          } : null
        });
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
    if (err instanceof ManagerAccessError) {
      return managerAccessErrorResponse(err);
    }
    console.error('[Admin Persistence API] Erro ao persistir dados:', err);
    return NextResponse.json({
      error: err instanceof Error ? err.message : 'Erro ao persistir dados.'
    }, { status: 500 });
  }
}
