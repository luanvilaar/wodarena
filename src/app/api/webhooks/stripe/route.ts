import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { RegistrationPaymentStatus } from '@/types';
import {
  applyCouponUsageForApprovedRegistration,
  triggerRegistrationApprovedEmail
} from '@/lib/serverCheckout';
import { createSupabaseAdmin } from '@/lib/serverSecurity';
import { extractApplicationFeeCharged, getStripeClient, StripeConfigError } from '@/lib/stripeServer';
import { fromMinorUnits } from '@/lib/intl/format';
import { PAYMENT_INTEGRITY_STATUS_DETAIL } from '@/lib/paymentIntegrity';
import { reviewPaymentBeforeApproval } from '@/lib/serverPaymentIntegrity';
import { writePaymentTransition } from '@/lib/serverPaymentTransition';
import type { EventCurrency } from '@/types';

const supabaseAdmin = createSupabaseAdmin();

const toRegistrationPaymentStatus = (status?: string): RegistrationPaymentStatus => {
  if (status === 'succeeded') return 'payment_approved';
  if (status === 'processing') return 'payment_in_review';
  if (status === 'canceled') return 'payment_cancelled';
  if (status === 'payment_failed' || status === 'requires_payment_method') return 'payment_failed';
  return 'payment_pending';
};

// approvedAt: hora do evento do Stripe (o PaymentIntent não traz a da aprovação).
// Separa o pagamento aprovado depois do cancelamento pelo gestor (Story 1.137).
const updateRegistrationFromIntent = async (paymentIntent: Stripe.PaymentIntent, approvedAt?: string) => {
  const registrationId = paymentIntent.metadata?.registration_id;
  const eventId = paymentIntent.metadata?.event_id;

  if (!registrationId || !eventId) {
    console.warn('[Stripe Webhook] PaymentIntent sem registration_id/event_id vinculado.', paymentIntent.id);
    return;
  }

  const { data: existingRegistration, error: existingError } = await supabaseAdmin
    .from('registrations')
    .select('*')
    .eq('id', registrationId)
    .eq('event_id', eventId)
    .maybeSingle();

  if (existingError || !existingRegistration) {
    console.error('[Stripe Webhook] Inscrição vinculada ao pagamento não encontrada:', registrationId);
    return;
  }

  const currency = (existingRegistration.currency || 'BRL') as EventCurrency;
  const amountCollected = fromMinorUnits(paymentIntent.amount_received || paymentIntent.amount, currency);
  const applicationFeeCharged = fromMinorUnits(extractApplicationFeeCharged(paymentIntent), currency);

  const { holdForReview } = await reviewPaymentBeforeApproval(supabaseAdmin, {
    source: 'stripe-webhook',
    eventId,
    registrationId,
    registration: existingRegistration,
    payment: {
      id: paymentIntent.id,
      status: paymentIntent.status,
      // Já na unidade principal (convertido de unidades menores logo acima).
      amount: amountCollected,
      currency: paymentIntent.currency,
      registrationId,
      gateway: 'stripe'
    }
  });
  const nextPaymentStatus: RegistrationPaymentStatus = holdForReview ? 'payment_in_review' : toRegistrationPaymentStatus(paymentIntent.status);

  // Regra única (Story 1.137): aviso de outra tentativa não desfaz a inscrição
  // aprovada nem a cancelada pelo gestor.
  const transition = await writePaymentTransition(supabaseAdmin, {
    source: 'stripe-webhook',
    registrationId,
    eventId,
    registration: existingRegistration,
    payment: {
      gateway: 'stripe',
      id: paymentIntent.id,
      status: paymentIntent.status,
      approvedAt
    },
    nextStatus: nextPaymentStatus,
    fields: {
      payment_method: 'credit_card',
      payment_id: paymentIntent.id,
      payment_status_detail: holdForReview ? PAYMENT_INTEGRITY_STATUS_DETAIL : (paymentIntent.last_payment_error?.code || null),
      payment_error_message: paymentIntent.last_payment_error?.message || null,
      ...(amountCollected > 0 ? { amount_collected: amountCollected } : {}),
      ...(applicationFeeCharged > 0 ? { application_fee_charged: applicationFeeCharged } : {})
    }
  });

  if (transition.error) {
    console.error('[Stripe Webhook] Erro ao atualizar inscrição:', transition.error);
    return;
  }

  if (transition.becameApproved) {
    await applyCouponUsageForApprovedRegistration(supabaseAdmin, registrationId);
    await triggerRegistrationApprovedEmail(supabaseAdmin, registrationId).catch(err =>
      console.error('[Stripe Webhook] Erro ao disparar e-mail:', err)
    );
  }
};

export async function POST(request: Request) {
  try {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    const signature = request.headers.get('stripe-signature');
    const rawBody = await request.text();

    if (!webhookSecret) {
      console.warn('[Stripe Webhook] STRIPE_WEBHOOK_SECRET ausente — requisição rejeitada.');
      return NextResponse.json({ error: 'Webhook Stripe não configurado no servidor.' }, { status: 500 });
    }
    if (!signature) {
      return NextResponse.json({ error: 'Assinatura Stripe ausente.' }, { status: 401 });
    }

    let event: Stripe.Event;
    try {
      event = getStripeClient().webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (err) {
      console.warn('[Stripe Webhook] Assinatura inválida:', err instanceof Error ? err.message : err);
      return NextResponse.json({ error: 'Assinatura Stripe inválida.' }, { status: 401 });
    }

    const eventAt = new Date(event.created * 1000).toISOString();
    switch (event.type) {
      case 'payment_intent.succeeded':
      case 'payment_intent.payment_failed':
      case 'payment_intent.canceled':
      case 'payment_intent.processing':
        await updateRegistrationFromIntent(event.data.object as Stripe.PaymentIntent, eventAt);
        break;
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (typeof session.payment_intent === 'string') {
          const intent = await getStripeClient().paymentIntents.retrieve(
            session.payment_intent,
            {},
            { stripeAccount: session.metadata?.stripe_account_id || undefined }
          );
          await updateRegistrationFromIntent(intent, eventAt);
        }
        break;
      }
      default:
        break;
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    if (err instanceof StripeConfigError) {
      console.error('[Stripe Webhook] Erro de configuração:', err.message);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }

    console.error('[Stripe Webhook] Erro crítico no processamento:', err);
    return NextResponse.json({ error: 'Erro crítico interno.' }, { status: 500 });
  }
}
