import { NextResponse } from 'next/server';
import {
  MercadoPagoConfigError,
  resolveMercadoPagoCheckoutConfig
} from '@/lib/mercadopagoServer';
import { ManagerAccessError, assertManagerSalesAccessForEvent, managerAccessErrorResponse } from '@/lib/serverManagerAccess';
import {
  applyCouponUsageForApprovedRegistration,
  assertRegistrationAccess,
  loadRegistrationCheckoutSnapshot,
  RegistrationAccessError,
  triggerRegistrationApprovedEmail
} from '@/lib/serverCheckout';
import { checkRateLimit, createSupabaseAdmin, getClientIp } from '@/lib/serverSecurity';

const supabaseAdmin = createSupabaseAdmin();

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
    totalPaid?: number;
  }
) => {
  if (!registrationId) return;

  const updateFields: {
    payment_status: string;
    payment_method: string;
    payment_id: string | null;
    payment_status_detail: string | null;
    payment_error_message: string | null;
    updated_at: string;
    total_paid?: number;
  } = {
    payment_status: payload.paymentStatus,
    payment_method: 'credit_card',
    payment_id: payload.paymentId ? String(payload.paymentId) : null,
    payment_status_detail: payload.statusDetail || null,
    payment_error_message: payload.errorMessage || null,
    updated_at: new Date().toISOString()
  };

  if (payload.totalPaid !== undefined) {
    updateFields.total_paid = payload.totalPaid;
  }

  const { error } = await supabaseAdmin
    .from('registrations')
    .update(updateFields)
    .eq('id', registrationId);

  if (error) {
    console.error('[MercadoPago Card API] Erro ao atualizar status da inscrição:', error);
  }
};

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { registrationData, token, payment_method_id, installments, cpf, deviceId, accessToken } = body;

    if (!registrationData?.id || !token || !payment_method_id || !cpf) {
      return NextResponse.json({ error: 'Parâmetros inválidos.' }, { status: 400 });
    }

    const rateLimited = checkRateLimit({
      key: `checkout:${getClientIp(request)}:${registrationData.id}:card`,
      limit: 8,
      windowMs: 15 * 60 * 1000
    });
    if (rateLimited) return rateLimited;

    const cleanCpf = cpf.replace(/\D/g, '');
    if (cleanCpf.length !== 11) {
      return NextResponse.json({ error: 'CPF inválido. Deve conter 11 dígitos.' }, { status: 400 });
    }

    await assertRegistrationAccess(supabaseAdmin, request, {
      registrationId: registrationData.id,
      eventId: registrationData.eventId,
      accessToken
    });

    const checkoutSnapshot = await loadRegistrationCheckoutSnapshot(supabaseAdmin, registrationData.id);
    const { registrationData: safeRegistrationData, athleteProfile, transactionAmount } = checkoutSnapshot;
    await assertManagerSalesAccessForEvent(supabaseAdmin, checkoutSnapshot.eventId);
    const checkoutConfig = await resolveMercadoPagoCheckoutConfig(checkoutSnapshot.eventId);
    console.log(`[MercadoPago Card API] Usando credenciais ${checkoutConfig.source} do organizador ${checkoutConfig.organizerId} para o evento ${checkoutSnapshot.eventId}`);

    const fullName = String(athleteProfile.name || safeRegistrationData.athleteName || 'Atleta WODArena');
    const names = fullName.trim().split(/\s+/);
    const firstName = names[0] || 'Atleta';
    const lastName = names.slice(1).join(' ') || 'WODArena';

    const origin = request.headers.get('origin') || new URL(request.url).origin;
    const isLocalhost = origin.includes('localhost') || origin.includes('127.0.0.1');

    const paymentPayload = {
      token: token,
      installments: Number(installments || 1),
      transaction_amount: transactionAmount,
      payment_method_id: payment_method_id,
      description: `Inscrição: ${safeRegistrationData.ticketType} - WODArena`,
      statement_descriptor: 'WODARENA',
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

    console.log("[MercadoPago Card API] Enviando requisição de pagamento via Cartão para Mercado Pago...");
    const response = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${checkoutConfig.accessToken}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': `card-${checkoutSnapshot.registrationId}`,
        ...(deviceId ? { 'X-Meli-Session-Id': deviceId } : {})
      },
      body: JSON.stringify(paymentPayload)
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error("[MercadoPago Card API] Erro ao criar pagamento com Cartão no Mercado Pago:", errorData);
      const statusDetail = errorData?.cause?.[0]?.description || errorData?.message;
      await updateRegistrationPayment(checkoutSnapshot.registrationId, {
        paymentStatus: 'payment_failed',
        statusDetail,
        errorMessage: 'Erro ao processar cobrança do cartão.',
        totalPaid: transactionAmount
      });
      return NextResponse.json({
        error: 'Erro ao processar cobrança do cartão.',
        statusDetail
      }, { status: 500 });
    }

    const paymentData = await response.json();
    const paymentStatus = toRegistrationPaymentStatus(paymentData.status);
    await updateRegistrationPayment(checkoutSnapshot.registrationId, {
      paymentStatus,
      paymentId: paymentData.id,
      statusDetail: paymentData.status_detail,
      errorMessage: paymentStatus === 'payment_failed' ? 'Pagamento não processado pelo cartão.' : undefined,
      totalPaid: transactionAmount
    });

    if (paymentStatus === 'payment_approved') {
      await applyCouponUsageForApprovedRegistration(supabaseAdmin, checkoutSnapshot.registrationId);
      await triggerRegistrationApprovedEmail(supabaseAdmin, checkoutSnapshot.registrationId).catch(err =>
        console.error('[MercadoPago Card API] Erro ao disparar e-mail:', err)
      );
    }

    return NextResponse.json({
      paymentId: paymentData.id,
      status: paymentData.status,
      paymentStatus,
      statusDetail: paymentData.status_detail
    });

  } catch (err) {
    if (err instanceof ManagerAccessError) {
      return managerAccessErrorResponse(err);
    }
    if (err instanceof RegistrationAccessError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof MercadoPagoConfigError) {
      console.error("[MercadoPago Card API] Erro de configuração:", err.message);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }

    console.error("[MercadoPago Card API] Erro interno na API de Cartão:", err);
    return NextResponse.json({ error: 'Erro interno ao processar pagamento via Cartão.' }, { status: 500 });
  }
}
