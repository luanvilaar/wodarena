import { NextResponse } from 'next/server';
import { sendRegistrationEmail } from '@/lib/resend';
import { assertRegistrationAccess, RegistrationAccessError } from '@/lib/serverCheckout';
import { loadRegistrationConfirmation } from '@/lib/serverRegistrationConfirmation';
import { checkRateLimit, createSupabaseAdmin, getClientIp } from '@/lib/serverSecurity';

const supabaseAdmin = createSupabaseAdmin();

// Segunda via do comprovante (painel do gestor e área do atleta). O e-mail da
// confirmação sai do servidor quando o pagamento é aprovado (Story 1.76): o navegador
// não dispara mais esta rota no sucesso da inscrição.
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { registrationId, accessToken } = body;

    if (!registrationId) {
      return NextResponse.json({ error: 'Parâmetro registrationId obrigatório.' }, { status: 400 });
    }

    const rateLimited = checkRateLimit({
      key: `checkout-email:${getClientIp(request)}:${registrationId}`,
      limit: 3,
      windowMs: 60 * 60 * 1000
    });
    if (rateLimited) return rateLimited;

    console.log(`[Email API Endpoint] Processando solicitação para inscrição ${registrationId}...`);

    await assertRegistrationAccess(supabaseAdmin, request, {
      registrationId,
      accessToken
    });

    const loaded = await loadRegistrationConfirmation(supabaseAdmin, registrationId);
    if (!loaded.ok) {
      console.warn(`[Email API Endpoint] Inscrição ${registrationId} não carregada: ${loaded.error}`);
      return NextResponse.json({ error: loaded.error }, { status: loaded.status });
    }

    const { registration, event, athlete } = loaded;
    if (registration.paymentStatus !== 'payment_approved') {
      return NextResponse.json({ error: 'Comprovante disponível apenas após confirmação do pagamento.' }, { status: 403 });
    }

    // Segunda via: sem chave de idempotência, cada pedido do gestor envia de novo.
    const emailResult = await sendRegistrationEmail(registration, athlete, event, registration.locale || event.defaultLocale);

    if (!emailResult.success) {
      console.error(`[Email API Endpoint] Falha no disparo de e-mail:`, emailResult.error);
      return NextResponse.json({ success: false, error: emailResult.error }, { status: 500 });
    }

    return NextResponse.json({ success: true, messageId: emailResult.messageId });
  } catch (err) {
    if (err instanceof RegistrationAccessError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[Email API Endpoint] Erro crítico no endpoint de e-mail:', err);
    return NextResponse.json({ error: 'Erro crítico interno no servidor.' }, { status: 500 });
  }
}
