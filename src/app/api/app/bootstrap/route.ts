import { NextResponse } from 'next/server';
import { createSupabaseAdmin, getRequestSession } from '@/lib/serverSecurity';
import { mapContestationFromDb } from '@/lib/contestations';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AthleteRow = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RegistrationRow = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ContestationRow = Record<string, any>;

const sanitizePublicAthlete = (athlete: AthleteRow) => ({
  id: athlete.id,
  name: athlete.name,
  box: athlete.box,
  country: athlete.country,
  division_id: athlete.division_id,
  birth_date: athlete.birth_date,
  gender: athlete.gender,
  city: athlete.city,
  state: athlete.state,
  instagram: athlete.instagram,
  photo_url: athlete.photo_url,
  is_team: athlete.is_team,
  team_members: athlete.team_members
});

// Sanitizar dados de registration para uso público
// Remove informações sensíveis: email, phone, payment_id, coupon_code, etc
const sanitizePublicRegistration = (reg: RegistrationRow) => ({
  id: String(reg.id),
  athlete_id: reg.athlete_id ? String(reg.athlete_id) : null,
  event_id: String(reg.event_id),
  division_id: String(reg.division_id),
  payment_status: String(reg.payment_status)
  // ❌ NÃO incluir: athlete_email, athlete_phone, payment_id, payment_method, coupon_code, total_paid, etc
});

export async function GET(request: Request) {
  try {
    const supabaseAdmin = createSupabaseAdmin();
    const session = getRequestSession(request);

    const [
      usersResult,
      athletesResult,
      scoresResult,
      registrationsResult,
      contestationsResult,
      couponsResult,
      eventsResult,
      divisionsResult,
      workoutsResult,
      mpAccountsResult,
      leaderboardEntriesResult
    ] = await Promise.all([
      session?.role === 'owner'
        ? supabaseAdmin.from('users').select('id, name, email, role, organization')
        : session
          ? supabaseAdmin.from('users').select('id, name, email, role, organization').eq('id', session.id)
          : Promise.resolve({ data: [] }),
      supabaseAdmin.from('athletes').select('*'),
      supabaseAdmin.from('scores').select('*'),
      supabaseAdmin.from('registrations').select('*'),
      session ? supabaseAdmin.from('contestations').select('*') : Promise.resolve({ data: [] }),
      session ? supabaseAdmin.from('coupons').select('*') : Promise.resolve({ data: [] }),
      supabaseAdmin
        .from('events')
        .select('id, name, logo_url, banner_url, status, location, date, description, organizer_id, sponsors, format, ticket_price, ticket_slots, is_ticketing_active, time, city, state, rules, instagram, website, event_type, event_schedule, mp_public_key, marketplace_fee'),
      supabaseAdmin.from('divisions').select('*'),
      supabaseAdmin.from('workouts').select('*'),
      supabaseAdmin
        .from('mercadopago_accounts')
        .select('user_id, public_key')
        .eq('status', 'connected'),
      supabaseAdmin.from('leaderboard_entries').select('*')
    ]);

    if (session?.role === 'manager') {
      const eventIds = new Set((eventsResult.data || [])
        .filter(event => event.organizer_id === session.id)
        .map(event => event.id));
      return NextResponse.json({
        currentUser: session,
        users: usersResult.data || [],
        athletes: (athletesResult.data || []).filter(athlete => (divisionsResult.data || []).some(division => division.id === athlete.division_id && eventIds.has(division.event_id))),
        scores: scoresResult.data || [],
        registrations: (registrationsResult.data || []).filter(registration => eventIds.has(registration.event_id)),
        contestations: (contestationsResult.data || []).filter(contestation => eventIds.has(contestation.event_id)),
        coupons: (couponsResult.data || []).filter(coupon => eventIds.has(coupon.event_id)),
        events: eventsResult.data || [],
        divisions: divisionsResult.data || [],
        workouts: workoutsResult.data || [],
        mercadopagoAccounts: mpAccountsResult.data || [],
        leaderboardEntries: leaderboardEntriesResult.data || []
      });
    }

    if (session?.role === 'athlete') {
      const ownRegistrations = (registrationsResult.data || []).filter(registration => registration.user_id === session.id);
      const ownAthleteIds = new Set(ownRegistrations.map(registration => registration.athlete_id));
      const ownContestationIds = new Set(
        (contestationsResult.data || [])
          .map(mapContestationFromDb)
          .filter(contestation => contestation.userId === session.id)
          .map(contestation => contestation.id)
      );
      return NextResponse.json({
        currentUser: session,
        users: usersResult.data || [],
        athletes: (athletesResult.data || []).map(athlete => ownAthleteIds.has(athlete.id) ? athlete : sanitizePublicAthlete(athlete)),
        scores: scoresResult.data || [],
        registrations: ownRegistrations,
        contestations: (contestationsResult.data || []).filter((contestation: ContestationRow) => ownContestationIds.has(String(contestation.id))),
        coupons: [],
        events: eventsResult.data || [],
        divisions: divisionsResult.data || [],
        workouts: workoutsResult.data || [],
        mercadopagoAccounts: mpAccountsResult.data || [],
        leaderboardEntries: leaderboardEntriesResult.data || []
      });
    }

    return NextResponse.json({
      currentUser: session || null,
      users: usersResult.data || [],
      athletes: (athletesResult.data || []).map(sanitizePublicAthlete),
      scores: scoresResult.data || [],
      registrations: !session
        ? (registrationsResult.data || []).map(sanitizePublicRegistration)
        : registrationsResult.data || [],
      contestations: session ? contestationsResult.data || [] : [],
      coupons: couponsResult.data || [],
      events: eventsResult.data || [],
      divisions: divisionsResult.data || [],
      workouts: workoutsResult.data || [],
      mercadopagoAccounts: mpAccountsResult.data || [],
      leaderboardEntries: leaderboardEntriesResult.data || []
    });
  } catch (err) {
    console.error('[Bootstrap API] Erro ao carregar dados iniciais:', err);
    return NextResponse.json({ error: 'Erro ao carregar dados iniciais.' }, { status: 500 });
  }
}
