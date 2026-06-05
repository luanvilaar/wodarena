import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { registrationData, athleteProfile, cpf } = body;

    if (!registrationData || !athleteProfile || !cpf) {
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
          console.log(`[MercadoPago Pix API] Usando Access Token customizado para o evento ${registrationData.eventId}`);
        }
      } catch (err) {
        console.warn("[MercadoPago Pix API] Erro ao carregar credenciais customizadas:", err);
      }
    }

    if (!accessToken) {
      console.error("[MercadoPago Pix API] ACCESS_TOKEN não configurado");
      return NextResponse.json({ error: 'Configuração do gateway pendente.' }, { status: 500 });
    }

    // Limpa o CPF para ter apenas números
    const cleanCpf = cpf.replace(/\D/g, '');
    if (cleanCpf.length !== 11) {
      return NextResponse.json({ error: 'CPF inválido. Deve conter 11 dígitos.' }, { status: 400 });
    }

    // Divide o nome do atleta para first_name e last_name
    const fullName = athleteProfile.name || registrationData.athleteName || 'Atleta WODArena';
    const names = fullName.trim().split(/\s+/);
    const firstName = names[0] || 'Atleta';
    const lastName = names.slice(1).join(' ') || 'WODArena';

    const origin = request.headers.get('origin') || new URL(request.url).origin;
    const isLocalhost = origin.includes('localhost') || origin.includes('127.0.0.1');

    const paymentPayload = {
      transaction_amount: Number(registrationData.totalPaid),
      description: `Inscrição: ${registrationData.ticketType} - WODArena`,
      payment_method_id: 'pix',
      payer: {
        email: athleteProfile.email || registrationData.athleteEmail || 'atleta@wodarena.com',
        first_name: firstName,
        last_name: lastName,
        identification: {
          type: 'CPF',
          number: cleanCpf
        }
      },
      metadata: {
        registration_json: JSON.stringify({
          registrationData,
          athleteProfile
        })
      },
      ...(!isLocalhost ? { notification_url: `${origin}/api/webhooks/mercadopago?event_id=${registrationData.eventId}` } : {})
    };

    console.log("[MercadoPago Pix API] Enviando requisição de pagamento Pix para Mercado Pago...");
    const response = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': `pix-${registrationData.id}`
      },
      body: JSON.stringify(paymentPayload)
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error("[MercadoPago Pix API] Erro ao criar pagamento Pix no Mercado Pago:", errorData);
      return NextResponse.json({ error: 'Erro ao gerar cobrança Pix.' }, { status: 500 });
    }

    const paymentData = await response.json();
    const transactionData = paymentData.point_of_interaction?.transaction_data;

    if (!transactionData) {
      console.error("[MercadoPago Pix API] Dados da transação Pix ausentes na resposta:", paymentData);
      return NextResponse.json({ error: 'Dados da transação Pix não gerados.' }, { status: 500 });
    }

    return NextResponse.json({
      paymentId: paymentData.id,
      status: paymentData.status,
      qr_code: transactionData.qr_code,
      qr_code_base64: transactionData.qr_code_base64
    });

  } catch (err) {
    console.error("[MercadoPago Pix API] Erro interno na API de Pix:", err);
    return NextResponse.json({ error: 'Erro interno ao processar pagamento Pix.' }, { status: 500 });
  }
}
