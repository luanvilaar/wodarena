/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import {
  MercadoPagoConfigError,
  resolveMercadoPagoCheckoutConfig
} from '@/lib/mercadopagoServer';
import {
  applyCouponUsageForApprovedRegistration,
  assertRegistrationAccess,
  loadRegistrationCheckoutSnapshot,
  RegistrationAccessError
} from '@/lib/serverCheckout';
import { createSupabaseAdmin, getRequestSession } from '@/lib/serverSecurity';

const supabaseAdmin = createSupabaseAdmin();

const toRegistrationPaymentStatus = (status?: string) => {
  if (status === 'approved') return 'payment_approved';
  if (status === 'in_process') return 'payment_in_review';
  if (status === 'cancelled') return 'payment_cancelled';
  if (status === 'rejected') return 'payment_failed';
  return 'payment_pending';
};

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const paymentId = searchParams.get('payment_id');
    const registrationIdParam = searchParams.get('registration_id');
    const eventId = searchParams.get('event_id');
    const accessToken = searchParams.get('access_token');
    const actor = getRequestSession(request);

    if (!eventId) {
      return NextResponse.json({ error: 'Parâmetro event_id obrigatório.' }, { status: 400 });
    }

    if (!paymentId && !registrationIdParam) {
      return NextResponse.json({ error: 'Parâmetro payment_id ou registration_id obrigatório.' }, { status: 400 });
    }

    if (!actor && !registrationIdParam) {
      return NextResponse.json({
        error: 'Parâmetro registration_id obrigatório para consultar o status sem sessão autenticada.'
      }, { status: 400 });
    }

    let access = registrationIdParam
      ? await assertRegistrationAccess(supabaseAdmin, request, {
        registrationId: registrationIdParam,
        eventId,
        accessToken
      })
      : null;

    const checkoutConfig = await resolveMercadoPagoCheckoutConfig(eventId);
    console.log(`[MercadoPago Status API] Usando credenciais ${checkoutConfig.source} do organizador ${checkoutConfig.organizerId} para o evento ${eventId}`);

    let paymentData: any = null;

    if (paymentId) {
      console.log(`[MercadoPago Status API] Buscando status do pagamento por ID: ${paymentId}`);
      const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: {
          'Authorization': `Bearer ${checkoutConfig.accessToken}`
        }
      });

      if (!response.ok) {
        console.error(`[MercadoPago Status API] Erro ao buscar pagamento ${paymentId} no Mercado Pago.`);
        return NextResponse.json({ error: 'Erro ao buscar status do pagamento.' }, { status: 500 });
      }

      paymentData = await response.json();
    } else if (registrationIdParam) {
      console.log(`[MercadoPago Status API] Conciliando pagamento por registration_id: ${registrationIdParam}`);

      // Busca a inscrição no banco de dados para ter os dados originais
      const { data: registration, error: regDbErr } = await supabaseAdmin
        .from('registrations')
        .select('*')
        .eq('id', registrationIdParam)
        .eq('event_id', eventId)
        .maybeSingle();

      if (regDbErr || !registration) {
        console.error(`[MercadoPago Status API] Inscrição ${registrationIdParam} não encontrada no banco:`, regDbErr);
        return NextResponse.json({ error: 'Inscrição não encontrada para conciliação.' }, { status: 404 });
      }

      // Consulta pagamentos recentes no Mercado Pago
      const mpUrl = "https://api.mercadopago.com/v1/payments/search?sort=date_created&criteria=desc&limit=50";
      const mpSearchResponse = await fetch(mpUrl, {
        headers: {
          'Authorization': `Bearer ${checkoutConfig.accessToken}`
        }
      });

      if (!mpSearchResponse.ok) {
        console.error(`[MercadoPago Status API] Erro ao buscar pagamentos recentes no Mercado Pago.`);
        return NextResponse.json({ error: 'Erro ao consultar transações no Mercado Pago.' }, { status: 500 });
      }

      const searchResult = await mpSearchResponse.json();
      const results = searchResult.results || [];

      // Procura transação que corresponda à inscrição no metadata ou dados do pagador
      let foundPayment = results.find((p: any) => {
        return p.metadata?.registration_id === registrationIdParam;
      });

      if (!foundPayment) {
        const emailToMatch = registration.athlete_email?.trim().toLowerCase();
        foundPayment = results.find((p: any) => {
          const payerEmail = p.payer?.email?.trim().toLowerCase();
          const amountMatches = Math.abs((p.transaction_amount || 0) - (registration.total_paid || 0)) < 0.1;
          const emailMatches = payerEmail === emailToMatch;
          return emailMatches && amountMatches && p.status === 'approved';
        });
      }

      if (!foundPayment) {
        console.log(`[MercadoPago Status API] Nenhum pagamento correspondente encontrado no Mercado Pago para a inscrição ${registrationIdParam}.`);
        return NextResponse.json({ status: 'pending', message: 'Nenhum pagamento correspondente localizado.' });
      }

      console.log(`[MercadoPago Status API] Pagamento correspondente localizado no Mercado Pago: ${foundPayment.id} (status: ${foundPayment.status})`);
      paymentData = foundPayment;
    }
    let registrationPayload = null;
    const registrationId = paymentData.metadata?.registration_id || registrationIdParam;
    if (!registrationId) {
      return NextResponse.json({ error: 'Pagamento sem inscricao vinculada.' }, { status: 404 });
    }

    if (!access || access.registration.id !== registrationId) {
      access = await assertRegistrationAccess(supabaseAdmin, request, {
        registrationId,
        eventId,
        accessToken
      });
    }

    await supabaseAdmin
      .from('registrations')
      .update({
        payment_status: toRegistrationPaymentStatus(paymentData.status),
        payment_method: paymentData.payment_method_id || null,
        payment_id: String(paymentData.id),
        payment_status_detail: paymentData.status_detail || null,
        payment_error_message: paymentData.status === 'rejected' ? 'Pagamento não processado.' : null,
        updated_at: new Date().toISOString()
      })
      .eq('id', registrationId)
      .eq('event_id', eventId);

    if (paymentData.status === 'approved') {
      await applyCouponUsageForApprovedRegistration(supabaseAdmin, registrationId);
    }

    try {
      const snapshot = await loadRegistrationCheckoutSnapshot(supabaseAdmin, registrationId);
      registrationPayload = {
        registrationData: snapshot.registrationData,
        athleteProfile: snapshot.athleteProfile
      };
    } catch (snapshotErr) {
      console.warn("[MercadoPago Status API] Nao foi possivel carregar snapshot da inscricao:", snapshotErr);
    }

    return NextResponse.json({
      status: paymentData.status,
      registrationData: registrationPayload?.registrationData || null,
      athleteProfile: registrationPayload?.athleteProfile || null,
      cpf: ''
    });

  } catch (err) {
    if (err instanceof RegistrationAccessError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof MercadoPagoConfigError) {
      console.error("[MercadoPago Status API] Erro de configuração:", err.message);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }

    console.error("[MercadoPago Status API] Erro interno na consulta de status:", err);
    return NextResponse.json({ error: 'Erro interno ao consultar status do pagamento.' }, { status: 500 });
  }
}
