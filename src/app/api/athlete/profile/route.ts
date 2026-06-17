import { NextResponse } from 'next/server';
import {
  createSessionToken,
  createSupabaseAdmin,
  getSessionCookieHeader,
  requireSession
} from '@/lib/serverSecurity';

const BIRTH_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const normalizeBirthDate = (value: unknown) => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return null;
  if (!BIRTH_DATE_PATTERN.test(trimmed)) {
    throw new Error('A data de nascimento deve estar no formato YYYY-MM-DD.');
  }

  const parsed = new Date(`${trimmed}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('A data de nascimento informada é inválida.');
  }

  return trimmed;
};

export async function GET(request: Request) {
  try {
    const auth = requireSession(request, ['athlete']);
    if (auth.response) return auth.response;
    const actor = auth.user;
    const supabaseAdmin = createSupabaseAdmin();

    const [{ data: user, error: userError }, { data: registrations, error: registrationsError }] = await Promise.all([
      supabaseAdmin
        .from('users')
        .select('id, name, email, role, organization')
        .eq('id', actor.id)
        .maybeSingle(),
      supabaseAdmin
        .from('registrations')
        .select('id, athlete_id')
        .eq('user_id', actor.id)
        .order('created_at', { ascending: false })
    ]);

    if (userError || !user) {
      return NextResponse.json({ error: 'Usuário do atleta não encontrado.' }, { status: 404 });
    }

    if (registrationsError) {
      throw registrationsError;
    }

    const athleteIds = [...new Set((registrations || []).map(item => item.athlete_id).filter(Boolean))];
    const { data: athleteRows, error: athletesError } = athleteIds.length > 0
      ? await supabaseAdmin
        .from('athletes')
        .select('id, name, birth_date, email')
        .in('id', athleteIds)
      : { data: [], error: null };

    if (athletesError) {
      throw athletesError;
    }

    const birthDate = (athleteRows || []).find(item => item.birth_date)?.birth_date || null;

    return NextResponse.json({
      success: true,
      user,
      profile: {
        fullName: user.name,
        email: user.email,
        birthDate
      }
    });
  } catch (err) {
    console.error('[API Athlete Profile] Erro ao carregar perfil do atleta:', err);
    return NextResponse.json({ error: 'Erro ao carregar perfil do atleta.' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = requireSession(request, ['athlete']);
    if (auth.response) return auth.response;
    const actor = auth.user;
    const body = await request.json();

    const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
    if (fullName.length < 3) {
      return NextResponse.json({ error: 'Informe um nome completo válido.' }, { status: 400 });
    }

    let birthDate: string | null = null;
    try {
      birthDate = normalizeBirthDate(body.birthDate);
    } catch (validationError) {
      return NextResponse.json({ error: validationError instanceof Error ? validationError.message : 'Data de nascimento inválida.' }, { status: 400 });
    }
    const supabaseAdmin = createSupabaseAdmin();

    const { data: ownedRegistrations, error: registrationsError } = await supabaseAdmin
      .from('registrations')
      .select('id, athlete_id')
      .eq('user_id', actor.id);

    if (registrationsError) {
      throw registrationsError;
    }

    const athleteIds = [...new Set((ownedRegistrations || []).map(item => item.athlete_id).filter(Boolean))];

    const [{ data: updatedUser, error: userUpdateError }, registrationUpdateResult, athleteUpdateResult] = await Promise.all([
      supabaseAdmin
        .from('users')
        .update({ name: fullName })
        .eq('id', actor.id)
        .select('id, name, email, role, organization')
        .maybeSingle(),
      supabaseAdmin
        .from('registrations')
        .update({ athlete_name: fullName })
        .eq('user_id', actor.id)
        .select('*'),
      athleteIds.length > 0
        ? supabaseAdmin
          .from('athletes')
          .update({
            name: fullName,
            birth_date: birthDate
          })
          .in('id', athleteIds)
          .select('*')
        : Promise.resolve({ data: [], error: null })
    ]);

    if (userUpdateError || !updatedUser) {
      throw userUpdateError || new Error('Falha ao atualizar o usuário do atleta.');
    }

    if (registrationUpdateResult.error) {
      throw registrationUpdateResult.error;
    }

    if (athleteUpdateResult.error) {
      throw athleteUpdateResult.error;
    }

    const nextSessionUser = {
      id: updatedUser.id,
      name: updatedUser.name,
      email: updatedUser.email,
      role: updatedUser.role,
      organization: updatedUser.organization || undefined
    };

    const response = NextResponse.json({
      success: true,
      user: nextSessionUser,
      athletes: athleteUpdateResult.data || [],
      registrations: registrationUpdateResult.data || []
    });
    response.headers.set('Set-Cookie', getSessionCookieHeader(createSessionToken(nextSessionUser)));
    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao atualizar perfil do atleta.';
    console.error('[API Athlete Profile] Erro ao atualizar perfil do atleta:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
