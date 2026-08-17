import { SupabaseClient } from '@supabase/supabase-js';
import { getManagerAccessStatus, isManagerAccessBlocked } from '@/lib/managerAccess';
import { SessionUser } from '@/lib/serverSecurity';

type EventRow = {
  id: string;
  organizer_id: string;
  event_type?: string | null;
};

type JudgeRow = {
  id: string;
  role: string;
  parent_manager_id?: string | null;
};

type OrganizerRow = {
  id: string;
  role: string;
  service_valid_until?: string | null;
};

export class JudgeAccessError extends Error {
  constructor(message: string, readonly status = 403) {
    super(message);
    this.name = 'JudgeAccessError';
  }
}

const getEvent = async (supabaseAdmin: SupabaseClient, eventId: string) => {
  const { data, error } = await supabaseAdmin
    .from('events')
    .select('id, organizer_id, event_type')
    .eq('id', eventId)
    .maybeSingle<EventRow>();
  if (error) throw error;
  if (!data) throw new JudgeAccessError('Evento não encontrado.', 404);
  if (data.event_type !== 'functional_fitness_qualifier') {
    throw new JudgeAccessError('Esta operação é exclusiva de eventos Functional Fitness Qualifier.', 400);
  }
  return data;
};

const assertOrganizerIsOperational = async (supabaseAdmin: SupabaseClient, organizerId: string) => {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id, role, service_valid_until')
    .eq('id', organizerId)
    .maybeSingle<OrganizerRow>();
  if (error) throw error;
  if (!data || (data.role !== 'manager' && data.role !== 'owner')) {
    throw new JudgeAccessError('Organizador responsável não encontrado.');
  }
  if (data.role === 'manager' && isManagerAccessBlocked(getManagerAccessStatus(data.service_valid_until))) {
    throw new JudgeAccessError('O período de uso da plataforma para este gestor expirou.');
  }
  return data;
};

export const assertQualifierEventManagerAccess = async (
  supabaseAdmin: SupabaseClient,
  actor: SessionUser,
  eventId: string
) => {
  const event = await getEvent(supabaseAdmin, eventId);
  if (actor.role === 'owner') return event;
  if (actor.role !== 'manager' || event.organizer_id !== actor.id) {
    throw new JudgeAccessError('Acesso negado para este evento.');
  }
  await assertOrganizerIsOperational(supabaseAdmin, actor.id);
  return event;
};

export const assertQualifierJudgeAccess = async (
  supabaseAdmin: SupabaseClient,
  actor: SessionUser,
  eventId: string
) => {
  const event = await getEvent(supabaseAdmin, eventId);
  if (actor.role === 'owner') return event;
  if (actor.role === 'manager') {
    if (event.organizer_id !== actor.id) throw new JudgeAccessError('Acesso negado para este evento.');
    await assertOrganizerIsOperational(supabaseAdmin, actor.id);
    return event;
  }
  if (actor.role !== 'judge') throw new JudgeAccessError('Apenas judges podem revisar submissões.');

  const { data: judge, error: judgeError } = await supabaseAdmin
    .from('users')
    .select('id, role, parent_manager_id')
    .eq('id', actor.id)
    .maybeSingle<JudgeRow>();
  if (judgeError) throw judgeError;
  if (!judge || judge.role !== 'judge' || !judge.parent_manager_id || judge.parent_manager_id !== event.organizer_id) {
    throw new JudgeAccessError('Judge sem vínculo válido com o gestor do evento.');
  }

  await assertOrganizerIsOperational(supabaseAdmin, judge.parent_manager_id);
  const { data: assignment, error: assignmentError } = await supabaseAdmin
    .from('event_judges')
    .select('event_id')
    .eq('event_id', eventId)
    .eq('judge_user_id', actor.id)
    .maybeSingle();
  if (assignmentError) throw assignmentError;
  if (!assignment) throw new JudgeAccessError('Judge não atribuído a este evento.');
  return event;
};

export const getQualifierEventIdsForActor = async (
  supabaseAdmin: SupabaseClient,
  actor: SessionUser
) => {
  if (actor.role === 'owner') {
    const { data, error } = await supabaseAdmin
      .from('events')
      .select('id')
      .eq('event_type', 'functional_fitness_qualifier');
    if (error) throw error;
    return (data || []).map(event => String(event.id));
  }
  if (actor.role === 'manager') {
    await assertOrganizerIsOperational(supabaseAdmin, actor.id);
    const { data, error } = await supabaseAdmin
      .from('events')
      .select('id')
      .eq('organizer_id', actor.id)
      .eq('event_type', 'functional_fitness_qualifier');
    if (error) throw error;
    return (data || []).map(event => String(event.id));
  }
  if (actor.role !== 'judge') throw new JudgeAccessError('Acesso negado.');

  const { data: judge, error: judgeError } = await supabaseAdmin
    .from('users')
    .select('id, role, parent_manager_id')
    .eq('id', actor.id)
    .maybeSingle<JudgeRow>();
  if (judgeError) throw judgeError;
  if (!judge || judge.role !== 'judge' || !judge.parent_manager_id) {
    throw new JudgeAccessError('Judge sem gestor responsável.');
  }
  await assertOrganizerIsOperational(supabaseAdmin, judge.parent_manager_id);
  const { data: assignments, error } = await supabaseAdmin
    .from('event_judges')
    .select('event_id')
    .eq('judge_user_id', actor.id);
  if (error) throw error;
  const ids = (assignments || []).map(assignment => String(assignment.event_id));
  if (ids.length === 0) return [];
  const { data: qualifierEvents, error: eventsError } = await supabaseAdmin
    .from('events')
    .select('id')
    .in('id', ids)
    .eq('event_type', 'functional_fitness_qualifier')
    .eq('organizer_id', judge.parent_manager_id);
  if (eventsError) throw eventsError;
  return (qualifierEvents || []).map(event => String(event.id));
};
