import { SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AthleteRow = Record<string, any>;

export const PUBLIC_EVENT_SELECT_LEGACY = 'id, name, logo_url, banner_url, status, location, date, description, organizer_id, sponsors, format, ticket_price, ticket_slots, is_ticketing_active, time, city, state, rules, instagram, website, event_type, event_schedule, mp_public_key, marketplace_fee, registration_deadline';
export const PUBLIC_EVENT_SELECT = 'id, name, logo_url, banner_url, status, location, date, description, organizer_id, sponsors, format, ticket_price, ticket_slots, is_ticketing_active, is_featured, time, city, state, rules, instagram, website, event_type, event_schedule, mp_public_key, marketplace_fee, registration_deadline';
export const PUBLIC_ATHLETE_SELECT = 'id, name, box, country, division_id, gender, is_team, city, state, instagram, team_members';
export const PUBLIC_SCORE_SELECT = 'athlete_id, workout_id, result, value, rank, points, splits';
export const PUBLIC_DIVISION_SELECT = 'id, event_id, name, category, type, slots_limit, price, is_active, order_index, use_age_groups, age_groups, course_layout, is_course_published';
export const PUBLIC_WORKOUT_SELECT = 'id, event_id, name, description, type, time_cap, code, order_index, division_id, tie_breaker';
export const PUBLIC_LEADERBOARD_ENTRY_SELECT = 'id, event_id, division_id, athlete_id, athlete_name, box_name, country, gender, is_team, payment_approved_at';

type BootstrapQueryResult<T> = {
  data: T | null;
  error: { message?: string; code?: string } | null;
};

const hasMissingFeaturedColumnError = (error: BootstrapQueryResult<unknown>['error']) => (
  Boolean(error)
  && (error?.code === '42703' || error?.code === 'PGRST204')
  && String(error?.message || '').includes('is_featured')
);

const withDefaultFeaturedFlag = <T>(rows: T): T => {
  if (Array.isArray(rows)) {
    return rows.map((row) => ({ ...row, is_featured: false })) as T;
  }
  if (rows && typeof rows === 'object') {
    return { ...rows, is_featured: false };
  }
  return rows;
};

export const readBootstrapQuery = async <T>(
  label: string,
  query: PromiseLike<BootstrapQueryResult<T>>
): Promise<T> => {
  const startedAt = Date.now();
  const result = await query;
  const durationMs = Date.now() - startedAt;

  if (result.error) {
    console.error('[Bootstrap Query] Falha:', JSON.stringify({
      label,
      durationMs,
      code: result.error.code,
      message: result.error.message
    }));
    throw new Error(`Falha ao carregar ${label}.`);
  }

  const rowCount = Array.isArray(result.data) ? result.data.length : result.data ? 1 : 0;
  console.info('[Bootstrap Query] Concluída:', JSON.stringify({ label, durationMs, rowCount }));
  return result.data as T;
};

export const readEventsWithFeaturedFallback = async <T>(
  label: string,
  primaryQuery: () => PromiseLike<BootstrapQueryResult<T>>,
  legacyQuery: () => PromiseLike<BootstrapQueryResult<T>>
): Promise<T> => {
  const result = await primaryQuery();

  if (hasMissingFeaturedColumnError(result.error)) {
    console.warn('[Bootstrap Query] Campo is_featured ausente, usando fallback legado:', JSON.stringify({ label }));
    const legacyRows = await readBootstrapQuery(label, legacyQuery());
    return withDefaultFeaturedFlag(legacyRows);
  }

  return readBootstrapQuery(label, Promise.resolve(result));
};

export const sanitizeNamePII = (name: unknown): string => {
  if (typeof name !== 'string') return '';

  let clean = name;
  clean = clean.replace(/\b\d{8,11}\b/g, '');
  clean = clean.replace(/\(?\d{2}\)?\s?\d{4,5}[-\s]?\d{4}/g, '');
  clean = clean.replace(/\b\d{4,5}[-\s]?\d{4}\b/g, '');
  clean = clean.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '');
  clean = clean.replace(/[\s\-\/\,\:\(]+$/, '');
  clean = clean.replace(/^[\s\-\/\,\:\)]+/, '');
  clean = clean.replace(/[\-\/\,\:]\s*[\-\/\,\:]/g, ' ');
  clean = clean.replace(/\(\s*\)/g, '');
  clean = clean.replace(/\[\s*\]/g, '');
  clean = clean.replace(/\s+/g, ' ');
  clean = clean.replace(/[\s\-\/\,\:\(]+$/, '');

  return clean.trim();
};

// Integrantes da equipe são expostos publicamente (tela de detalhes da equipe),
// mas os nomes passam por sanitizeNamePII para remover telefones/e-mails embutidos.
// E-mail/telefone individuais e demais PII do atleta seguem fora do payload público.
const sanitizePublicTeamMembers = (raw: unknown) => {
  let members: AthleteRow[] = [];
  if (typeof raw === 'string') {
    try {
      members = JSON.parse(raw);
    } catch {
      members = [];
    }
  } else if (Array.isArray(raw)) {
    members = raw;
  }
  if (!Array.isArray(members)) return [];
  return members.map((member) => ({
    name: sanitizeNamePII(member?.name),
    instagram: member?.instagram ?? '',
    shirtSize: member?.shirtSize
  }));
};

export const sanitizePublicAthlete = (athlete: AthleteRow) => ({
  id: athlete.id,
  name: sanitizeNamePII(athlete.name),
  box: athlete.box,
  country: athlete.country,
  division_id: athlete.division_id,
  gender: athlete.gender,
  is_team: athlete.is_team,
  city: athlete.city,
  state: athlete.state,
  instagram: athlete.instagram,
  team_members: sanitizePublicTeamMembers(athlete.team_members)
});

export const sanitizeLeaderboardEntry = (entry: Record<string, unknown>) => ({
  id: entry.id,
  event_id: entry.event_id,
  division_id: entry.division_id,
  athlete_id: entry.athlete_id,
  athlete_name: sanitizeNamePII(entry.athlete_name),
  box_name: entry.box_name,
  country: entry.country,
  gender: entry.gender,
  is_team: entry.is_team,
  payment_approved_at: entry.payment_approved_at
});

export const buildPublicBootstrapPayload = async (supabaseAdmin: SupabaseClient) => {
  const [
    eventsResult,
    divisionsResult,
    workoutsResult,
    mpAccountsResult
  ] = await Promise.all([
    readEventsWithFeaturedFallback(
      'eventos públicos',
      () => supabaseAdmin.from('events').select(PUBLIC_EVENT_SELECT),
      () => supabaseAdmin.from('events').select(PUBLIC_EVENT_SELECT_LEGACY)
    ),
    readBootstrapQuery('divisões públicas', supabaseAdmin
      .from('divisions')
      .select(PUBLIC_DIVISION_SELECT)),
    readBootstrapQuery('workouts públicos', supabaseAdmin
      .from('workouts')
      .select(PUBLIC_WORKOUT_SELECT)),
    readBootstrapQuery('contas públicas de pagamento', supabaseAdmin
      .from('mercadopago_accounts')
      .select('user_id, public_key')
      .eq('status', 'connected'))
  ]);

  return {
    currentUser: null,
    users: [],
    athletes: [],
    scores: [],
    registrations: [],
    registrationsCount: null,
    contestations: [],
    coupons: [],
    events: eventsResult,
    divisions: divisionsResult,
    workouts: workoutsResult,
    mercadopagoAccounts: mpAccountsResult,
    leaderboardEntries: []
  };
};

export const buildPublicEventBootstrapPayload = async (
  supabaseAdmin: SupabaseClient,
  eventId: string
) => {
  const [event, divisions, workouts] = await Promise.all([
    readEventsWithFeaturedFallback(
      'evento público',
      () => supabaseAdmin.from('events').select(PUBLIC_EVENT_SELECT).eq('id', eventId).maybeSingle(),
      () => supabaseAdmin.from('events').select(PUBLIC_EVENT_SELECT_LEGACY).eq('id', eventId).maybeSingle()
    ),
    readBootstrapQuery('divisões do evento', supabaseAdmin
      .from('divisions')
      .select(PUBLIC_DIVISION_SELECT)
      .eq('event_id', eventId)),
    readBootstrapQuery('workouts do evento', supabaseAdmin
      .from('workouts')
      .select(PUBLIC_WORKOUT_SELECT)
      .eq('event_id', eventId))
  ]);

  if (!event) return null;

  const divisionIds = divisions.map((division) => division.id);
  const workoutIds = workouts.map((workout) => workout.id);
  const [athletes, scores, leaderboardEntries] = await Promise.all([
    divisionIds.length > 0
      ? readBootstrapQuery('atletas do evento', supabaseAdmin
        .from('athletes')
        .select(PUBLIC_ATHLETE_SELECT)
        .in('division_id', divisionIds))
      : Promise.resolve([]),
    workoutIds.length > 0
      ? readBootstrapQuery('scores do evento', supabaseAdmin
        .from('scores')
        .select(PUBLIC_SCORE_SELECT)
        .in('workout_id', workoutIds))
      : Promise.resolve([]),
    readBootstrapQuery('leaderboard do evento', supabaseAdmin
      .from('leaderboard_entries')
      .select(PUBLIC_LEADERBOARD_ENTRY_SELECT)
      .eq('event_id', eventId))
  ]);

  return {
    currentUser: null,
    users: [],
    athletes: athletes.map(sanitizePublicAthlete),
    scores,
    registrations: [],
    registrationsCount: null,
    contestations: [],
    coupons: [],
    events: [event],
    divisions,
    workouts,
    mercadopagoAccounts: [],
    leaderboardEntries: leaderboardEntries.map(sanitizeLeaderboardEntry)
  };
};
