import type { SupabaseClient } from '@supabase/supabase-js';
import type { Division, Event, Registration } from '@/types';
import {
  PUBLIC_EVENT_SELECT_LEGACY,
  readBootstrapPages,
  readBootstrapQuery,
  readEventsWithFeaturedFallback
} from '@/lib/bootstrapPayload';
import { getManagerAccessStatus, normalizeServiceValidUntil } from '@/lib/managerAccess';
import { normalizeServiceFeePayer } from '@/lib/serviceFee';
import { resolveUserCreatedAt, type OwnerOverviewSource, type OwnerSourceUser } from '@/lib/ownerOverview';

// Leitura do banco para o painel do proprietário (Story 1.122). Toda tabela que
// cresce com o uso é lida em páginas (readBootstrapPages, Story 1.119): o
// PostgREST corta em 1.000 linhas sem erro. Só leitura; nenhuma escrita aqui.

type Row = Record<string, unknown>;

export const OWNER_REGISTRATION_SELECT = 'id, event_id, division_id, athlete_id, quantity, total_paid, service_fee_amount, service_fee_payer, amount_collected, application_fee_charged, payment_status, payment_gateway, created_at';
const OWNER_DIVISION_SELECT = 'id, event_id, slots_limit, is_active';
const OWNER_USER_SELECT = 'id, name, email, role, organization, service_valid_until';
const OWNER_PANEL_USER_ROLES = ['owner', 'manager'];

const text = (value: unknown) => (typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value));
const optionalText = (value: unknown) => (typeof value === 'string' && value.trim() ? value : undefined);
const toNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Mesmos padrões do AppContext (mapeamento do evento) para os campos que o painel usa. */
export const mapOwnerEventRow = (row: Row, divisions: Division[]): Event => ({
  id: text(row.id),
  name: text(row.name),
  logoUrl: text(row.logo_url),
  bannerUrl: text(row.banner_url),
  status: (optionalText(row.status) || 'upcoming') as Event['status'],
  location: text(row.location),
  date: text(row.date),
  startDate: optionalText(row.start_date),
  endDate: optionalText(row.end_date),
  description: '',
  organizerId: text(row.organizer_id),
  sponsors: [],
  divisions,
  workouts: [],
  format: (optionalText(row.format) || 'individual') as Event['format'],
  ticketPrice: row.ticket_price === null || row.ticket_price === undefined ? 150 : toNumber(row.ticket_price),
  ticketSlots: row.ticket_slots === null || row.ticket_slots === undefined ? 100 : toNumber(row.ticket_slots),
  isTicketingActive: row.is_ticketing_active === null || row.is_ticketing_active === undefined ? true : Boolean(row.is_ticketing_active),
  isFeatured: Boolean(row.is_featured),
  registrationDeadline: optionalText(row.registration_deadline),
  currency: (optionalText(row.currency) || 'BRL') as Event['currency'],
  timeZone: optionalText(row.time_zone) || 'America/Fortaleza'
} as Event);

const mapOwnerDivisionRow = (row: Row): Division => ({
  id: text(row.id),
  slotsLimit: toNumber(row.slots_limit),
  isActive: row.is_active === null || row.is_active === undefined ? true : Boolean(row.is_active)
} as Division);

export const mapOwnerRegistrationRow = (row: Row): Registration => ({
  id: text(row.id),
  eventId: text(row.event_id),
  divisionId: text(row.division_id),
  athleteId: text(row.athlete_id),
  quantity: row.quantity === null || row.quantity === undefined ? 1 : toNumber(row.quantity),
  totalPaid: toNumber(row.total_paid),
  serviceFeeAmount: toNumber(row.service_fee_amount),
  serviceFeePayer: normalizeServiceFeePayer(row.service_fee_payer) || undefined,
  amountCollected: row.amount_collected === null || row.amount_collected === undefined ? undefined : toNumber(row.amount_collected),
  applicationFeeCharged: toNumber(row.application_fee_charged),
  paymentStatus: (optionalText(row.payment_status) || 'payment_pending') as Registration['paymentStatus'],
  paymentGateway: (optionalText(row.payment_gateway) || 'mercadopago') as Registration['paymentGateway'],
  createdAt: text(row.created_at)
} as Registration);

const isMissingColumnError = (error: unknown, column: string) => {
  const candidate = error as { code?: string; message?: string } | null;
  return Boolean(candidate && (candidate.code === '42703' || candidate.code === 'PGRST204')
    && String(candidate.message || '').includes(column));
};

/**
 * Usuários do painel (owner e manager) com a data de cadastro. Sem a migration de
 * `users.created_at` (aplicada só a pedido), a data sai do horário que já está no
 * id (org-1717…), como decidido em E3.
 */
