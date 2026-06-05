import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendRegistrationEmail } from '@/lib/resend';

// Inicializa o cliente do Supabase com privilégios de Admin para o servidor
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL || 'https://momigbtnsswoldqnadmc.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const topic = searchParams.get('topic');
    const id = searchParams.get('id') || searchParams.get('data.id');

    let paymentId = id;
    let type = topic;

    // Tenta obter o ID do pagamento a partir do body (formato JSON do webhook)
    try {
      const body = await request.json();
      if (body.data && body.data.id) {
        paymentId = body.data.id;
      }
      if (body.type) {
        type = body.type;
      }
    } catch {
      // Body vazio ou não JSON
    }

    if (!paymentId || (type && type !== 'payment')) {
      // Notificação recebida, mas não é do tipo pagamento (ex: teste ou plano), retorna 200 OK
      return NextResponse.json({ received: true });
    }

    const eventId = searchParams.get('event_id');
    let accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
    if (eventId) {
      try {
        const { data: dbEvent } = await supabaseAdmin
          .from('events')
          .select('organizer_id, mp_access_token')
          .eq('id', eventId)
          .single();

        if (dbEvent) {
          // 1. Tenta obter o Access Token do Gestor conectado via OAuth
          const { data: mpAccount } = await supabaseAdmin
            .from('mercadopago_accounts')
            .select('access_token')
            .eq('user_id', dbEvent.organizer_id)
            .eq('status', 'connected')
            .maybeSingle();

          if (mpAccount?.access_token) {
            accessToken = mpAccount.access_token;
            console.log(`[MercadoPago Webhook] Usando Access Token OAuth do organizador ${dbEvent.organizer_id} para o evento ${eventId}`);
          } else if (dbEvent.mp_access_token) {
            // Fallback de compatibilidade caso o evento ainda use o token legado do evento
            accessToken = dbEvent.mp_access_token;
            console.log(`[MercadoPago Webhook] Usando Access Token legado para o evento ${eventId}`);
          }
        }
      } catch (err) {
        console.warn("[MercadoPago Webhook] Erro ao buscar credenciais customizadas/OAuth:", err);
      }
    }

    if (!accessToken) {
      console.error("[MercadoPago Webhook] ACCESS_TOKEN não configurado");
      return NextResponse.json({ error: 'Configuração do gateway pendente.' }, { status: 500 });
    }

    console.log(`[MercadoPago Webhook] Buscando detalhes do pagamento ${paymentId}...`);
    const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    if (!mpResponse.ok) {
      console.error(`[MercadoPago Webhook] Erro ao carregar transação ${paymentId} do Mercado Pago.`);
      return NextResponse.json({ error: 'Erro ao buscar pagamento.' }, { status: 500 });
    }

    const paymentData = await mpResponse.json();
    const { status, metadata } = paymentData;

    console.log(`[MercadoPago Webhook] Pagamento ${paymentId} com status: ${status}`);

    if (status === 'approved' && metadata && metadata.registration_json) {
      const { registrationData, athleteProfile } = JSON.parse(metadata.registration_json);

      if (!registrationData || !athleteProfile) {
        console.error("[MercadoPago Webhook] Dados de inscrição no metadado inválidos.");
        return NextResponse.json({ error: 'Metadados inválidos.' }, { status: 400 });
      }

      const regId = registrationData.id || `reg-${Date.now()}`;
      const athleteId = athleteProfile.id || `ath-${Date.now()}`;

      // Evita duplicação caso o webhook seja disparado mais de uma vez para o mesmo pagamento
      const { data: existingReg } = await supabaseAdmin
        .from('registrations')
        .select('id')
        .eq('id', regId)
        .maybeSingle();

      if (existingReg) {
        console.log(`[MercadoPago Webhook] Inscrição ${regId} já existe no banco. Encerrando webhook.`);
        return NextResponse.json({ received: true, message: 'Inscrição já processada.' });
      }

      console.log(`[MercadoPago Webhook] Gravando inscrição ${regId} no Supabase...`);

      // Verifica se o atleta já está no banco de dados para evitar duplicidade
      const { data: existingAthlete } = await supabaseAdmin
        .from('athletes')
        .select('id')
        .eq('name', registrationData.athleteName)
        .eq('division_id', registrationData.divisionId)
        .maybeSingle();

      if (!existingAthlete) {
        const teamMembersStr = athleteProfile.teamMembers 
          ? JSON.stringify(athleteProfile.teamMembers) 
          : '[]';

        const { error: athleteErr } = await supabaseAdmin.from('athletes').insert({
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
          email: athleteProfile.email || null,
          phone: athleteProfile.phone || null,
          is_team: athleteProfile.isTeam || false,
          team_members: teamMembersStr
        });

        if (athleteErr) {
          console.error("[MercadoPago Webhook] Erro ao cadastrar atleta no banco:", athleteErr);
        } else {
          console.log(`[MercadoPago Webhook] Atleta ${athleteId} cadastrado com sucesso.`);
        }
      }

      // Insere o ticket de inscrição na tabela 'registrations'
      const { error: regErr } = await supabaseAdmin.from('registrations').insert({
        id: regId,
        event_id: registrationData.eventId,
        division_id: registrationData.divisionId,
        athlete_name: registrationData.athleteName,
        athlete_email: registrationData.athleteEmail,
        athlete_phone: registrationData.athletePhone,
        box: registrationData.box,
        gender: registrationData.gender,
        ticket_type: registrationData.ticketType,
        ticket_price: Number(registrationData.ticketPrice),
        quantity: Number(registrationData.quantity),
        total_paid: Number(registrationData.totalPaid),
        created_at: new Date().toISOString(),
        coupon_code: registrationData.couponCode || null
      });

      if (regErr) {
        console.error("[MercadoPago Webhook] Erro ao cadastrar inscrição no banco:", regErr);
        return NextResponse.json({ error: 'Erro ao persistir inscrição.' }, { status: 500 });
      }

      // Incrementa uso do cupom se aplicável
      if (registrationData.couponCode) {
        const { data: couponData } = await supabaseAdmin
          .from('coupons')
          .select('id, usage_count')
          .eq('event_id', registrationData.eventId)
          .eq('code', registrationData.couponCode.toUpperCase())
          .maybeSingle();

        if (couponData) {
          await supabaseAdmin
            .from('coupons')
            .update({ usage_count: (couponData.usage_count || 0) + 1 })
            .eq('id', couponData.id);
        }
      }

      console.log(`[MercadoPago Webhook] Transação aprovada e inscrição registrada com sucesso!`);

      // Disparar envio de e-mail de confirmação via Resend em background
      try {
        const { data: dbEvent } = await supabaseAdmin
          .from('events')
          .select('*')
          .eq('id', registrationData.eventId)
          .maybeSingle();

        if (dbEvent) {
          const event = {
            id: dbEvent.id,
            name: dbEvent.name,
            logoUrl: dbEvent.logo_url,
            bannerUrl: dbEvent.banner_url,
            status: dbEvent.status,
            location: dbEvent.location,
            date: dbEvent.date,
            description: dbEvent.description,
            organizerId: dbEvent.organizer_id,
            sponsors: dbEvent.sponsors || [],
            divisions: [],
            workouts: [],
            format: dbEvent.format || 'individual',
            ticketPrice: dbEvent.ticket_price,
            ticketSlots: dbEvent.ticket_slots,
            isTicketingActive: dbEvent.is_ticketing_active,
            time: dbEvent.time || '',
            city: dbEvent.city || '',
            state: dbEvent.state || '',
            rules: dbEvent.rules || '',
            instagram: dbEvent.instagram || '',
            website: dbEvent.website || '',
            eventType: dbEvent.event_type || 'functional_fitness'
          };

          const registration = {
            id: regId,
            eventId: registrationData.eventId,
            divisionId: registrationData.divisionId,
            athleteName: registrationData.athleteName,
            athleteEmail: registrationData.athleteEmail,
            athletePhone: registrationData.athletePhone,
            box: registrationData.box,
            gender: registrationData.gender,
            ticketType: registrationData.ticketType,
            ticketPrice: Number(registrationData.ticketPrice),
            quantity: Number(registrationData.quantity),
            totalPaid: Number(registrationData.totalPaid),
            createdAt: new Date().toISOString(),
            couponCode: registrationData.couponCode || undefined
          };

          const athlete = {
            id: athleteId,
            name: registrationData.athleteName,
            box: athleteProfile.box || 'Independente',
            country: 'BR',
            divisionId: registrationData.divisionId,
            birthDate: athleteProfile.birthDate || '',
            gender: athleteProfile.gender || undefined,
            city: athleteProfile.city || '',
            state: athleteProfile.state || '',
            instagram: athleteProfile.instagram || '',
            photoUrl: athleteProfile.photoUrl || '',
            email: athleteProfile.email || registrationData.athleteEmail,
            phone: athleteProfile.phone || registrationData.athletePhone,
            isTeam: athleteProfile.isTeam || false,
            teamMembers: athleteProfile.teamMembers || []
          };

          sendRegistrationEmail(registration, athlete, event, metadata.payer_cpf || '')
            .then(res => {
              if (res.success) {
                console.log(`[MercadoPago Webhook] E-mail de confirmação enviado para ${athlete.email}`);
              } else {
                console.warn(`[MercadoPago Webhook] Falha ao enviar e-mail de confirmação:`, res.error);
              }
            })
            .catch(err => console.error('[MercadoPago Webhook] Erro assíncrono ao disparar e-mail:', err));
        }
      } catch (emailErr) {
        console.error("[MercadoPago Webhook] Erro ao preparar envio de e-mail:", emailErr);
      }
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("[MercadoPago Webhook] Erro crítico no processamento:", err);
    return NextResponse.json({ error: 'Erro crítico interno.' }, { status: 500 });
  }
}
