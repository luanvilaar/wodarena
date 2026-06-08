import { NextResponse } from 'next/server';
import {
  MercadoPagoConfigError,
  resolveMercadoPagoCheckoutConfig
} from '@/lib/mercadopagoServer';
import { loadRegistrationCheckoutSnapshot } from '@/lib/serverCheckout';
import { checkRateLimit, createSupabaseAdmin, getClientIp } from '@/lib/serverSecurity';

const supabaseAdmin = createSupabaseAdmin();

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { registrationData, cpf } = body;

    if (!registrationData?.id || !cpf) {
      return NextResponse.json({ error: 'Parâmetros inválidos.' }, { status: 400 });
    }

    const rateLimited = checkRateLimit({
      key: `checkout:${getClientIp(request)}:${registrationData.id}:pix`,
      limit: 12,
      windowMs: 15 * 60 * 1000
    });
    if (rateLimited) return rateLimited;

    const checkoutSnapshot = await loadRegistrationCheckoutSnapshot(supabaseAdmin, registrationData.id);
    const { registrationData: safeRegistrationData, athleteProfile, transactionAmount } = checkoutSnapshot;
    const checkoutConfig = await resolveMercadoPagoCheckoutConfig(checkoutSnapshot.eventId);
    console.log(`[MercadoPago Pix API] Usando credenciais ${checkoutConfig.source} do organizador ${checkoutConfig.organizerId} para o evento ${checkoutSnapshot.eventId}`);

    // Limpa o CPF para ter apenas números
    const cleanCpf = cpf.replace(/\D/g, '');
    if (cleanCpf.length !== 11) {
      return NextResponse.json({ error: 'CPF inválido. Deve conter 11 dígitos.' }, { status: 400 });
    }

    // Divide o nome do atleta para first_name e last_name
    const fullName = String(athleteProfile.name || safeRegistrationData.athleteName || 'Atleta WODArena');
    const names = fullName.trim().split(/\s+/);
    const firstName = names[0] || 'Atleta';
    const lastName = names.slice(1).join(' ') || 'WODArena';

    const origin = request.headers.get('origin') || new URL(request.url).origin;
    const isLocalhost = origin.includes('localhost') || origin.includes('127.0.0.1');

    const paymentPayload = {
      transaction_amount: transactionAmount,
      description: `Inscrição: ${safeRegistrationData.ticketType} - WODArena`,
      payment_method_id: 'pix',
      payer: {
        email: athleteProfile.email || safeRegistrationData.athleteEmail || 'atleta@wodarena.com',
        first_name: firstName,
        last_name: lastName,
        identification: {
          type: 'CPF',
          number: cleanCpf
        }
      },
      metadata: {
        registration_id: checkoutSnapshot.registrationId,
        event_id: checkoutSnapshot.eventId
      },
      ...(!isLocalhost ? { notification_url: `${origin}/api/webhooks/mercadopago?event_id=${checkoutSnapshot.eventId}` } : {})
    };

    console.log("[MercadoPago Pix API] Enviando requisição de pagamento Pix para Mercado Pago...");
    const response = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${checkoutConfig.accessToken}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': `pix-${checkoutSnapshot.registrationId}`
      },
      body: JSON.stringify(paymentPayload)
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error("[MercadoPago Pix API] Erro ao criar pagamento Pix no Mercado Pago:", errorData);
      const errorMessage = errorData?.cause?.[0]?.description || errorData?.message || 'Erro ao gerar cobrança Pix.';
      return NextResponse.json({ error: errorMessage }, { status: response.status });
    }

    const paymentData = await response.json();
    const transactionData = paymentData.point_of_interaction?.transaction_data;

    if (!transactionData) {
      console.error("[MercadoPago Pix API] Dados da transação Pix ausentes na resposta:", paymentData);
      return NextResponse.json({ error: 'Dados da transação Pix não gerados.' }, { status: 500 });
    }

    await supabaseAdmin
      .from('registrations')
      .update({
        payment_status: paymentData.status === 'approved' ? 'payment_approved' : 'payment_pending',
        payment_method: 'pix',
        payment_id: paymentData.id ? String(paymentData.id) : null,
        payment_status_detail: paymentData.status_detail || null,
        payment_error_message: null,
        total_paid: transactionAmount,
        updated_at: new Date().toISOString()
      })
      .eq('id', checkoutSnapshot.registrationId);

    return NextResponse.json({
      paymentId: paymentData.id,
      status: paymentData.status,
      qr_code: transactionData.qr_code,
      qr_code_base64: transactionData.qr_code_base64
    });

  } catch (err) {
    if (err instanceof MercadoPagoConfigError) {
      console.error("[MercadoPago Pix API] Erro de configuração:", err.message);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }

    console.error("[MercadoPago Pix API] Erro interno na API de Pix:", err);
    return NextResponse.json({ error: 'Erro interno ao processar pagamento Pix.' }, { status: 500 });
  }
}
