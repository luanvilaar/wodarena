import { NextResponse } from 'next/server';
import { MercadoPagoConfigError, resolveMercadoPagoCheckoutConfig } from '@/lib/mercadopagoServer';
import { createAthleteId } from '@/lib/registrationIds';
import { applyCouponUsageForApprovedRegistration, calculateSecureRegistrationSnapshot, RegistrationAccessError, triggerRegistrationApprovedEmail } from '@/lib/serverCheckout';
import { ManagerAccessError, managerAccessErrorResponse } from '@/lib/serverManagerAccess';
import { checkRateLimit, createRegistrationAccessToken, createSupabaseAdmin, getClientIp, hashPassword, verifyPassword } from '@/lib/serverSecurity';
import { calculateServiceFee } from '@/lib/serviceFee';

const normalizeEmail = (email: string) => email.trim().toLowerCase();

export async function POST(request: Request) {
  try {
    const rateLimited = checkRateLimit({
      key: `registrations-start:${getClientIp(request)}`,
      limit: 10,
      windowMs: 15 * 60 * 1000
    });
    if (rateLimited) return rateLimited;

    const supabaseAdmin = createSupabaseAdmin();

    const body = await request.json();
    const {
      registrationData,
      athleteProfile,
      password,
      passwordConfirmation,
      paymentMethod
    } = body;

    if (!registrationData || !athleteProfile) {
      return NextResponse.json({ error: 'Dados de inscrição obrigatórios.' }, { status: 400 });
    }

    const secureSnapshot = await calculateSecureRegistrationSnapshot(supabaseAdmin, registrationData, athleteProfile);
    const safeRegistrationData = secureSnapshot.registrationData;
    const safeAthleteProfile = secureSnapshot.athleteProfile;
    const checkoutConfig = secureSnapshot.transactionAmount === 0
      ? null
      : await resolveMercadoPagoCheckoutConfig(secureSnapshot.eventId);
    const serviceFee = calculateServiceFee(
      secureSnapshot.transactionAmount,
      checkoutConfig?.serviceFeePercent,
      checkoutConfig?.serviceFeeEnabled,
      checkoutConfig?.serviceFeePayer
    );

    const email = normalizeEmail(String(safeRegistrationData.athleteEmail || safeAthleteProfile.email || ''));
    if (!email || !email.includes('@') || email.includes('nao-informado@wodarena.com')) {
      return NextResponse.json({ error: 'E-mail válido é obrigatório para criar o painel do atleta.' }, { status: 400 });
    }

    if (!password || String(password).length < 6) {
      return NextResponse.json({ error: 'A senha do painel deve ter pelo menos 6 caracteres.' }, { status: 400 });
    }

    if (password !== passwordConfirmation) {
      return NextResponse.json({ error: 'A confirmação de senha não confere.' }, { status: 400 });
    }

    // Gerado no snapshot: o servidor é a única fonte dos identificadores.
    const regId = secureSnapshot.registrationId;
    let userId = '';
    let shouldCreateSecret = false;
    let shouldRehashSecret = false;

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

      const { data: existingSecret, error: existingSecretError } = await supabaseAdmin
        .from('users_secrets')
        .select('password')
        .eq('user_id', userId)
        .maybeSingle<{ password: string }>();

      if (existingSecretError) {
        console.error('[Registration Start] Erro ao validar segredo do atleta existente:', existingSecretError);
        return NextResponse.json({ error: 'Erro ao validar o acesso existente do atleta.' }, { status: 500 });
      }

      if (existingSecret?.password) {
        const passwordCheck = verifyPassword(String(password), existingSecret.password);
        if (!passwordCheck.valid) {
          return NextResponse.json({
            error: 'Este e-mail já possui painel do atleta. Faça login na Área do Atleta ou recupere a senha antes de iniciar uma nova inscrição.'
          }, { status: 409 });
        }
        shouldRehashSecret = passwordCheck.needsRehash;
      } else {
        shouldCreateSecret = true;
      }
    } else {
      userId = `ath-user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const { error: userError } = await supabaseAdmin
        .from('users')
        .insert({
          id: userId,
          name: safeRegistrationData.athleteName,
          email,
          role: 'athlete',
          organization: safeRegistrationData.box || 'Atleta WODArena'
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
            : 'Erro ao criar painel do atleta.'
        }, { status: 500 });
      }

      shouldCreateSecret = true;
    }

    // Verifica se já existe uma inscrição ativa com o mesmo e-mail para o mesmo evento
    const { data: existingRegEvent, error: regCheckError } = await supabaseAdmin
      .from('registrations')
      .select('id, payment_status')
      .eq('event_id', safeRegistrationData.eventId)
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

    if (shouldCreateSecret) {
      const { error: secretError } = await supabaseAdmin
        .from('users_secrets')
        .insert({
          user_id: userId,
          password: hashPassword(String(password))
        });

      if (secretError) {
        console.error('[Registration Start] Erro ao gravar senha do atleta:', secretError);
        return NextResponse.json({ error: 'Erro ao gravar senha do painel do atleta.' }, { status: 500 });
      }
    } else if (shouldRehashSecret) {
      const { error: secretError } = await supabaseAdmin
        .from('users_secrets')
        .update({
          password: hashPassword(String(password))
        })
        .eq('user_id', userId);

      if (secretError) {
        console.error('[Registration Start] Erro ao rehash da senha do atleta:', secretError);
        return NextResponse.json({ error: 'Erro ao atualizar a segurança do painel do atleta.' }, { status: 500 });
      }
    }

    // Atleta novo recebe id gerado aqui; o já cadastrado (mesmo e-mail e
    // categoria) continua com o próprio id.
    let athleteId = createAthleteId();
    const { data: existingAthlete } = await supabaseAdmin
      .from('athletes')
      .select('id')
      .eq('email', email)
      .eq('division_id', safeRegistrationData.divisionId)
      .maybeSingle();

    if (existingAthlete) {
      athleteId = existingAthlete.id;
      const { error: athleteUpdateError } = await supabaseAdmin
        .from('athletes')
        .update({
          shirt_size: safeAthleteProfile.shirtSize || null,
          team_members: safeAthleteProfile.teamMembers ? JSON.stringify(safeAthleteProfile.teamMembers) : '[]'
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
          name: safeRegistrationData.athleteName,
          box: safeRegistrationData.box || 'Independente',
          country: 'BR',
          division_id: safeRegistrationData.divisionId,
          birth_date: safeAthleteProfile.birthDate || null,
          gender: safeAthleteProfile.gender || null,
          city: safeAthleteProfile.city || null,
          state: safeAthleteProfile.state || null,
          instagram: safeAthleteProfile.instagram || null,
          photo_url: safeAthleteProfile.photoUrl || null,
          shirt_size: safeAthleteProfile.shirtSize || null,
          email,
          phone: safeRegistrationData.athletePhone || safeAthleteProfile.phone || null,
          is_team: safeAthleteProfile.isTeam || false,
          team_members: safeAthleteProfile.teamMembers ? JSON.stringify(safeAthleteProfile.teamMembers) : '[]'
        });

      if (athleteError) {
        console.error('[Registration Start] Erro ao criar atleta:', athleteError);
        return NextResponse.json({ error: 'Erro ao registrar atleta.' }, { status: 500 });
      }
    }

    // payment_status nunca é aceito do cliente: só nasce aprovado quando o
    // valor calculado no servidor (cupom 100% incluso) é zero.
    const paymentStatus = secureSnapshot.transactionAmount === 0 ? 'payment_approved' : 'payment_pending';
    // O método 'free' também é decisão do servidor: o navegador pode ter calculado
    // outro total (ex.: o gestor mudou a camisa do evento durante a inscrição).
    const safePaymentMethod = secureSnapshot.transactionAmount === 0
      ? 'free'
      : (paymentMethod === 'free' ? null : paymentMethod || null);
    const now = new Date().toISOString();
    const registrationPayload = {
      id: regId,
      event_id: safeRegistrationData.eventId,
      division_id: safeRegistrationData.divisionId,
      user_id: userId,
      athlete_id: athleteId,
      athlete_name: safeRegistrationData.athleteName,
      athlete_email: email,
      athlete_phone: safeRegistrationData.athletePhone || safeAthleteProfile.phone || 'Não informado',
      box: safeRegistrationData.box || 'Independente',
      gender: safeRegistrationData.gender,
      ticket_type: safeRegistrationData.ticketType,
      ticket_price: Number(safeRegistrationData.ticketPrice),
      quantity: Number(safeRegistrationData.quantity || 1),
      total_paid: Number(safeRegistrationData.totalPaid),
      shirt_addon_count: Number(safeRegistrationData.shirtAddonCount || 0),
      shirt_addon_amount: Number(safeRegistrationData.shirtAddonAmount || 0),
      service_fee_percent: serviceFee.serviceFeePercent,
      service_fee_amount: serviceFee.serviceFeeAmount,
      service_fee_payer: checkoutConfig?.serviceFeePayer ?? null,
      amount_collected: serviceFee.amountCollected,
      application_fee_charged: 0,
      created_at: now,
      coupon_code: safeRegistrationData.couponCode || null,
      payment_status: paymentStatus,
      payment_method: safePaymentMethod,
      updated_at: now
    };

    // Só insere: esta rota cria inscrições e nunca altera uma já existente.
    const { data: dbRegistration, error: regError } = await supabaseAdmin
      .from('registrations')
      .insert(registrationPayload)
      .select('*')
      .single();

    if (regError || !dbRegistration) {
      console.error('[Registration Start] Erro ao criar inscrição:', regError);
      // Conflito de chave (id ou uma inscrição ativa do mesmo e-mail no evento):
      // nada é gravado e a resposta é a da inscrição ativa já existente.
      if (regError?.code === '23505') {
        return NextResponse.json({
          error: 'Este e-mail já possui uma inscrição ativa para este evento.'
        }, { status: 409 });
      }
      return NextResponse.json({ error: 'Erro ao registrar inscrição.' }, { status: 500 });
    }

    // Inscrição gratuita (cupom 100%) já nasce aprovada e não passa pelo Mercado
    // Pago — contabiliza o uso do cupom aqui para não perder a contagem.
    if (paymentStatus === 'payment_approved') {
      await applyCouponUsageForApprovedRegistration(supabaseAdmin, regId);
      // A confirmação sai do servidor (Story 1.76): o navegador não dispara mais o e-mail.
      await triggerRegistrationApprovedEmail(supabaseAdmin, regId).catch(err =>
        console.error('[Registration Start] Erro ao disparar e-mail da inscrição gratuita:', err)
      );
    }

    const registrationAccessToken = createRegistrationAccessToken({
      registrationId: regId,
      eventId: String(safeRegistrationData.eventId),
      userId
    });

    return NextResponse.json({
      success: true,
      user: {
        id: userId,
        name: safeRegistrationData.athleteName,
        email,
        role: 'athlete',
        organization: safeRegistrationData.box || 'Atleta WODArena'
      },
      registrationData: {
        ...safeRegistrationData,
        id: regId,
        userId,
        athleteId,
        athleteEmail: email,
        createdAt: dbRegistration.created_at,
        paymentStatus,
        paymentMethod: safePaymentMethod || undefined,
        updatedAt: dbRegistration.updated_at,
        serviceFeePercent: serviceFee.serviceFeePercent,
        serviceFeeAmount: serviceFee.serviceFeeAmount,
        serviceFeePayer: checkoutConfig?.serviceFeePayer,
        amountCollected: serviceFee.amountCollected,
        applicationFeeCharged: 0,
        accessToken: registrationAccessToken
      },
      athleteProfile: {
        ...safeAthleteProfile,
        id: athleteId,
        email
      }
    });
  } catch (err) {
    if (err instanceof ManagerAccessError) {
      return managerAccessErrorResponse(err);
    }
    if (err instanceof RegistrationAccessError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof MercadoPagoConfigError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[Registration Start] Erro crítico:', err);
    return NextResponse.json({ error: 'Erro crítico ao iniciar inscrição.' }, { status: 500 });
  }
}
