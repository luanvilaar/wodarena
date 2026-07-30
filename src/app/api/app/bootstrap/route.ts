import { NextResponse } from 'next/server';
import {
  PUBLIC_DIVISION_SELECT,
  PUBLIC_EVENT_SELECT,
  PUBLIC_EVENT_SELECT_LEGACY,
  PUBLIC_LEADERBOARD_ENTRY_SELECT,
  PUBLIC_SCORE_SELECT,
  PUBLIC_WORKOUT_SELECT,
  readEventsWithFeaturedFallback,
  readBootstrapQuery,
  sanitizeLeaderboardEntry
} from '@/lib/bootstrapPayload';
import { getManagerAccessStatus, normalizeServiceValidUntil } from '@/lib/managerAccess';
import { createSupabaseAdmin, requireSession, type SessionUser } from '@/lib/serverSecurity';

const PRIVATE_ATHLETE_SELECT = 'id, name, box, country, division_id, birth_date, gender, city, state, instagram, photo_url, email, phone, is_team, team_members, shirt_size';
const PRIVATE_REGISTRATION_SELECT = 'id, event_id, division_id, user_id, athlete_id, athlete_name, athlete_email, athlete_phone, box, gender, ticket_type, ticket_price, quantity, total_paid, service_fee_percent, service_fee_amount, amount_collected, application_fee_charged, created_at, coupon_code, payment_status, payment_method, payment_id, payment_status_detail, payment_error_message, cancellation_reason, cancelled_at, cancelled_by, refund_status, refund_amount, refund_method, refund_note, refund_processed_at, refund_processed_by, updated_at';
const PRIVATE_CONTESTATION_SELECT = 'id, event_id, registration_id, user_id, athlete_id, workout_id, heat_id, heat_number, lane, description, status, credit_consumed, credit_refunded, manager_note, created_at, updated_at, resolved_at';
const PRIVATE_COUPON_SELECT = 'id, event_id, code, discount_type, discount_value, usage_limit, usage_count, created_at, is_active';

const emptyRows = <T>(): Promise<T[]> => Promise.resolve([]);

const scopedRows = <T>(
  ids: string[],
  query: () => PromiseLike<{ data: T[] | null; error: { message?: string; code?: string } | null }>,
  label: string
) => ids.length > 0 ? readBootstrapQuery(label, query()) : emptyRows<T>();

const mapUserForClient = (user: Record<string, unknown>) => {
  const serviceValidUntil = normalizeServiceValidUntil(user.service_valid_until || user.serviceValidUntil);
  return {
    id: String(user.id),
    name: String(user.name || ''),
    email: String(user.email || ''),
    role: user.role,
    organization: user.organization || undefined,
    serviceValidUntil,
    managerAccessStatus: user.role === 'manager' ? getManagerAccessStatus(serviceValidUntil) : undefined
  };
};

const readUsers = (supabaseAdmin: ReturnType<typeof createSupabaseAdmin>, session: SessionUser) => (
  session?.role === 'owner'
    ? readBootstrapQuery('usuários', supabaseAdmin
      .from('users')
      .select('id, name, email, role, organization, service_valid_until'))
    : readBootstrapQuery('usuário da sessão', supabaseAdmin
      .from('users')
      .select('id, name, email, role, organization, service_valid_until')
      .eq('id', session.id))
);

