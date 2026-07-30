import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { MercadoPagoConfigError, resolveMercadoPagoRedirectUri } from '@/lib/mercadopagoServer';
import { ManagerAccessError, assertManagerOperationalAccess } from '@/lib/serverManagerAccess';
import {
  canActOnUser,
  createSupabaseAdmin,
  requireSession
} from '@/lib/serverSecurity';

export async function POST(request: Request) {
  const origin = request.headers.get('origin') || new URL(request.url).origin;
  const callbackId = randomUUID();
  try {
    const body = await request.json();
    const { code, state } = body;

    if (!code || !state) {
      console.error('[OAuth Callback] Parâmetros de callback inválidos. Code ou State ausentes.');
      return NextResponse.json({ error: 'Parâmetros de callback inválidos.' }, { status: 400 });
    }

    const supabaseAdmin = createSupabaseAdmin();

    // 1. Validar a sessão antes de consultar ou consumir o state de uso único.
    const auth = requireSession(request, ['manager', 'owner']);
    if (auth.response || !auth.user) {
      console.warn('[OAuth Callback] Sessão ausente ou inválida.', JSON.stringify({
        event: 'session_invalid',
        callbackId
      }));
      return auth.response || NextResponse.json({ error: 'Sessão inválida ou expirada.' }, { status: 401 });
    }

    await assertManagerOperationalAccess(supabaseAdmin, auth.user);

    // 2. Consultar o proprietário e a expiração. A remoção abaixo é a operação
    // atômica que de fato consome o state e protege contra callbacks concorrentes.
    const { data: stateData, error: dbStateError } = await supabaseAdmin
      .from('mercadopago_oauth_states')
      .select('user_id, expires_at')
      .eq('state', state)
      .maybeSingle();

    if (dbStateError) {
      console.error('[OAuth Callback] Falha ao consultar state OAuth.', JSON.stringify({
        event: 'state_lookup_failed',
        callbackId,
        errorCode: dbStateError.code || null,
        errorMessage: dbStateError.message || null
      }));
      return NextResponse.json({
        error: 'Não foi possível validar a autorização agora. Tente novamente. Se persistir, informe o código de atendimento.',
        reason: 'state_storage_error',
        callbackId
      }, { status: 500 });
    }

    if (!stateData) {
      console.warn('[OAuth Callback] State OAuth ausente ou já consumido.', JSON.stringify({
        event: 'state_not_found',
        callbackId,
        actorUserId: auth.user.id
      }));
      return NextResponse.json({
        error: 'A autorização não é mais válida ou já foi utilizada. Inicie uma nova conexão com o Mercado Pago.',
        reason: 'state_not_found',
        callbackId
      }, { status: 400 });
    }

    const userId = stateData.user_id;
    if (!canActOnUser(auth.user, userId)) {
      console.warn('[OAuth Callback] State não pertence ao gestor autenticado.', JSON.stringify({
        event: 'state_owner_mismatch',
        callbackId,
        actorUserId: auth.user.id,
        stateOwnerId: userId
      }));
      return NextResponse.json({ error: 'Acesso negado para este gestor.' }, { status: 403 });
    }

    const now = new Date();
    const stateExpiresAt = new Date(stateData.expires_at);
    if (now > stateExpiresAt) {
      const { error: cleanupError } = await supabaseAdmin
        .from('mercadopago_oauth_states')
        .delete()
        .eq('state', state)
        .eq('user_id', userId);
      console.warn('[OAuth Callback] State OAuth expirado.', JSON.stringify({
        event: 'state_expired',
        callbackId,
        actorUserId: auth.user.id,
        cleanupFailed: Boolean(cleanupError)
      }));
      return NextResponse.json({
        error: 'A sessão de autorização expirou. Inicie uma nova conexão com o Mercado Pago.',
        reason: 'state_expired',
        callbackId
      }, { status: 400 });
    }

    // 3. Consumo atômico: somente um callback válido, do proprietário e dentro
    // do prazo recebe o verifier PKCE. Uma requisição concorrente não recebe linha.
    const { data: consumedState, error: consumeError } = await supabaseAdmin
      .from('mercadopago_oauth_states')
      .delete()
      .eq('state', state)
      .eq('user_id', userId)
      .gt('expires_at', now.toISOString())
      .select('user_id, code_verifier')
      .maybeSingle();

    if (consumeError) {
      console.error('[OAuth Callback] Falha ao consumir state OAuth.', JSON.stringify({
        event: 'state_consume_failed',
        callbackId,
        errorCode: consumeError.code || null,
        errorMessage: consumeError.message || null
      }));
      return NextResponse.json({
        error: 'Não foi possível concluir a autorização agora. Tente novamente. Se persistir, informe o código de atendimento.',
        reason: 'state_consume_error',
        callbackId
      }, { status: 500 });
    }

    if (!consumedState) {
      console.warn('[OAuth Callback] State OAuth consumido por outra tentativa.', JSON.stringify({
        event: 'state_already_consumed',
        callbackId,
        actorUserId: auth.user.id
      }));
      return NextResponse.json({
        error: 'A autorização já foi utilizada em outra tentativa. Inicie uma nova conexão com o Mercado Pago.',
        reason: 'state_already_consumed',
        callbackId
      }, { status: 409 });
    }

    const clientId = process.env.MERCADOPAGO_CLIENT_ID;
    const clientSecret = process.env.MERCADOPAGO_CLIENT_SECRET;
    const redirectUri = resolveMercadoPagoRedirectUri(origin);

    if (!clientId || !clientSecret) {
      console.error('[OAuth Callback] Variáveis de ambiente MERCADOPAGO_CLIENT_ID ou MERCADOPAGO_CLIENT_SECRET não configuradas.');
      return NextResponse.json({ error: 'Credenciais do aplicativo Mercado Pago não configuradas no servidor.' }, { status: 500 });
    }

    const codeVerifier = consumedState.code_verifier as string | null | undefined;
    console.log('[OAuth Callback] Iniciando troca de token.', JSON.stringify({
      event: 'token_exchange_started',
      callbackId,
      actorUserId: auth.user.id,
      stateOwnerId: userId,
      hasPkce: Boolean(codeVerifier),
      redirectUri
    }));

    const tokenParams: Record<string, string> = {
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: redirectUri,
    };

    if (codeVerifier) {
      tokenParams.code_verifier = codeVerifier;
    }

    const mpResponse = await fetch('https://api.mercadopago.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'accept': 'application/json'
      },
      body: new URLSearchParams(tokenParams).toString()
    });

    if (!mpResponse.ok) {
      const errorData = await mpResponse.json();
      const mpErrorCode = errorData?.error || 'unknown';
      const mpErrorMessage = errorData?.message || errorData?.cause?.[0]?.description || '';
      console.error('[OAuth Callback] Erro retornado pela API do Mercado Pago.', JSON.stringify({
        event: 'token_exchange_failed',
        callbackId,
        errorCode: mpErrorCode,
        errorMessage: mpErrorMessage || null,
        redirectUri
      }));
      return NextResponse.json({
        error: 'Erro de comunicação com o Mercado Pago.',
        detail: mpErrorCode,
        message: mpErrorMessage || undefined,
        callbackId
      }, { status: 400 });
    }

    const tokenData = await mpResponse.json();
    const expiresIn = Number(tokenData.expires_in || 15552000); // Default de 180 dias
    const connectedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    console.log('[OAuth Callback] Token obtido; persistindo conexão.', JSON.stringify({
      event: 'token_exchange_succeeded',
      callbackId,
      stateOwnerId: userId
    }));

    // 1. Gravar dados públicos
    const { error: dbPublicError } = await supabaseAdmin
      .from('mercadopago_accounts')
      .upsert({
        user_id: userId,
        mercadopago_user_id: String(tokenData.user_id),
        public_key: tokenData.public_key,
        expires_at: expiresAt,
        oauth_client_id: clientId,
        oauth_verified_at: connectedAt,
        status: 'connected',
        updated_at: connectedAt
      }, { onConflict: 'user_id' });

    if (dbPublicError) {
      console.error('[OAuth Callback] Erro ao gravar dados públicos no Supabase:', dbPublicError);
      return NextResponse.json({ error: 'Erro ao gravar dados de pagamento no banco de dados.' }, { status: 500 });
    }

    // 2. Gravar segredos na tabela privada
    const { error: dbSecretError } = await supabaseAdmin
      .from('mercadopago_secrets')
      .upsert({
        user_id: userId,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });

    if (dbSecretError) {
      console.error('[OAuth Callback] Erro ao gravar segredos no Supabase:', dbSecretError);
      // Remove a conta pública recém-criada para manter consistência
      await supabaseAdmin.from('mercadopago_accounts').delete().eq('user_id', userId);
      return NextResponse.json({ error: 'Erro ao gravar credenciais de pagamento privadas no banco de dados.' }, { status: 500 });
    }

    console.log('[OAuth Callback] Conta Mercado Pago conectada.', JSON.stringify({
      event: 'oauth_connected',
      callbackId,
      stateOwnerId: userId
    }));
    return NextResponse.json({ success: true });

  } catch (err) {
    if (err instanceof ManagerAccessError) {
      return NextResponse.json({ error: 'O período de uso da plataforma expirou.' }, { status: 403 });
    }
    if (err instanceof MercadoPagoConfigError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[OAuth Callback] Erro crítico inesperado no processamento do callback.', JSON.stringify({
      event: 'callback_unexpected_error',
      callbackId,
      errorName: err instanceof Error ? err.name : 'unknown',
      errorMessage: err instanceof Error ? err.message : String(err)
    }));
    return NextResponse.json({ error: 'Erro crítico interno no servidor.', callbackId }, { status: 500 });
  }
}
