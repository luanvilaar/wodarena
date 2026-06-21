import { NextResponse } from 'next/server';
import { mapContestationFromDb } from '@/lib/contestations';
import { sendContestationStatusEmail } from '@/lib/resend';
import { ManagerAccessError, assertManagerOperationalAccess, managerAccessErrorResponse } from '@/lib/serverManagerAccess';
import { createSupabaseAdmin, requireSession } from '@/lib/serverSecurity';
import { ContestationStatus } from '@/types';

const isValidStatus = (status: string): status is ContestationStatus => (
  status === 'under_review' || status === 'approved' || status === 'rejected'
);

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

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = requireSession(request, ['manager', 'owner']);
    if (auth.response) return auth.response;

    const actor = auth.user;
    const supabaseAdmin = createSupabaseAdmin();
    await assertManagerOperationalAccess(supabaseAdmin, actor);
    const { id } = await context.params;
    const body = await request.json() as {
      status?: string;
      creditRefunded?: boolean;
      managerNote?: string;
    };

    const status = String(body.status || '').trim();
    const managerNote = typeof body.managerNote === 'string' ? body.managerNote.trim() : undefined;

    if (!isValidStatus(status)) {
      return NextResponse.json({ error: 'Status de contestação inválido.' }, { status: 400 });
    }

    if (body.creditRefunded === true && status !== 'approved') {
      return NextResponse.json({ error: 'A devolução de crédito só pode ocorrer em contestação deferida.' }, { status: 400 });
    }

    const { data: existingRow, error: existingError } = await supabaseAdmin
      .from('contestations')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (existingError || !existingRow) {
      return NextResponse.json({ error: 'Contestação não encontrada.' }, { status: 404 });
    }

    if (actor.role === 'manager') {
      await ensureManagerEventAccess(supabaseAdmin, actor.id, String(existingRow.event_id));
    }

    const existing = mapContestationFromDb(existingRow);
    const creditRefunded = status === 'approved'
      ? (body.creditRefunded !== undefined ? body.creditRefunded : existing.creditRefunded)
      : false;

    const resolvedAt = status === 'under_review' ? null : new Date().toISOString();
    const payload = {
      status,
      credit_refunded: creditRefunded,
      manager_note: managerNote || null,
      resolved_at: resolvedAt
    };

    const { data: updatedRow, error: updateError } = await supabaseAdmin
      .from('contestations')
      .update(payload)
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (updateError || !updatedRow) throw updateError || new Error('Falha ao atualizar contestação.');

    const contestation = mapContestationFromDb(updatedRow);

    const [{ data: registration }, { data: event }, { data: workout }] = await Promise.all([
      supabaseAdmin
        .from('registrations')
        .select('athlete_email, athlete_name')
        .eq('id', contestation.registrationId)
        .maybeSingle(),
      supabaseAdmin
        .from('events')
        .select('name')
        .eq('id', contestation.eventId)
        .maybeSingle(),
      supabaseAdmin
        .from('workouts')
        .select('name')
        .eq('id', contestation.workoutId)
        .maybeSingle()
    ]);

    let emailDelivered = false;

    if (registration?.athlete_email) {
      const emailResult = await sendContestationStatusEmail({
        toEmail: registration.athlete_email,
        athleteName: registration.athlete_name || 'Atleta',
        eventName: event?.name || 'Evento WODArena',
        workoutName: workout?.name || 'Prova',
        heatLabel: contestation.heatNumber ? `Bateria ${contestation.heatNumber}` : 'Bateria informada pelo atleta',
        lane: contestation.lane,
        status: contestation.status,
        creditRefunded: contestation.creditRefunded,
        managerNote: contestation.managerNote
      });
      emailDelivered = emailResult.success === true;
    }

    return NextResponse.json({ success: true, contestation, emailDelivered });
  } catch (err) {
    if (err instanceof ManagerAccessError) {
      return managerAccessErrorResponse(err);
    }
    console.error('[Contestation Status API] Erro ao atualizar contestacao:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro ao atualizar contestacao.' }, { status: 500 });
  }
}