export async function GET(request: Request) {
  const startedAt = Date.now();

  try {
    const auth = requireSession(request, ['owner', 'manager', 'athlete']);
    if (auth.response) return auth.response;

    const supabaseAdmin = createSupabaseAdmin();
    const session = auth.user;
    const usersPromise = readUsers(supabaseAdmin, session);
    const eventsPromise = session.role === 'manager'
      ? readEventsWithFeaturedFallback(
        'eventos do gestor',
        () => supabaseAdmin.from('events').select(PUBLIC_EVENT_SELECT).eq('organizer_id', session.id),
        () => supabaseAdmin.from('events').select(PUBLIC_EVENT_SELECT_LEGACY).eq('organizer_id', session.id)
      )
      : readEventsWithFeaturedFallback(
        'eventos autenticados',
        () => supabaseAdmin.from('events').select(PUBLIC_EVENT_SELECT),
        () => supabaseAdmin.from('events').select(PUBLIC_EVENT_SELECT_LEGACY)
      );

    const [users, events] = await Promise.all([usersPromise, eventsPromise]);
    const eventIds = events.map(event => String(event.id));
    const eventIdFilter = session.role === 'manager' ? eventIds : [];

    const [divisions, workouts] = await Promise.all([
      session.role === 'manager'
        ? scopedRows(eventIdFilter, () => supabaseAdmin
          .from('divisions')
          .select(PUBLIC_DIVISION_SELECT)
          .in('event_id', eventIdFilter), 'divisões do gestor')
        : readBootstrapQuery('divisões autenticadas', supabaseAdmin
          .from('divisions')
          .select(PUBLIC_DIVISION_SELECT)),
      session.role === 'manager'
        ? scopedRows(eventIdFilter, () => supabaseAdmin
          .from('workouts')
          .select(PUBLIC_WORKOUT_SELECT)
          .in('event_id', eventIdFilter), 'workouts do gestor')
        : readBootstrapQuery('workouts autenticados', supabaseAdmin
          .from('workouts')
          .select(PUBLIC_WORKOUT_SELECT))
    ]);

    const divisionIds = divisions.map(division => String(division.id));
    const workoutIds = workouts.map(workout => String(workout.id));

    let athletes: Record<string, unknown>[] = [];
    let scores: Record<string, unknown>[] = [];
    let registrations: Record<string, unknown>[] = [];
    let contestations: Record<string, unknown>[] = [];
    let coupons: Record<string, unknown>[] = [];
    let leaderboardEntries: Record<string, unknown>[] = [];
    let mercadopagoAccounts: Record<string, unknown>[] = [];

    if (session.role === 'owner') {
      [athletes, scores, registrations, contestations, coupons, leaderboardEntries, mercadopagoAccounts] = await Promise.all([
        readBootstrapQuery('atletas do proprietário', supabaseAdmin.from('athletes').select(PRIVATE_ATHLETE_SELECT)),
        readBootstrapQuery('scores do proprietário', supabaseAdmin.from('scores').select(PUBLIC_SCORE_SELECT)),
        readBootstrapQuery('inscrições do proprietário', supabaseAdmin.from('registrations').select(PRIVATE_REGISTRATION_SELECT)),
        readBootstrapQuery('contestações do proprietário', supabaseAdmin.from('contestations').select(PRIVATE_CONTESTATION_SELECT)),
        readBootstrapQuery('cupons do proprietário', supabaseAdmin.from('coupons').select(PRIVATE_COUPON_SELECT)),
        readBootstrapQuery('leaderboard do proprietário', supabaseAdmin.from('leaderboard_entries').select(PUBLIC_LEADERBOARD_ENTRY_SELECT)),
        readBootstrapQuery('contas de pagamento do proprietário', supabaseAdmin
          .from('mercadopago_accounts')
          .select('user_id, public_key')
          .eq('status', 'connected'))
      ]);
    } else if (session.role === 'manager') {
      [athletes, scores, registrations, contestations, coupons, leaderboardEntries, mercadopagoAccounts] = await Promise.all([
        scopedRows(divisionIds, () => supabaseAdmin
          .from('athletes')
          .select(PRIVATE_ATHLETE_SELECT)
          .in('division_id', divisionIds), 'atletas do gestor'),
        scopedRows(workoutIds, () => supabaseAdmin
          .from('scores')
          .select(PUBLIC_SCORE_SELECT)
          .in('workout_id', workoutIds), 'scores do gestor'),
        scopedRows(eventIds, () => supabaseAdmin
          .from('registrations')
          .select(PRIVATE_REGISTRATION_SELECT)
          .in('event_id', eventIds), 'inscrições do gestor'),
        scopedRows(eventIds, () => supabaseAdmin
          .from('contestations')
          .select(PRIVATE_CONTESTATION_SELECT)
          .in('event_id', eventIds), 'contestações do gestor'),
        scopedRows(eventIds, () => supabaseAdmin
          .from('coupons')
          .select(PRIVATE_COUPON_SELECT)
          .in('event_id', eventIds), 'cupons do gestor'),
        scopedRows(eventIds, () => supabaseAdmin
          .from('leaderboard_entries')
          .select(PUBLIC_LEADERBOARD_ENTRY_SELECT)
          .in('event_id', eventIds), 'leaderboard do gestor'),
        readBootstrapQuery('conta de pagamento do gestor', supabaseAdmin
          .from('mercadopago_accounts')
          .select('user_id, public_key')
          .eq('status', 'connected')
          .eq('user_id', session.id))
      ]);
    } else {
      const [ownRegistrations, ownContestations] = await Promise.all([
        readBootstrapQuery('inscrições do atleta', supabaseAdmin
          .from('registrations')
          .select(PRIVATE_REGISTRATION_SELECT)
          .eq('user_id', session.id)),
        readBootstrapQuery('contestações do atleta', supabaseAdmin
          .from('contestations')
          .select(PRIVATE_CONTESTATION_SELECT)
          .eq('user_id', session.id))
      ]);
      registrations = ownRegistrations;
      contestations = ownContestations;

      const ownAthleteIds = [...new Set(ownRegistrations
        .map(registration => registration.athlete_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0))];

      [athletes, scores] = await Promise.all([
        scopedRows(ownAthleteIds, () => supabaseAdmin
          .from('athletes')
          .select(PRIVATE_ATHLETE_SELECT)
          .in('id', ownAthleteIds), 'atletas do atleta'),
        scopedRows(ownAthleteIds, () => supabaseAdmin
          .from('scores')
          .select(PUBLIC_SCORE_SELECT)
          .in('athlete_id', ownAthleteIds), 'scores do atleta')
      ]);
    }

    const mappedUsers = users.map(mapUserForClient);
    const mappedCurrentUser = mappedUsers.find(user => user.id === session.id) || session;
    const sanitizedLeaderboardEntries = leaderboardEntries.map(sanitizeLeaderboardEntry);
    const durationMs = Date.now() - startedAt;

    console.info('[Bootstrap API] Concluído:', JSON.stringify({
      role: session.role,
      durationMs,
      counts: {
        events: events.length,
        divisions: divisions.length,
        workouts: workouts.length,
        athletes: athletes.length,
        scores: scores.length,
        registrations: registrations.length,
        contestations: contestations.length,
        coupons: coupons.length,
        leaderboardEntries: sanitizedLeaderboardEntries.length
      }
    }));

    return NextResponse.json({
      currentUser: mappedCurrentUser,
      users: mappedUsers,
      athletes,
      scores,
      registrations,
      registrationsCount: null,
      contestations,
      coupons,
      events,
      divisions,
      workouts,
      mercadopagoAccounts,
      leaderboardEntries: sanitizedLeaderboardEntries
    });
  } catch (err) {
    console.error('[Bootstrap API] Erro ao carregar dados iniciais:', JSON.stringify({
      durationMs: Date.now() - startedAt,
      message: err instanceof Error ? err.message : 'erro desconhecido'
    }));
    return NextResponse.json({ error: 'Erro ao carregar dados iniciais.' }, { status: 500 });
  }
}
