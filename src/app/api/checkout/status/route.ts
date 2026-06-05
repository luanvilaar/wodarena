import { NextResponse } from 'next/server';
import {
  MercadoPagoConfigError,
  resolveMercadoPagoCheckoutConfig
} from '@/lib/mercadopagoServer';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const paymentId = searchParams.get('payment_id');
    const eventId = searchParams.get('event_id');

    if (!paymentId) {
      return NextResponse.json({ error: 'Parâmetro payment_id obrigatório.' }, { status: 400 });
    }

    if (!eventId) {
      return NextResponse.json({ error: 'Parâmetro event_id obrigatório.' }, { status: 400 });
    }

    const checkoutConfig = await resolveMercadoPagoCheckoutConfig(eventId);
    console.log(`[MercadoPago Status API] Usando credenciais ${checkoutConfig.source} do organizador ${checkoutConfig.organizerId} para o evento ${eventId}`);

    console.log(`[MercadoPago Status API] Buscando status do pagamento: ${paymentId}`);
    const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: {
        'Authorization': `Bearer ${checkoutConfig.accessToken}`
      }
    });

    if (!response.ok) {
      console.error(`[MercadoPago Status API] Erro ao buscar pagamento ${paymentId} no Mercado Pago.`);
      return NextResponse.json({ error: 'Erro ao buscar status do pagamento.' }, { status: 500 });
    }

    const paymentData = await response.json();
    let registrationPayload = null;

    if (paymentData.metadata?.registration_json) {
      try {
        registrationPayload = JSON.parse(paymentData.metadata.registration_json);
      } catch (parseErr) {
        console.warn("[MercadoPago Status API] Metadados de inscrição inválidos:", parseErr);
      }
    }

    return NextResponse.json({
      status: paymentData.status,
      registrationData: registrationPayload?.registrationData || null,
      athleteProfile: registrationPayload?.athleteProfile || null,
      cpf: paymentData.metadata?.payer_cpf || ''
    });

  } catch (err) {
    if (err instanceof MercadoPagoConfigError) {
      console.error("[MercadoPago Status API] Erro de configuração:", err.message);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }

    console.error("[MercadoPago Status API] Erro interno na consulta de status:", err);
    return NextResponse.json({ error: 'Erro interno ao consultar status do pagamento.' }, { status: 500 });
  }
}
