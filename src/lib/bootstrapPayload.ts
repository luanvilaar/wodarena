import { SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AthleteRow = Record<string, any>;

export const PUBLIC_EVENT_SELECT = 'id, name, logo_url, banner_url, status, location, date, description, organizer_id, sponsors, format, ticket_price, ticket_slots, is_ticketing_active, time, city, state, rules, instagram, website, event_type, event_schedule, mp_public_key, marketplace_fee, registration_deadline';
export const PUBLIC_SCORE_SELECT = '*';
export const PUBLIC_DIVISION_SELECT = '*';
export const PUBLIC_WORKOUT_SELECT = '*';

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
    athletesResult,
    scoresResult,
    registrationsCountResult,
    eventsResult,
    divisionsResult,
    workoutsResult,
    mpAccountsResult,
    leaderboardEntriesResult
  ] = await Promise.all([
    supabaseAdmin
      .from('athletes')
      .select('id, name, box, country, division_id, gender, is_team, city, state, instagram, team_members'),
    supabaseAdmin
      .from('scores')
      .select(PUBLIC_SCORE_SELECT),
    supabaseAdmin
      .from('registrations')
      .select('id', { count: 'exact', head: true }),
    supabaseAdmin
      .from('events')
      .select(PUBLIC_EVENT_SELECT),
    supabaseAdmin
      .from('divisions')
      .select(PUBLIC_DIVISION_SELECT),
    supabaseAdmin
      .from('workouts')
      .select(PUBLIC_WORKOUT_SELECT),
    supabaseAdmin
      .from('mercadopago_accounts')
      .select('user_id, public_key')
      .eq('status', 'connected'),
    supabaseAdmin
      .from('leaderboard_entries')
      .select('id, event_id, division_id, athlete_id, athlete_name, box_name, country, gender, is_team, payment_approved_at')
  ]);

  return {
    currentUser: null,
    users: [],
    athletes: (athletesResult.data || []).map(sanitizePublicAthlete),
    scores: scoresResult.data || [],
    registrations: [],
    registrationsCount: registrationsCountResult.count || 0,
    contestations: [],
    coupons: [],
    events: eventsResult.data || [],
    divisions: divisionsResult.data || [],
    workouts: workoutsResult.data || [],
    mercadopagoAccounts: mpAccountsResult.data || [],
    leaderboardEntries: (leaderboardEntriesResult.data || []).map(sanitizeLeaderboardEntry)
  };
};
