import { NextResponse } from 'next/server';
import {
  MercadoPagoConfigError,
  resolveMercadoPagoCheckoutConfig
} from '@/lib/mercadopagoServer';
import { ManagerAccessError, assertManagerSalesAccessForEvent, managerAccessErrorResponse } from '@/lib/serverManagerAccess';
import { loadRegistrationCheckoutSnapshot } from '@/lib/serverCheckout';
import { createSupabaseAdmin } from '@/lib/serverSecurity';

const supabaseAdmin = createSupabaseAdmin();

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { registrationData, origin } = body;

    if (!registrationData?.id || !origin) {
      return NextResponse.json({ error: 'Parâmetros inválidos.' }, { status: 400 });
    }

    const checkoutSnapshot = await loadRegistrationCheckoutSnapshot(supabaseAdmin, registrationData.id);
    const { registrationData: safeRegistrationData, athleteProfile, transactionAmount } = checkoutSnapshot;
    await assertManagerSalesAccessForEvent(supabaseAdmin, checkoutSnapshot.eventId);
    const checkoutConfig = await resolveMercadoPagoCheckoutConfig(checkoutSnapshot.eventId);
    console.log(`[MercadoPago Preference API] Usando credenciais ${checkoutConfig.source} do organizador ${checkoutConfig.organizerId} para o evento ${checkoutSnapshot.eventId}`);

    const metadataPayload = {
      registration_id: checkoutSnapshot.registrationId,
      event_id: checkoutSnapshot.eventId
    };

    const isLocalhost = origin.includes('localhost') || origin.includes('127.0.0.1');

    // Monta o payload de preferência para o Mercado Pago com a taxa de comissão
    const preferencePayload = {
      items: [
        {
          id: safeRegistrationData.divisionId,
          title: `Inscrição: ${safeRegistrationData.ticketType} - WODArena`,
          description: `Inscrição na categoria: ${safeRegistrationData.ticketType}`,
          quantity: 1,
          currency_id: 'BRL',
          unit_price: transactionAmount
        }
      ],
      payer: {
        name: athleteProfile.name || safeRegistrationData.athleteName,
        email: athleteProfile.email || safeRegistrationData.athleteEmail || 'atleta@wodarena.com',
        phone: {
          number: String(athleteProfile.phone || safeRegistrationData.athletePhone || '').replace(/\D/g, '')
        }
      },
      back_urls: {
        success: `${origin}/event/${checkoutSnapshot.eventId}?payment=success`,
        failure: `${origin}/event/${checkoutSnapshot.eventId}?payment=failure`,
        pending: `${origin}/event/${checkoutSnapshot.eventId}?payment=pending`
      },
      metadata: metadataPayload,
      ...(isLocalhost ? {} : { 
        auto_return: 'approved',
        notification_url: `${origin}/api/webhooks/mercadopago?event_id=${checkoutSnapshot.eventId}` 
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
        total_paid: transactionAmount,
        updated_at: new Date().toISOString()
      })
      .eq('id', checkoutSnapshot.registrationId);

    return NextResponse.json({
      id: preferenceData.id,
      init_point: preferenceData.init_point,
      sandbox_init_point: preferenceData.sandbox_init_point
    });

  } catch (err) {
    if (err instanceof ManagerAccessError) {
      return managerAccessErrorResponse(err);
    }
    if (err instanceof MercadoPagoConfigError) {
      console.error("[MercadoPago Preference API] Erro de configuração:", err.message);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }

    console.error("[MercadoPago Preference API] Erro interno na API:", err);
    return NextResponse.json({ error: 'Erro interno ao criar preferência de pagamento.' }, { status: 500 });
  }
}
