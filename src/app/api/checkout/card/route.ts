import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { registrationData, athleteProfile, token, payment_method_id, installments } = body;

    if (!registrationData || !athleteProfile || !token || !payment_method_id) {
      return NextResponse.json({ error: 'Parâmetros inválidos.' }, { status: 400 });
    }

    let accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
    if (registrationData.eventId) {
      try {
        const { data: dbEvent } = await supabase
          .from('events')
          .select('mp_access_token')
          .eq('id', registrationData.eventId)
          .single();
        if (dbEvent?.mp_access_token) {
          accessToken = dbEvent.mp_access_token;
          console.log(`[MercadoPago Card API] Usando Access Token customizado para o evento ${registrationData.eventId}`);
        }
      } catch (err) {
        console.warn("[MercadoPago Card API] Erro ao carregar credenciais customizadas:", err);
      }
    }

    if (!accessToken) {
      console.error("[MercadoPago Card API] ACCESS_TOKEN não configurado");
      return NextResponse.json({ error: 'Configuração do gateway pendente.' }, { status: 500 });
    }

    const origin = request.headers.get('origin') || new URL(request.url).origin;
    const isLocalhost = origin.includes('localhost') || origin.includes('127.0.0.1');

    const paymentPayload = {
      token: token,
      installments: Number(installments || 1),
      transaction_amount: Number(registrationData.totalPaid),
      payment_method_id: payment_method_id,
      payer: {
        email: athleteProfile.email || registrationData.athleteEmail || 'atleta@wodarena.com'
      },
      metadata: {
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
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': `card-${registrationData.id}`
      },
      body: JSON.stringify(paymentPayload)
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error("[MercadoPago Card API] Erro ao criar pagamento com Cartão no Mercado Pago:", errorData);
      return NextResponse.json({ error: 'Erro ao processar cobrança do cartão.' }, { status: 500 });
    }

    const paymentData = await response.json();

    return NextResponse.json({
      paymentId: paymentData.id,
      status: paymentData.status
    });

  } catch (err) {
    console.error("[MercadoPago Card API] Erro interno na API de Cartão:", err);
    return NextResponse.json({ error: 'Erro interno ao processar pagamento via Cartão.' }, { status: 500 });
  }
}
