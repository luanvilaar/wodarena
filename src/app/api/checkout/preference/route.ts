import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { registrationData, athleteProfile, origin } = body;

    if (!registrationData || !athleteProfile || !origin) {
      return NextResponse.json({ error: 'Parâmetros inválidos.' }, { status: 400 });
    }

    let accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
    let marketplaceFee = Number(process.env.WODARENA_MARKETPLACE_FEE_DEFAULT || '10');

    if (registrationData.eventId) {
      try {
        const { data: dbEvent } = await supabase
          .from('events')
          .select('organizer_id, marketplace_fee, mp_access_token')
          .eq('id', registrationData.eventId)
          .single();

        if (dbEvent) {
          // 1. Tenta carregar a credencial da conta conectada via OAuth do Gestor
          const { data: mpSecret } = await supabase
            .from('mercadopago_secrets')
            .select('access_token')
            .eq('user_id', dbEvent.organizer_id)
            .maybeSingle();

          if (mpSecret?.access_token) {
            accessToken = mpSecret.access_token;
            console.log(`[MercadoPago Preference API] Usando Access Token OAuth do organizador ${dbEvent.organizer_id} para o evento ${registrationData.eventId}`);
          } else if (dbEvent.mp_access_token) {
            // Fallback de compatibilidade caso o evento ainda use o token legado do evento
            accessToken = dbEvent.mp_access_token;
            console.log(`[MercadoPago Preference API] Usando Access Token legado do evento ${registrationData.eventId}`);
          } else {
            // Caso não tenha Mercado Pago conectado, barra o pagamento conforme as regras do Marketplace
            console.error(`[MercadoPago Preference API] Gestor ${dbEvent.organizer_id} não possui Mercado Pago conectado.`);
            return NextResponse.json({ error: 'Este evento não aceita pagamentos online no momento. Entre em contato com o organizador.' }, { status: 403 });
          }

          // 2. Define a taxa do marketplace
          if (dbEvent.marketplace_fee !== null && dbEvent.marketplace_fee !== undefined) {
            marketplaceFee = Number(dbEvent.marketplace_fee);
          }
        }
      } catch (err) {
        console.warn("[MercadoPago Preference API] Erro ao carregar credenciais customizadas/OAuth:", err);
      }
    }

    if (!accessToken) {
      console.error("[MercadoPago Preference API] ACCESS_TOKEN não configurado");
      return NextResponse.json({ error: 'Configuração do gateway pendente.' }, { status: 500 });
    }

    // Serializa os dados complexos de inscrição para caberem no metadata plano do Mercado Pago
    const metadataPayload = {
      registration_json: JSON.stringify({
        registrationData,
        athleteProfile
      })
    };

    const isLocalhost = origin.includes('localhost') || origin.includes('127.0.0.1');

    // Monta o payload de preferência para o Mercado Pago com a taxa de comissão
    const preferencePayload = {
      items: [
        {
          id: registrationData.divisionId,
          title: `Inscrição: ${registrationData.ticketType} - WODArena`,
          description: `Inscrição na categoria: ${registrationData.ticketType}`,
          quantity: 1,
          currency_id: 'BRL',
          unit_price: Number(registrationData.totalPaid)
        }
      ],
      payer: {
        name: athleteProfile.name || registrationData.athleteName,
        email: athleteProfile.email || registrationData.athleteEmail || 'atleta@wodarena.com',
        phone: {
          number: (athleteProfile.phone || registrationData.athletePhone || '').replace(/\D/g, '')
        }
      },
      back_urls: {
        success: `${origin}/event/${registrationData.eventId}?payment=success`,
        failure: `${origin}/event/${registrationData.eventId}?payment=failure`,
        pending: `${origin}/event/${registrationData.eventId}?payment=pending`
      },
      metadata: metadataPayload,
      marketplace_fee: marketplaceFee,
      ...(isLocalhost ? {} : { 
        auto_return: 'approved',
        notification_url: `${origin}/api/webhooks/mercadopago?event_id=${registrationData.eventId}` 
      })
    };

    console.log("[MercadoPago Preference API] Enviando requisição para Mercado Pago...");
    const mpResponse = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(preferencePayload)
    });

    if (!mpResponse.ok) {
      const errorData = await mpResponse.json();
      console.error("[MercadoPago Preference API] Erro da API Mercado Pago:", errorData);
      return NextResponse.json({ error: 'Erro ao gerar link de pagamento.' }, { status: 500 });
    }

    const preferenceData = await mpResponse.json();
    return NextResponse.json({
      id: preferenceData.id,
      init_point: preferenceData.init_point,
      sandbox_init_point: preferenceData.sandbox_init_point
    });

  } catch (err) {
    console.error("[MercadoPago Preference API] Erro interno na API:", err);
    return NextResponse.json({ error: 'Erro interno ao criar preferência de pagamento.' }, { status: 500 });
  }
}
