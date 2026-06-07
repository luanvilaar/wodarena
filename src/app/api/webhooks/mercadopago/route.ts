import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendRegistrationEmail } from '@/lib/resend';
import { Athlete, Event, Registration, RegistrationPaymentStatus } from '@/types';
import {
  MercadoPagoConfigError,
  resolveMercadoPagoCheckoutConfig
} from '@/lib/mercadopagoServer';

// Inicializa o cliente do Supabase com privilégios de Admin para o servidor
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL || 'https://momigbtnsswoldqnadmc.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const toRegistrationPaymentStatus = (status?: string): RegistrationPaymentStatus => {
  if (status === 'approved') return 'payment_approved';
  if (status === 'in_process') return 'payment_in_review';
  if (status === 'cancelled') return 'payment_cancelled';
  if (status === 'rejected') return 'payment_failed';
  return 'payment_pending';
};

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
    if (!eventId) {
      console.error("[MercadoPago Webhook] event_id ausente na notificação de pagamento.");
      return NextResponse.json({ error: 'Evento obrigatório para processar webhook.' }, { status: 400 });
    }

    const checkoutConfig = await resolveMercadoPagoCheckoutConfig(eventId);
    console.log(`[MercadoPago Webhook] Usando credenciais ${checkoutConfig.source} do organizador ${checkoutConfig.organizerId} para o evento ${eventId}`);

    console.log(`[MercadoPago Webhook] Buscando detalhes do pagamento ${paymentId}...`);
    const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: {
        'Authorization': `Bearer ${checkoutConfig.accessToken}`
      }
    });

    if (!mpResponse.ok) {
      console.error(`[MercadoPago Webhook] Erro ao carregar transação ${paymentId} do Mercado Pago.`);
      return NextResponse.json({ error: 'Erro ao buscar pagamento.' }, { status: 500 });
    }

    const paymentData = await mpResponse.json();
    const { status, metadata } = paymentData;

    console.log(`[MercadoPago Webhook] Pagamento ${paymentId} com status: ${status}`);

    if (metadata?.registration_json) {
      try {
        const { registrationData } = JSON.parse(metadata.registration_json);
        if (registrationData?.id) {
          await supabaseAdmin
            .from('registrations')
            .update({
              payment_status: toRegistrationPaymentStatus(status),
              payment_method: paymentData.payment_method_id || null,
              payment_id: String(paymentData.id),
              payment_status_detail: paymentData.status_detail || null,
              payment_error_message: status === 'rejected' ? 'Pagamento não processado.' : null,
              updated_at: new Date().toISOString()
            })
            .eq('id', registrationData.id);
        }
      } catch (paymentUpdateErr) {
        console.warn('[MercadoPago Webhook] Não foi possível atualizar status da inscrição:', paymentUpdateErr);
      }
    }

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
        .select('id, payment_status, created_at')
        .eq('id', regId)
        .maybeSingle();

      if (existingReg && existingReg.payment_status === 'payment_approved') {
        console.log(`[MercadoPago Webhook] Inscrição ${regId} já existe no banco e está APROVADA. Encerrando webhook.`);
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

      // Insere ou atualiza o ticket de inscrição na tabela 'registrations'
      const { error: regErr } = await supabaseAdmin.from('registrations').upsert({
        id: regId,
        event_id: registrationData.eventId,
        division_id: registrationData.divisionId,
        user_id: registrationData.userId || null,
        athlete_id: athleteId,
        athlete_name: registrationData.athleteName,
        athlete_email: registrationData.athleteEmail,
        athlete_phone: registrationData.athletePhone,
        box: registrationData.box,
        gender: registrationData.gender,
        ticket_type: registrationData.ticketType,
        ticket_price: Number(registrationData.ticketPrice),
        quantity: Number(registrationData.quantity),
        total_paid: Number(registrationData.totalPaid),
        created_at: existingReg?.created_at || registrationData.createdAt || new Date().toISOString(),
        coupon_code: registrationData.couponCode || null,
        payment_status: 'payment_approved',
        payment_method: paymentData.payment_method_id || null,
        payment_id: String(paymentData.id),
        payment_status_detail: paymentData.status_detail || null,
        payment_error_message: null,
        updated_at: new Date().toISOString()
      }, { onConflict: 'id' });

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
          const event: Event = {
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

          const registration: Registration = {
            id: regId,
            eventId: registrationData.eventId,
            divisionId: registrationData.divisionId,
            userId: registrationData.userId || undefined,
            athleteId,
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
            couponCode: registrationData.couponCode || undefined,
            paymentStatus: 'payment_approved',
            paymentMethod: paymentData.payment_method_id || undefined,
            paymentId: String(paymentData.id),
            paymentStatusDetail: paymentData.status_detail || undefined,
            updatedAt: new Date().toISOString()
          };

          const athlete: Athlete = {
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
    if (err instanceof MercadoPagoConfigError) {
      console.error("[MercadoPago Webhook] Erro de configuração:", err.message);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }

    console.error("[MercadoPago Webhook] Erro crítico no processamento:", err);
    return NextResponse.json({ error: 'Erro crítico interno.' }, { status: 500 });
  }
}
