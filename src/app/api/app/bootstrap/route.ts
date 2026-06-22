import { NextResponse } from 'next/server';
import { getManagerAccessStatus, normalizeServiceValidUntil } from '@/lib/managerAccess';
import { PUBLIC_EVENT_SELECT, sanitizeLeaderboardEntry, sanitizePublicAthlete } from '@/lib/bootstrapPayload';
import { createSupabaseAdmin, requireSession } from '@/lib/serverSecurity';
import { mapContestationFromDb } from '@/lib/contestations';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ContestationRow = Record<string, any>;

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

export async function GET(request: Request) {
  try {
    const auth = requireSession(request, ['owner', 'manager', 'athlete']);
    if (auth.response) return auth.response;

    const supabaseAdmin = createSupabaseAdmin();
    const session = auth.user;

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
        ? supabaseAdmin.from('users').select('id, name, email, role, organization, service_valid_until')
        : supabaseAdmin.from('users').select('id, name, email, role, organization, service_valid_until').eq('id', session.id),
      supabaseAdmin.from('athletes').select('*'),
      supabaseAdmin.from('scores').select('*'),
      supabaseAdmin.from('registrations').select('*'),
      supabaseAdmin.from('contestations').select('*'),
      supabaseAdmin.from('coupons').select('*'),
      supabaseAdmin
        .from('events')
        .select(PUBLIC_EVENT_SELECT),
      supabaseAdmin.from('divisions').select('*'),
      supabaseAdmin.from('workouts').select('*'),
      supabaseAdmin
        .from('mercadopago_accounts')
        .select('user_id, public_key')
        .eq('status', 'connected'),
      supabaseAdmin.from('leaderboard_entries').select('*')
    ]);

    const mappedUsers = (usersResult.data || []).map(mapUserForClient);
    const mappedCurrentUser = session
      ? mappedUsers.find(user => user.id === session.id) || session
      : null;
    const sanitizedLeaderboardEntries = (leaderboardEntriesResult.data || []).map(sanitizeLeaderboardEntry);

    if (session?.role === 'manager') {
      const eventIds = new Set((eventsResult.data || [])
        .filter(event => event.organizer_id === session.id)
        .map(event => event.id));
      return NextResponse.json({
        currentUser: mappedCurrentUser,
        users: mappedUsers,
        athletes: (athletesResult.data || []).filter(athlete => (divisionsResult.data || []).some(division => division.id === athlete.division_id && eventIds.has(division.event_id))),
        scores: scoresResult.data || [],
        registrations: (registrationsResult.data || []).filter(registration => eventIds.has(registration.event_id)),
        contestations: (contestationsResult.data || []).filter(contestation => eventIds.has(contestation.event_id)),
        coupons: (couponsResult.data || []).filter(coupon => eventIds.has(coupon.event_id)),
        events: eventsResult.data || [],
        divisions: divisionsResult.data || [],
        workouts: workoutsResult.data || [],
        mercadopagoAccounts: mpAccountsResult.data || [],
        leaderboardEntries: sanitizedLeaderboardEntries
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
        currentUser: mappedCurrentUser,
        users: mappedUsers,
        athletes: (athletesResult.data || []).map(athlete => ownAthleteIds.has(athlete.id) ? athlete : sanitizePublicAthlete(athlete)),
        scores: scoresResult.data || [],
        registrations: ownRegistrations,
        contestations: (contestationsResult.data || []).filter((contestation: ContestationRow) => ownContestationIds.has(String(contestation.id))),
        coupons: [],
        events: eventsResult.data || [],
        divisions: divisionsResult.data || [],
        workouts: workoutsResult.data || [],
        mercadopagoAccounts: mpAccountsResult.data || [],
        leaderboardEntries: sanitizedLeaderboardEntries
      });
    }

    return NextResponse.json({
      currentUser: mappedCurrentUser,
      users: mappedUsers,
      athletes: athletesResult.data || [],
      scores: scoresResult.data || [],
      registrations: registrationsResult.data || [],
      registrationsCount: null,
      contestations: contestationsResult.data || [],
      coupons: couponsResult.data || [],
      events: eventsResult.data || [],
      divisions: divisionsResult.data || [],
      workouts: workoutsResult.data || [],
      mercadopagoAccounts: mpAccountsResult.data || [],
      leaderboardEntries: sanitizedLeaderboardEntries
    });
  } catch (err) {
    console.error('[Bootstrap API] Erro ao carregar dados iniciais:', err);
    return NextResponse.json({ error: 'Erro ao carregar dados iniciais.' }, { status: 500 });
  }
}
