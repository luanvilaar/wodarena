import { NextResponse } from 'next/server';
import {
  MercadoPagoConfigError,
  resolveMercadoPagoCheckoutConfig
} from '@/lib/mercadopagoServer';
import { StripeConfigError, buildStripeIdempotencyKey, getStripeClient, resolveStripeCheckoutConfig } from '@/lib/stripeServer';
import { ManagerAccessError, assertManagerSalesAccessForEvent, managerAccessErrorResponse } from '@/lib/serverManagerAccess';
import { assertEventRegistrationAvailable, assertRegistrationAccess, loadRegistrationCheckoutSnapshot, RegistrationAccessError } from '@/lib/serverCheckout';
import { createSupabaseAdmin } from '@/lib/serverSecurity';
import { calculateServiceFee } from '@/lib/serviceFee';
import { CheckoutGatewayError, resolveEventPaymentContext } from '@/lib/checkoutGateway';
import { toMinorUnits } from '@/lib/intl/format';

const supabaseAdmin = createSupabaseAdmin();

const createStripeCheckoutSession = async (
  eventId: string,
  registrationId: string,
  ticketType: string,
  transactionAmount: number,
  origin: string,
  locale: string
) => {
  const paymentContext = await resolveEventPaymentContext(supabaseAdmin, eventId);
  const checkoutConfig = await resolveStripeCheckoutConfig(eventId);
  const serviceFee = calculateServiceFee(
    transactionAmount,
    checkoutConfig.serviceFeePercent,
    checkoutConfig.serviceFeeEnabled
  );
  console.log(`[Stripe Preference API] Usando conta conectada ${checkoutConfig.stripeAccountId} do organizador ${checkoutConfig.organizerId} para o evento ${eventId}`);

  const currency = paymentContext.currency.toLowerCase();
  const isLocalhost = origin.includes('localhost') || origin.includes('127.0.0.1');
  const localePrefix = `/${locale}`;
  const amountCollectedMinorUnits = toMinorUnits(serviceFee.amountCollected, paymentContext.currency);
  const serviceFeeMinorUnits = toMinorUnits(serviceFee.serviceFeeAmount, paymentContext.currency);

  const session = await getStripeClient().checkout.sessions.create({
    mode: 'payment',
    line_items: [{
      price_data: {
        currency,
        unit_amount: toMinorUnits(serviceFee.baseAmount, paymentContext.currency),
        product_data: { name: `Inscrição: ${ticketType} - WODArena` }
      },
      quantity: 1
    }],
    payment_intent_data: {
      ...(serviceFeeMinorUnits > 0 ? { application_fee_amount: serviceFeeMinorUnits } : {}),
      transfer_data: { destination: checkoutConfig.stripeAccountId },
      metadata: { registration_id: registrationId, event_id: eventId }
    },
    metadata: { registration_id: registrationId, event_id: eventId, stripe_account_id: checkoutConfig.stripeAccountId },
    success_url: `${origin}${localePrefix}/event/${eventId}?payment=success`,
    cancel_url: `${origin}${localePrefix}/event/${eventId}?payment=failure`,
    ...(isLocalhost ? {} : {})
  }, {
    idempotencyKey: buildStripeIdempotencyKey('checkout_session', registrationId, amountCollectedMinorUnits, serviceFeeMinorUnits)
  });

  return { redirectUrl: session.url, serviceFee };
};

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { registrationData, origin, accessToken, locale } = body;

    if (!registrationData?.id || !origin) {
      return NextResponse.json({ error: 'Parâmetros inválidos.' }, { status: 400 });
    }

    await assertRegistrationAccess(supabaseAdmin, request, {
      registrationId: registrationData.id,
      eventId: registrationData.eventId,
      accessToken
    });

    const checkoutSnapshot = await loadRegistrationCheckoutSnapshot(supabaseAdmin, registrationData.id);
    const { registrationData: safeRegistrationData, athleteProfile, transactionAmount } = checkoutSnapshot;
    await assertEventRegistrationAvailable(supabaseAdmin, checkoutSnapshot.eventId);
    await assertManagerSalesAccessForEvent(supabaseAdmin, checkoutSnapshot.eventId);

    const paymentContext = await resolveEventPaymentContext(supabaseAdmin, checkoutSnapshot.eventId);

    if (paymentContext.gateway === 'stripe') {
      const { redirectUrl, serviceFee } = await createStripeCheckoutSession(
        checkoutSnapshot.eventId,
        checkoutSnapshot.registrationId,
        String(safeRegistrationData.ticketType || ''),
        transactionAmount,
        origin,
        typeof locale === 'string' ? locale : 'pt-br'
      );

      if (!redirectUrl) {
        return NextResponse.json({ error: 'Link de pagamento inválido retornado pela Stripe.' }, { status: 500 });
      }

      await supabaseAdmin
        .from('registrations')
        .update({
          payment_status: 'payment_pending',
          payment_method: 'stripe_checkout',
          payment_status_detail: null,
          payment_error_message: null,
          total_paid: transactionAmount,
          currency: paymentContext.currency,
          payment_gateway: 'stripe',
          service_fee_percent: serviceFee.serviceFeePercent,
          service_fee_amount: serviceFee.serviceFeeAmount,
          amount_collected: serviceFee.amountCollected,
          application_fee_charged: 0,
          updated_at: new Date().toISOString()
        })
        .eq('id', checkoutSnapshot.registrationId);

      return NextResponse.json({ redirectUrl, gateway: 'stripe' });
    }

    const checkoutConfig = await resolveMercadoPagoCheckoutConfig(checkoutSnapshot.eventId);
    const serviceFee = calculateServiceFee(
      transactionAmount,
      checkoutConfig.serviceFeePercent,
      checkoutConfig.serviceFeeEnabled
    );
    console.log(`[MercadoPago Preference API] Usando credenciais ${checkoutConfig.source} do organizador ${checkoutConfig.organizerId} para o evento ${checkoutSnapshot.eventId}`);

    const metadataPayload = {
      registration_id: checkoutSnapshot.registrationId,
      event_id: checkoutSnapshot.eventId
    };

    const isLocalhost = origin.includes('localhost') || origin.includes('127.0.0.1');
    const sanitizedOrigin = isLocalhost ? origin : origin.replace(/^http:/, 'https:');

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
        },
        ...(serviceFee.serviceFeeAmount > 0 ? [{
          id: 'wodarena-service-fee',
          title: `Taxa de serviço (${serviceFee.serviceFeePercent}%)`,
          description: 'Taxa de serviço da plataforma WODArena',
          quantity: 1,
          currency_id: 'BRL',
          unit_price: serviceFee.serviceFeeAmount
        }] : [])
      ],
      ...(serviceFee.serviceFeeAmount > 0 ? { marketplace_fee: serviceFee.serviceFeeAmount } : {}),
      payer: {
        name: athleteProfile.name || safeRegistrationData.athleteName,
        email: athleteProfile.email || safeRegistrationData.athleteEmail || 'atleta@wodarena.com',
        phone: {
          number: String(athleteProfile.phone || safeRegistrationData.athletePhone || '').replace(/\D/g, '')
        }
      },
      back_urls: {
        success: `${sanitizedOrigin}/${typeof locale === 'string' ? locale : 'pt-br'}/event/${checkoutSnapshot.eventId}?payment=success`,
        failure: `${sanitizedOrigin}/${typeof locale === 'string' ? locale : 'pt-br'}/event/${checkoutSnapshot.eventId}?payment=failure`,
        pending: `${sanitizedOrigin}/${typeof locale === 'string' ? locale : 'pt-br'}/event/${checkoutSnapshot.eventId}?payment=pending`
      },
      metadata: metadataPayload,
      ...(isLocalhost ? {} : { 
        auto_return: 'approved',
        notification_url: `${sanitizedOrigin}/api/webhooks/mercadopago?event_id=${checkoutSnapshot.eventId}` 
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
        service_fee_percent: serviceFee.serviceFeePercent,
        service_fee_amount: serviceFee.serviceFeeAmount,
        amount_collected: serviceFee.amountCollected,
        application_fee_charged: 0,
        updated_at: new Date().toISOString()
      })
      .eq('id', checkoutSnapshot.registrationId);

    return NextResponse.json({
      gateway: 'mercadopago',
      id: preferenceData.id,
      init_point: preferenceData.init_point,
      sandbox_init_point: preferenceData.sandbox_init_point,
      redirectUrl: preferenceData.init_point
    });

  } catch (err) {
    if (err instanceof ManagerAccessError) {
      return managerAccessErrorResponse(err);
    }
    if (err instanceof RegistrationAccessError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof CheckoutGatewayError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof MercadoPagoConfigError || err instanceof StripeConfigError) {
      console.error("[Checkout Preference API] Erro de configuração:", err.message);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }

    console.error("[MercadoPago Preference API] Erro interno na API:", err);
    return NextResponse.json({ error: 'Erro interno ao criar preferência de pagamento.' }, { status: 500 });
  }
}
