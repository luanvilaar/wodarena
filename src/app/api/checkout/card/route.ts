import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  getMercadoPagoApplicationFee,
  MercadoPagoConfigError,
  resolveMercadoPagoCheckoutConfig
} from '@/lib/mercadopagoServer';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://momigbtnsswoldqnadmc.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const toRegistrationPaymentStatus = (status?: string) => {
  if (status === 'approved') return 'payment_approved';
  if (status === 'in_process' || status === 'pending') return 'payment_in_review';
  if (status === 'cancelled') return 'payment_cancelled';
  return 'payment_failed';
};

const updateRegistrationPayment = async (
  registrationId: string | undefined,
  payload: {
    paymentStatus: string;
    paymentId?: string | number;
    statusDetail?: string;
    errorMessage?: string;
  }
) => {
  if (!registrationId) return;

  const { error } = await supabaseAdmin
    .from('registrations')
    .update({
      payment_status: payload.paymentStatus,
      payment_method: 'credit_card',
      payment_id: payload.paymentId ? String(payload.paymentId) : null,
      payment_status_detail: payload.statusDetail || null,
      payment_error_message: payload.errorMessage || null,
      updated_at: new Date().toISOString()
    })
    .eq('id', registrationId);

  if (error) {
    console.error('[MercadoPago Card API] Erro ao atualizar status da inscrição:', error);
  }
};

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

    const fullName = athleteProfile.name || registrationData.athleteName || 'Atleta WODArena';
    const names = fullName.trim().split(/\s+/);
    const firstName = names[0] || 'Atleta';
    const lastName = names.slice(1).join(' ') || 'WODArena';

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
        first_name: firstName,
        last_name: lastName,
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
        'X-Idempotency-Key': `card-${registrationData.id}-${Date.now()}`
      },
      body: JSON.stringify(paymentPayload)
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error("[MercadoPago Card API] Erro ao criar pagamento com Cartão no Mercado Pago:", errorData);
      const statusDetail = errorData?.cause?.[0]?.description || errorData?.message;
      await updateRegistrationPayment(registrationData.id, {
        paymentStatus: 'payment_failed',
        statusDetail,
        errorMessage: 'Erro ao processar cobrança do cartão.'
      });
      return NextResponse.json({
        error: 'Erro ao processar cobrança do cartão.',
        statusDetail
      }, { status: 500 });
    }

    const paymentData = await response.json();
    const paymentStatus = toRegistrationPaymentStatus(paymentData.status);
    await updateRegistrationPayment(registrationData.id, {
      paymentStatus,
      paymentId: paymentData.id,
      statusDetail: paymentData.status_detail,
      errorMessage: paymentStatus === 'payment_failed' ? 'Pagamento não processado pelo cartão.' : undefined
    });

    return NextResponse.json({
      paymentId: paymentData.id,
      status: paymentData.status,
      paymentStatus,
      statusDetail: paymentData.status_detail
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
