import type { SupabaseClient } from '@supabase/supabase-js';
import type { Event } from '@/types';

// Leitura de um evento para as regras de ciclo de vida no servidor (trava de
// inscrição do checkout, destaque da home). Story 1.71: pede também as datas
// estruturadas; se o banco ainda não tem a migration, lê sem elas e a regra
// cai na leitura do texto de `date`, como antes.

const EVENT_DATE_COLUMNS = ['start_date', 'end_date'] as const;

type QueryError = { message?: string; code?: string } | null;

const isMissingDateColumn = (error: QueryError) => {
  if (!error || (error.code !== '42703' && error.code !== 'PGRST204')) return false;
  const message = String(error.message || '');
  return EVENT_DATE_COLUMNS.some((column) => message.includes(column));
};

export const selectEventWithDates = async <T>(
  supabaseAdmin: SupabaseClient,
  eventId: string,
  columns: string,
): Promise<{ data: T | null; error: QueryError }> => {
  const withDates = await supabaseAdmin
    .from('events')
    .select(`${columns}, start_date, end_date`)
    .eq('id', eventId)
    .maybeSingle<T>();
  if (!isMissingDateColumn(withDates.error)) return withDates;

  console.warn('[Event Lifecycle] Datas do evento ausentes no banco, lendo sem elas:', JSON.stringify({ eventId }));
  return supabaseAdmin
    .from('events')
    .select(columns)
    .eq('id', eventId)
    .maybeSingle<T>();
};

export type EventLifecycleRow = {
  status: Event['status'];
  date: string;
  registration_deadline?: string | null;
  is_ticketing_active?: boolean | null;
  start_date?: string | null;
  end_date?: string | null;
  time_zone?: string | null;
};

/** Converte a linha do banco no formato que as regras de eventStatus.ts leem. */
export const toEventLifecycleInput = (row: EventLifecycleRow) => ({
  status: row.status,
  date: row.date,
  registrationDeadline: row.registration_deadline || undefined,
  isTicketingActive: row.is_ticketing_active !== false,
  startDate: row.start_date || undefined,
  endDate: row.end_date || undefined,
  timeZone: row.time_zone || undefined,
});
