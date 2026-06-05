import { NextResponse } from 'next/server';
import {
  getMercadoPagoApplicationFee,
  MercadoPagoConfigError,
  resolveMercadoPagoCheckoutConfig
} from '@/lib/mercadopagoServer';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { registrationData, athleteProfile, token, payment_method_id, installments, cpf } = body;

    if (!registrationData || !athleteProfile || !token || !payment_method_id || !cpf) {
      return NextResponse.json({ error: 'Parâmetros inválidos.' }, { status: 400 });
    }

    const cleanCpf = cpf.replace(/\D/g, '');
    if (cleanCpf.length !== 11) {
      return NextResponse.json({ error: 'CPF inválido. Deve conter 11 dígitos.' }, { status: 400 });
    }

    const checkoutConfig = await resolveMercadoPagoCheckoutConfig(registrationData.eventId);
    console.log(`[MercadoPago Card API] Usando credenciais ${checkoutConfig.source} do organizador ${checkoutConfig.organizerId} para o evento ${registrationData.eventId}`);

    const origin = request.headers.get('origin') || new URL(request.url).origin;
    const isLocalhost = origin.includes('localhost') || origin.includes('127.0.0.1');

    const paymentPayload = {
      token: token,
      installments: Number(installments || 1),
      transaction_amount: Number(registrationData.totalPaid),
      payment_method_id: payment_method_id,
      application_fee: getMercadoPagoApplicationFee(Number(registrationData.totalPaid), checkoutConfig.marketplaceFee),
      payer: {
        email: athleteProfile.email || registrationData.athleteEmail || 'atleta@wodarena.com',
        identification: {
          type: 'CPF',
          number: cleanCpf
        }
      },
      metadata: {
        payer_cpf: cleanCpf,
        registration_json: JSON.stringify({
          registrationData,
          athleteProfile
        })
      },
      ...(!isLocalhost ? { notification_url: `${origin}/api/webhooks/mercadopago?event_id=${registrationData.eventId}` } : {})
    };

    console.log("[MercadoPago Card API] Enviando requisição de pagamento via Cartão para Mercado Pago...");
    const response = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${checkoutConfig.accessToken}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': `card-${registrationData.id}`
      },
      body: JSON.stringify(paymentPayload)
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error("[MercadoPago Card API] Erro ao criar pagamento com Cartão no Mercado Pago:", errorData);
      return NextResponse.json({
        error: 'Erro ao processar cobrança do cartão.',
        statusDetail: errorData?.cause?.[0]?.description || errorData?.message
      }, { status: 500 });
    }

    const paymentData = await response.json();

    return NextResponse.json({
      paymentId: paymentData.id,
      status: paymentData.status
    });

  } catch (err) {
    if (err instanceof MercadoPagoConfigError) {
      console.error("[MercadoPago Card API] Erro de configuração:", err.message);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }

    console.error("[MercadoPago Card API] Erro interno na API de Cartão:", err);
    return NextResponse.json({ error: 'Erro interno ao processar pagamento via Cartão.' }, { status: 500 });
  }
}
