import { NextResponse } from 'next/server';
import { SupabaseClient } from '@supabase/supabase-js';
import { getManagerAccessStatus, isManagerAccessBlocked } from '@/lib/managerAccess';
import { SessionUser } from '@/lib/serverSecurity';

type ManagerUserRow = {
  id: string;
  name: string;
  email: string;
  role: 'owner' | 'manager' | 'athlete';
  organization?: string | null;
  service_valid_until?: string | null;
};

export class ManagerAccessError extends Error {
  code: string;
  status: number;
  serviceValidUntil?: string;

  constructor(
    message = 'O periodo de uso da plataforma para este gestor expirou. Renove as credenciais com a WODArena para continuar operando.',
    serviceValidUntil?: string
  ) {
    super(message);
    this.name = 'ManagerAccessError';
    this.code = 'manager_access_expired';
    this.status = 403;
    this.serviceValidUntil = serviceValidUntil;
  }
}

const getManagerRowById = async (supabaseAdmin: SupabaseClient, userId: string) => {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id, name, email, role, organization, service_valid_until')
    .eq('id', userId)
    .maybeSingle<ManagerUserRow>();

  if (error) throw error;
  return data;
};

const getManagerRowByEventId = async (supabaseAdmin: SupabaseClient, eventId: string) => {
  const { data: event, error: eventError } = await supabaseAdmin
    .from('events')
    .select('id, organizer_id')
    .eq('id', eventId)
    .maybeSingle();

  if (eventError) throw eventError;
  if (!event?.organizer_id) return null;
  return getManagerRowById(supabaseAdmin, String(event.organizer_id));
};

export const assertManagerOperationalAccess = async (
  supabaseAdmin: SupabaseClient,
  actor: SessionUser
) => {
  if (actor.role !== 'manager') return;

  const manager = await getManagerRowById(supabaseAdmin, actor.id);
  if (!manager || manager.role !== 'manager') {
    throw new ManagerAccessError('Gestor nao encontrado para validar o periodo de uso.');
  }

  const status = getManagerAccessStatus(manager.service_valid_until);
  if (isManagerAccessBlocked(status)) {
    throw new ManagerAccessError(undefined, manager.service_valid_until || undefined);
  }
};

export const assertManagerSalesAccessForEvent = async (
  supabaseAdmin: SupabaseClient,
  eventId: string
) => {
  const manager = await getManagerRowByEventId(supabaseAdmin, eventId);
  if (!manager || manager.role !== 'manager') return;

  const status = getManagerAccessStatus(manager.service_valid_until);
  if (isManagerAccessBlocked(status)) {
    throw new ManagerAccessError(undefined, manager.service_valid_until || undefined);
  }
};

export const managerAccessErrorResponse = (error: ManagerAccessError) => NextResponse.json({
  error: error.message,
  code: error.code,
  serviceValidUntil: error.serviceValidUntil || null
}, { status: error.status });
