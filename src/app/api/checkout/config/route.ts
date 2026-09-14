import { NextResponse } from 'next/server';
import {
  MercadoPagoConfigError,
  resolveMercadoPagoPublicConfig
} from '@/lib/mercadopagoServer';
import { StripeConfigError, resolveStripePublicConfig } from '@/lib/stripeServer';
import { CheckoutGatewayError, resolveEventPaymentContext } from '@/lib/checkoutGateway';
import { createSupabaseAdmin } from '@/lib/serverSecurity';
import { isPixSupported } from '@/lib/paymentGateway';

const supabaseAdmin = createSupabaseAdmin();

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const eventId = searchParams.get('event_id');

    if (!eventId) {
      return NextResponse.json({ error: 'Parâmetro event_id obrigatório.' }, { status: 400 });
    }

    const paymentContext = await resolveEventPaymentContext(supabaseAdmin, eventId);

    if (paymentContext.gateway === 'stripe') {
      const checkoutConfig = await resolveStripePublicConfig(eventId);
      console.log(`[Checkout Config API] Stripe publishable key carregada para o evento ${eventId}`);

      return NextResponse.json({
        gateway: 'stripe',
        currency: paymentContext.currency,
        countryCode: paymentContext.countryCode,
        taxIdRequirement: paymentContext.taxIdRequirement,
        pixSupported: false,
        publishableKey: checkoutConfig.publishableKey,
        stripeAccountId: checkoutConfig.stripeAccountId,
        serviceFeeEnabled: checkoutConfig.serviceFeeEnabled,
        serviceFeePercent: checkoutConfig.serviceFeePercent
      });
    }

    const checkoutConfig = await resolveMercadoPagoPublicConfig(eventId);
    console.log(`[Checkout Config API] Mercado Pago public key ${checkoutConfig.source} carregada para o evento ${eventId}`);

    return NextResponse.json({
      gateway: 'mercadopago',
      currency: paymentContext.currency,
      countryCode: paymentContext.countryCode,
      taxIdRequirement: paymentContext.taxIdRequirement,
      pixSupported: isPixSupported(paymentContext.currency),
      publicKey: checkoutConfig.publicKey,
      serviceFeeEnabled: checkoutConfig.serviceFeeEnabled,
      serviceFeePercent: checkoutConfig.serviceFeePercent
    });
  } catch (err) {
    if (err instanceof CheckoutGatewayError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof MercadoPagoConfigError || err instanceof StripeConfigError) {
      console.error('[Checkout Config API] Erro de configuração:', err.message);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }

    console.error('[Checkout Config API] Erro interno:', err);
    return NextResponse.json({ error: 'Erro interno ao carregar checkout.' }, { status: 500 });
  }
}
