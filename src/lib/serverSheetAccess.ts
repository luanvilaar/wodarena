import type { SupabaseClient } from '@supabase/supabase-js';

import { getManagerAccessStatus, isManagerAccessBlocked } from '@/lib/managerAccess';
import type { SessionUser } from '@/lib/serverSecurity';

// Acesso à súmula presencial (Story 1.49). Mesmas regras do Qualifier
// (serverJudgeAccess.ts), que continua como está, mas para eventos Functional
// Fitness presenciais:
// - judge: conta de judge do mesmo gestor do evento e atribuída ao evento
//   (event_judges), com o gestor com acesso válido;
// - manager: dono do evento e com acesso válido;
// - owner: qualquer evento presencial.

type EventRow = { id: string; name: string; organizer_id: string; event_type?: string | null };
type UserRow = { id: string; role: string; parent_manager_id?: string | null; service_valid_until?: string | null };

export class SheetAccessError extends Error {
  constructor(message: string, readonly status = 403) {
    super(message);
    this.name = 'SheetAccessError';
  }
}

export const isPresentialEventType = (eventType: unknown) => !eventType || eventType === 'functional_fitness';

export const readSheetEvent = async (supabaseAdmin: SupabaseClient, eventId: unknown): Promise<EventRow> => {
  if (typeof eventId !== 'string' || !eventId) throw new SheetAccessError('Informe o evento.', 400);
  const { data, error } = await supabaseAdmin
    .from('events')
    .select('id, name, organizer_id, event_type')
    .eq('id', eventId)
    .maybeSingle<EventRow>();
  if (error) throw error;
  if (!data) throw new SheetAccessError('Evento não encontrado.', 404);
  if (!isPresentialEventType(data.event_type)) {
    throw new SheetAccessError('A súmula digital é exclusiva de eventos Functional Fitness presenciais.', 400);
  }
  return data;
};

const assertOrganizerIsOperational = async (supabaseAdmin: SupabaseClient, organizerId: string) => {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id, role, service_valid_until')
    .eq('id', organizerId)
    .maybeSingle<UserRow>();
  if (error) throw error;
  if (!data || (data.role !== 'manager' && data.role !== 'owner')) {
    throw new SheetAccessError('Organizador responsável não encontrado.');
  }
  if (data.role === 'manager' && isManagerAccessBlocked(getManagerAccessStatus(data.service_valid_until))) {
    throw new SheetAccessError('O período de uso da plataforma para este gestor expirou.');
  }
};

const readJudge = async (supabaseAdmin: SupabaseClient, actor: SessionUser) => {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id, role, parent_manager_id')
    .eq('id', actor.id)
    .maybeSingle<UserRow>();
  if (error) throw error;
  if (!data || data.role !== 'judge' || !data.parent_manager_id) {
    throw new SheetAccessError('Judge sem gestor responsável.');
  }
  return data as UserRow & { parent_manager_id: string };
};

/** Gestor dono do evento (com acesso válido) ou owner: quem revisa, corrige e cancela súmulas. */
export const assertSheetManagerAccess = async (supabaseAdmin: SupabaseClient, actor: SessionUser, eventId: unknown) => {
  const event = await readSheetEvent(supabaseAdmin, eventId);
  if (actor.role === 'owner') return event;
  if (actor.role !== 'manager' || event.organizer_id !== actor.id) throw new SheetAccessError('Acesso negado para este evento.');
  await assertOrganizerIsOperational(supabaseAdmin, actor.id);
  return event;
};

/** Quem pode arbitrar o evento: judge atribuído, o gestor dono ou o owner. */
export const assertSheetJudgeAccess = async (supabaseAdmin: SupabaseClient, actor: SessionUser, eventId: unknown) => {
  if (actor.role === 'owner' || actor.role === 'manager') return assertSheetManagerAccess(supabaseAdmin, actor, eventId);
  if (actor.role !== 'judge') throw new SheetAccessError('Apenas judges podem arbitrar.');
  const event = await readSheetEvent(supabaseAdmin, eventId);
  const judge = await readJudge(supabaseAdmin, actor);
  if (judge.parent_manager_id !== event.organizer_id) throw new SheetAccessError('Judge sem vínculo com o gestor do evento.');
  await assertOrganizerIsOperational(supabaseAdmin, judge.parent_manager_id);
  const { data: assignment, error } = await supabaseAdmin
    .from('event_judges')
    .select('event_id')
    .eq('event_id', event.id)
    .eq('judge_user_id', actor.id)
    .maybeSingle();
  if (error) throw error;
  if (!assignment) throw new SheetAccessError('Judge não atribuído a este evento.');
  return event;
};

/** Eventos presenciais que o usuário pode arbitrar, para a lista da área do judge. */
export const listSheetEventsForActor = async (supabaseAdmin: SupabaseClient, actor: SessionUser) => {
  const select = 'id, name, date, location, organizer_id, event_type, status';
  const presential = (rows: (EventRow & Record<string, unknown>)[] | null) => (rows || []).filter((row) => isPresentialEventType(row.event_type));

  if (actor.role === 'owner') {
    const { data, error } = await supabaseAdmin.from('events').select(select);
    if (error) throw error;
    return presential(data as (EventRow & Record<string, unknown>)[]);
  }
  if (actor.role === 'manager') {
    await assertOrganizerIsOperational(supabaseAdmin, actor.id);
    const { data, error } = await supabaseAdmin.from('events').select(select).eq('organizer_id', actor.id);
    if (error) throw error;
    return presential(data as (EventRow & Record<string, unknown>)[]);
  }
  if (actor.role !== 'judge') throw new SheetAccessError('Acesso negado.');

  const judge = await readJudge(supabaseAdmin, actor);
  await assertOrganizerIsOperational(supabaseAdmin, judge.parent_manager_id);
  const { data: assignments, error } = await supabaseAdmin
    .from('event_judges')
    .select('event_id')
    .eq('judge_user_id', actor.id);
  if (error) throw error;
  const ids = (assignments || []).map((assignment) => String(assignment.event_id));
  if (ids.length === 0) return [];
  const { data: events, error: eventsError } = await supabaseAdmin
    .from('events')
    .select(select)
    .in('id', ids)
    .eq('organizer_id', judge.parent_manager_id);
  if (eventsError) throw eventsError;
  return presential(events as (EventRow & Record<string, unknown>)[]);
};
