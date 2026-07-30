import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { RegistrationPaymentStatus } from '@/types';
import {
  applyCouponUsageForApprovedRegistration,
  triggerRegistrationApprovedEmail
} from '@/lib/serverCheckout';
import { createSupabaseAdmin } from '@/lib/serverSecurity';
import {
  MercadoPagoConfigError,
  resolveMercadoPagoCheckoutConfig
} from '@/lib/mercadopagoServer';

const supabaseAdmin = createSupabaseAdmin();

const toRegistrationPaymentStatus = (status?: string): RegistrationPaymentStatus => {
  if (status === 'approved') return 'payment_approved';
  if (status === 'in_process') return 'payment_in_review';
  if (status === 'cancelled') return 'payment_cancelled';
  if (status === 'rejected') return 'payment_failed';
  return 'payment_pending';
};

const parseSignature = (signature: string | null) => Object.fromEntries(
  (signature || '')
    .split(',')
    .map(part => part.trim().split('='))
    .filter(([key, value]) => key && value)
);

const isValidMercadoPagoSignature = (
  request: Request,
  paymentId: string,
  bodyPaymentId?: string
) => {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  if (!secret) return process.env.NODE_ENV !== 'production';

  const requestId = request.headers.get('x-request-id');
  const signatureParts = parseSignature(request.headers.get('x-signature'));
  const ts = signatureParts.ts;
  const v1 = signatureParts.v1;
  const id = bodyPaymentId || paymentId;
  if (!requestId || !ts || !v1 || !id) return false;

  const manifest = `id:${id};request-id:${requestId};ts:${ts};`;
  const expected = createHmac('sha256', secret).update(manifest).digest('hex');
  const actualBuffer = Buffer.from(v1);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
};



export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const topic = searchParams.get('topic');
    const id = searchParams.get('id') || searchParams.get('data.id');

    let paymentId = id;
    let type = topic;
    let bodyPaymentId: string | undefined;

    try {
      const body = await request.json();
      if (body.data?.id) {
        paymentId = body.data.id;
        bodyPaymentId = body.data.id;
      }
      if (body.type) type = body.type;
    } catch {
      // Body vazio ou nao JSON.
    }

    if (!paymentId || (type && type !== 'payment')) {
      return NextResponse.json({ received: true });
    }

    const isSignatureValid = isValidMercadoPagoSignature(request, paymentId, bodyPaymentId);
    if (!isSignatureValid) {
      console.warn(`[MercadoPago Webhook] Assinatura HMAC invalida para o pagamento ${paymentId}. Continuando validacao por canal seguro.`);
    }

    const eventId = searchParams.get('event_id');
    if (!eventId) {
      return NextResponse.json({ error: 'Evento obrigatorio para processar webhook.' }, { status: 400 });
    }

    const checkoutConfig = await resolveMercadoPagoCheckoutConfig(eventId, { allowManualLegacy: true });
    const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: {
        'Authorization': `Bearer ${checkoutConfig.accessToken}`
      }
    });

    if (!mpResponse.ok) {
      console.error(`[MercadoPago Webhook] Erro ao carregar transacao ${paymentId} do Mercado Pago.`);
      if (!isSignatureValid) {
        return NextResponse.json({ error: 'Assinatura Mercado Pago invalida e transacao nao pode ser confirmada.' }, { status: 401 });
      }
      return NextResponse.json({ error: 'Erro ao buscar pagamento.' }, { status: 500 });
    }

    const paymentData = await mpResponse.json();
    const { status, metadata } = paymentData;
    const metadataRegistrationId = metadata?.registration_id;

    if (!metadataRegistrationId) {
      return NextResponse.json({ error: 'Pagamento sem registration_id vinculado.' }, { status: 400 });
    }

    const { data: existingRegistration, error: existingError } = await supabaseAdmin
      .from('registrations')
      .select('*')
      .eq('id', metadataRegistrationId)
      .eq('event_id', eventId)
      .maybeSingle();

    if (existingError || !existingRegistration) {
      return NextResponse.json({ error: 'Inscricao vinculada ao pagamento nao encontrada.' }, { status: 404 });
    }

    const nextPaymentStatus = toRegistrationPaymentStatus(status);
    const wasApproved = existingRegistration.payment_status === 'payment_approved';
    const amountCollected = Number(paymentData.transaction_amount || 0);
    const applicationFeeCharged = Number(paymentData.application_fee || 0);

    const { data: updatedRegistration, error: updateError } = await supabaseAdmin
      .from('registrations')
      .update({
        payment_status: nextPaymentStatus,
        payment_method: paymentData.payment_method_id || null,
        payment_id: String(paymentData.id),
        payment_status_detail: paymentData.status_detail || null,
        payment_error_message: status === 'rejected' ? 'Pagamento nao processado.' : null,
        ...(amountCollected > 0 ? { amount_collected: amountCollected } : {}),
        ...(applicationFeeCharged > 0 ? { application_fee_charged: applicationFeeCharged } : {}),
        updated_at: new Date().toISOString()
      })
      .eq('id', metadataRegistrationId)
      .eq('event_id', eventId)
      .select('*')
      .maybeSingle();

    if (updateError || !updatedRegistration) {
      console.error('[MercadoPago Webhook] Erro ao atualizar inscricao:', updateError);
      return NextResponse.json({ error: 'Erro ao atualizar inscricao.' }, { status: 500 });
    }

    if (nextPaymentStatus === 'payment_approved' && !wasApproved) {
      await applyCouponUsageForApprovedRegistration(supabaseAdmin, metadataRegistrationId);
      await triggerRegistrationApprovedEmail(supabaseAdmin, metadataRegistrationId).catch(err =>
        console.error('[MercadoPago Webhook] Erro ao disparar e-mail:', err)
      );
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    if (err instanceof MercadoPagoConfigError) {
      console.error('[MercadoPago Webhook] Erro de configuracao:', err.message);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }

    console.error('[MercadoPago Webhook] Erro critico no processamento:', err);
    return NextResponse.json({ error: 'Erro critico interno.' }, { status: 500 });
  }
}
