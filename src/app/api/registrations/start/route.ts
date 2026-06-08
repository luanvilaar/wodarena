import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://momigbtnsswoldqnadmc.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const normalizeEmail = (email: string) => email.trim().toLowerCase();

export async function POST(request: Request) {
  try {
    if (!supabaseServiceKey) {
      console.error('[Registration Start] SUPABASE_SERVICE_ROLE_KEY não configurada no servidor.');
      return NextResponse.json({ error: 'Configuração do servidor ausente.' }, { status: 500 });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });

    const body = await request.json();
    const {
      registrationData,
      athleteProfile,
      password,
      passwordConfirmation,
      paymentMethod,
      initialPaymentStatus
    } = body;

    if (!registrationData || !athleteProfile) {
      return NextResponse.json({ error: 'Dados de inscrição obrigatórios.' }, { status: 400 });
    }

    const email = normalizeEmail(registrationData.athleteEmail || athleteProfile.email || '');
    if (!email || !email.includes('@') || email.includes('nao-informado@wodarena.com')) {
      return NextResponse.json({ error: 'E-mail válido é obrigatório para criar o painel do atleta.' }, { status: 400 });
    }

    if (!password || String(password).length < 6) {
      return NextResponse.json({ error: 'A senha do painel deve ter pelo menos 6 caracteres.' }, { status: 400 });
    }

    if (password !== passwordConfirmation) {
      return NextResponse.json({ error: 'A confirmação de senha não confere.' }, { status: 400 });
    }

    const regId = registrationData.id || `reg-${Date.now()}`;
    let userId = '';

    const { data: existingUser, error: existingUserError } = await supabaseAdmin
      .from('users')
      .select('id, name, email, role, organization')
      .eq('email', email)
      .maybeSingle();

    if (existingUserError) {
      console.error('[Registration Start] Erro ao buscar usuário atleta:', existingUserError);
      return NextResponse.json({ error: 'Erro ao validar usuário do atleta.' }, { status: 500 });
    }

    if (existingUser) {
      if (existingUser.role !== 'athlete') {
        return NextResponse.json({ error: 'Este e-mail já pertence a uma conta administrativa.' }, { status: 409 });
      }
      userId = existingUser.id;
    } else {
      userId = `ath-user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const { error: userError } = await supabaseAdmin
        .from('users')
        .insert({
          id: userId,
          name: registrationData.athleteName,
          email,
          role: 'athlete',
          organization: registrationData.box || 'Atleta WODArena'
        });

      if (userError) {
        console.error('[Registration Start] Erro ao criar usuário atleta:', userError);
        const isRoleConstraintError =
          userError.code === '23514' ||
          String(userError.message || '').includes('users_role_check') ||
          String(userError.details || '').includes('athlete');

        return NextResponse.json({
          error: isRoleConstraintError
            ? 'Banco de dados ainda não aceita o papel de atleta. Aplique a migration da Área do Atleta no Supabase antes de testar o pagamento.'
            : 'Erro ao criar painel do atleta.',
          statusDetail: userError.message,
          code: userError.code
        }, { status: 500 });
      }
    }

    // Verifica se já existe uma inscrição ativa com o mesmo e-mail para o mesmo evento
    const { data: existingRegEvent, error: regCheckError } = await supabaseAdmin
      .from('registrations')
      .select('id, payment_status')
      .eq('event_id', registrationData.eventId)
      .eq('athlete_email', email)
      .not('payment_status', 'eq', 'payment_cancelled')
      .maybeSingle();

    if (regCheckError) {
      console.error('[Registration Start] Erro ao verificar inscrições existentes:', regCheckError);
    }

    if (existingRegEvent) {
      if (existingRegEvent.payment_status === 'payment_failed') {
        return NextResponse.json({
          error: 'Este e-mail já está inscrito neste evento, mas o pagamento anterior não foi processado. Por favor, acesse a Área do Atleta em /admin para regularizar o pagamento.'
        }, { status: 400 });
      }
      return NextResponse.json({
        error: 'Este e-mail já possui uma inscrição ativa para este evento.'
      }, { status: 400 });
    }

    const { error: secretError } = await supabaseAdmin
      .from('users_secrets')
      .upsert({
        user_id: userId,
        password: String(password)
      }, { onConflict: 'user_id' });

    if (secretError) {
      console.error('[Registration Start] Erro ao gravar senha do atleta:', secretError);
      return NextResponse.json({ error: 'Erro ao gravar senha do painel do atleta.' }, { status: 500 });
    }

    let athleteId = athleteProfile.id || `ath-${Date.now()}`;
    const { data: existingAthlete } = await supabaseAdmin
      .from('athletes')
      .select('id')
      .eq('email', email)
      .eq('division_id', registrationData.divisionId)
      .maybeSingle();

    if (existingAthlete) {
      athleteId = existingAthlete.id;
      const { error: athleteUpdateError } = await supabaseAdmin
        .from('athletes')
        .update({
          shirt_size: athleteProfile.shirtSize || null,
          team_members: athleteProfile.teamMembers ? JSON.stringify(athleteProfile.teamMembers) : '[]'
        })
        .eq('id', athleteId);

      if (athleteUpdateError) {
        console.error('[Registration Start] Erro ao atualizar tamanho de camisa do atleta:', athleteUpdateError);
        return NextResponse.json({ error: 'Erro ao atualizar dados do atleta.' }, { status: 500 });
      }
    } else {
      const { error: athleteError } = await supabaseAdmin
        .from('athletes')
        .insert({
          id: athleteId,
          name: registrationData.athleteName,
          box: registrationData.box || 'Independente',
          country: 'BR',
          division_id: registrationData.divisionId,
          birth_date: athleteProfile.birthDate || null,
          gender: athleteProfile.gender || null,
          city: athleteProfile.city || null,
          state: athleteProfile.state || null,
          instagram: athleteProfile.instagram || null,
          photo_url: athleteProfile.photoUrl || null,
          shirt_size: athleteProfile.shirtSize || null,
          email,
          phone: registrationData.athletePhone || athleteProfile.phone || null,
          is_team: athleteProfile.isTeam || false,
          team_members: athleteProfile.teamMembers ? JSON.stringify(athleteProfile.teamMembers) : '[]'
        });

      if (athleteError) {
        console.error('[Registration Start] Erro ao criar atleta:', athleteError);
        return NextResponse.json({ error: 'Erro ao registrar atleta.' }, { status: 500 });
      }
    }

    const paymentStatus = initialPaymentStatus || 'payment_pending';
    const now = new Date().toISOString();
    const registrationPayload = {
      id: regId,
      event_id: registrationData.eventId,
      division_id: registrationData.divisionId,
      user_id: userId,
      athlete_id: athleteId,
      athlete_name: registrationData.athleteName,
      athlete_email: email,
      athlete_phone: registrationData.athletePhone || athleteProfile.phone || 'Não informado',
      box: registrationData.box || 'Independente',
      gender: registrationData.gender,
      ticket_type: registrationData.ticketType,
      ticket_price: Number(registrationData.ticketPrice),
      quantity: Number(registrationData.quantity || 1),
      total_paid: Number(registrationData.totalPaid),
      created_at: registrationData.createdAt || now,
      coupon_code: registrationData.couponCode || null,
      payment_status: paymentStatus,
      payment_method: paymentMethod || null,
      updated_at: now
    };

    const { data: dbRegistration, error: regError } = await supabaseAdmin
      .from('registrations')
      .upsert(registrationPayload, { onConflict: 'id' })
      .select('*')
      .single();

    if (regError || !dbRegistration) {
      console.error('[Registration Start] Erro ao criar inscrição:', regError);
      return NextResponse.json({ error: 'Erro ao registrar inscrição.' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      user: {
        id: userId,
        name: registrationData.athleteName,
        email,
        role: 'athlete',
        organization: registrationData.box || 'Atleta WODArena'
      },
      registrationData: {
        ...registrationData,
        id: regId,
        userId,
        athleteId,
        athleteEmail: email,
        createdAt: dbRegistration.created_at,
        paymentStatus,
        paymentMethod: paymentMethod || undefined,
        updatedAt: dbRegistration.updated_at
      },
      athleteProfile: {
        ...athleteProfile,
        id: athleteId,
        email
      }
    });
  } catch (err) {
    console.error('[Registration Start] Erro crítico:', err);
    return NextResponse.json({ error: 'Erro crítico ao iniciar inscrição.' }, { status: 500 });
  }
}