export const readOwnerPanelUsers = async (supabaseAdmin: SupabaseClient): Promise<OwnerSourceUser[]> => {
  const readUsers = (select: string) => readBootstrapPages('usuários do painel do proprietário', (from, to) => supabaseAdmin
    .from('users')
    .select(select)
    .in('role', OWNER_PANEL_USER_ROLES)
    .order('id', { ascending: true })
    .range(from, to));

  // Sonda de uma linha: diz se a coluna já existe sem derrubar a leitura toda.
  const probe = await supabaseAdmin.from('users').select('id, created_at').range(0, 0);
  const hasCreatedAt = !isMissingColumnError(probe.error, 'created_at');
  if (!hasCreatedAt) console.warn('[Owner Overview] users.created_at ausente; data do cadastro lida do id.');
  const rows: Row[] = await readUsers(hasCreatedAt ? `${OWNER_USER_SELECT}, created_at` : OWNER_USER_SELECT);

  return rows.map(row => {
    const serviceValidUntil = normalizeServiceValidUntil(row.service_valid_until);
    return {
      id: text(row.id),
      name: text(row.name),
      email: text(row.email),
      role: text(row.role) as OwnerSourceUser['role'],
      organization: optionalText(row.organization),
      serviceValidUntil,
      managerAccessStatus: getManagerAccessStatus(serviceValidUntil),
      createdAt: resolveUserCreatedAt(text(row.id), optionalText(row.created_at))
    };
  });
};

export const readOwnerOverviewSource = async (supabaseAdmin: SupabaseClient): Promise<OwnerOverviewSource> => {
  const [eventRows, divisionRows, registrationRows, users, mercadopagoRows, stripeRows, payerRows, leadRows] = await Promise.all([
    readEventsWithFeaturedFallback<Row[]>(
      'eventos do proprietário',
      (select) => supabaseAdmin.from('events').select(select),
      () => supabaseAdmin.from('events').select(PUBLIC_EVENT_SELECT_LEGACY)
    ),
    readBootstrapPages('divisões do proprietário', (from, to) => supabaseAdmin
      .from('divisions')
      .select(OWNER_DIVISION_SELECT)
      .order('id', { ascending: true })
      .range(from, to)),
    readBootstrapPages('inscrições do painel do proprietário', (from, to) => supabaseAdmin
      .from('registrations')
      .select(OWNER_REGISTRATION_SELECT)
      .order('id', { ascending: true })
      .range(from, to)),
    readOwnerPanelUsers(supabaseAdmin),
    readBootstrapQuery('contas Mercado Pago do proprietário', supabaseAdmin
      .from('mercadopago_accounts')
      .select('user_id, status')),
    readBootstrapQuery('contas Stripe do proprietário', supabaseAdmin
      .from('stripe_accounts')
      .select('user_id, status, charges_enabled')),
    readBootstrapQuery('quem paga a taxa (proprietário)', supabaseAdmin
      .from('manager_payment_settings')
      .select('user_id, service_fee_payer')),
    readBootstrapPages('leads do proprietário', (from, to) => supabaseAdmin
      .from('commercial_leads')
      .select('id, manager_name, event_name, lead_status, owner_email_notification_status, submitted_at')
      .order('id', { ascending: true })
      .range(from, to))
  ]);

  const divisionsByEvent = new Map<string, Division[]>();
  (divisionRows as Row[]).forEach(row => {
    const eventId = text(row.event_id);
    const bucket = divisionsByEvent.get(eventId);
    const division = mapOwnerDivisionRow(row);
    if (bucket) bucket.push(division);
    else divisionsByEvent.set(eventId, [division]);
  });

  const connectedPaymentUserIds = new Set<string>();
  (mercadopagoRows as Row[]).forEach(row => {
    if (text(row.status) === 'connected') connectedPaymentUserIds.add(text(row.user_id));
  });
  (stripeRows as Row[]).forEach(row => {
    if (text(row.status) === 'connected' && row.charges_enabled !== false) connectedPaymentUserIds.add(text(row.user_id));
  });

  const feePayers: Record<string, 'athlete' | 'organizer'> = {};
  (payerRows as Row[]).forEach(row => {
    const payer = normalizeServiceFeePayer(row.service_fee_payer);
    if (payer) feePayers[text(row.user_id)] = payer;
  });

  return {
    events: (eventRows as Row[]).map(row => mapOwnerEventRow(row, divisionsByEvent.get(text(row.id)) || [])),
    registrations: (registrationRows as Row[]).map(mapOwnerRegistrationRow),
    users,
    connectedPaymentUserIds,
    feePayers,
    leads: (leadRows as Row[]).map(row => ({
      id: text(row.id),
      managerName: text(row.manager_name),
      eventName: text(row.event_name),
      leadStatus: text(row.lead_status) || 'new',
      emailStatus: text(row.owner_email_notification_status),
      submittedAt: text(row.submitted_at)
    }))
  };
};
