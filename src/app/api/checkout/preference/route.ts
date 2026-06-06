import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  MercadoPagoConfigError,
  resolveMercadoPagoCheckoutConfig
} from '@/lib/mercadopagoServer';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://momigbtnsswoldqnadmc.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { registrationData, athleteProfile, origin } = body;

    if (!registrationData || !athleteProfile || !origin) {
      return NextResponse.json({ error: 'Parâmetros inválidos.' }, { status: 400 });
    }

    const checkoutConfig = await resolveMercadoPagoCheckoutConfig(registrationData.eventId);
    console.log(`[MercadoPago Preference API] Usando credenciais ${checkoutConfig.source} do organizador ${checkoutConfig.organizerId} para o evento ${registrationData.eventId}`);

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
      marketplace_fee: checkoutConfig.marketplaceFee,
      ...(isLocalhost ? {} : { 
        auto_return: 'approved',
        notification_url: `${origin}/api/webhooks/mercadopago?event_id=${registrationData.eventId}` 
      })
    };

    console.log("[MercadoPago Preference API] Enviando requisição para Mercado Pago...");
    const mpResponse = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${checkoutConfig.accessToken}`,
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
    await supabaseAdmin
      .from('registrations')
      .update({
        payment_status: 'payment_pending',
        payment_method: 'mercadopago_preference',
        payment_id: preferenceData.id ? String(preferenceData.id) : null,
        payment_status_detail: null,
        payment_error_message: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', registrationData.id);

    return NextResponse.json({
      id: preferenceData.id,
      init_point: preferenceData.init_point,
      sandbox_init_point: preferenceData.sandbox_init_point
    });

  } catch (err) {
    if (err instanceof MercadoPagoConfigError) {
      console.error("[MercadoPago Preference API] Erro de configuração:", err.message);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }

    console.error("[MercadoPago Preference API] Erro interno na API:", err);
    return NextResponse.json({ error: 'Erro interno ao criar preferência de pagamento.' }, { status: 500 });
  }
}
