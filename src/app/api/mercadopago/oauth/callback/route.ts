import { NextResponse } from 'next/server';
import { MercadoPagoConfigError, resolveMercadoPagoRedirectUri } from '@/lib/mercadopagoServer';
import { ManagerAccessError, assertManagerOperationalAccess } from '@/lib/serverManagerAccess';
import {
  canActOnUser,
  createSupabaseAdmin,
  requireSession
} from '@/lib/serverSecurity';

export async function POST(request: Request) {
  const origin = request.headers.get('origin') || new URL(request.url).origin;
  try {
    const body = await request.json();
    const { code, state } = body;

    if (!code || !state) {
      console.error('[OAuth Callback] Parâmetros de callback inválidos. Code ou State ausentes.');
      return NextResponse.json({ error: 'Parâmetros de callback inválidos.' }, { status: 400 });
    }

    const supabaseAdmin = createSupabaseAdmin();

    // 1. Buscar e validar o state na tabela mercadopago_oauth_states
    const { data: stateData, error: dbStateError } = await supabaseAdmin
      .from('mercadopago_oauth_states')
      .select('user_id, expires_at')
      .eq('state', state)
      .maybeSingle();

    if (dbStateError || !stateData) {
      console.error('[OAuth Callback] State inválido ou não encontrado no banco:', state);
      return NextResponse.json({ error: 'Sessão de autorização inválida ou não encontrada.' }, { status: 400 });
    }

    const now = new Date();
    const stateExpiresAt = new Date(stateData.expires_at);
    if (now > stateExpiresAt) {
      console.error('[OAuth Callback] State expirado.');
      // Deleta o state expirado para limpeza
      await supabaseAdmin.from('mercadopago_oauth_states').delete().eq('state', state);
      return NextResponse.json({ error: 'A sessão de autorização expirou.' }, { status: 400 });
    }

    // Deleta o state imediatamente para evitar reuso (idempotência)
    await supabaseAdmin.from('mercadopago_oauth_states').delete().eq('state', state);

    const userId = stateData.user_id;

    // 2. Validar sessão do usuário que faz a requisição local POST
    const auth = requireSession(request, ['manager', 'owner']);
    if (auth.response || !auth.user || !canActOnUser(auth.user, userId)) {
      console.error('[OAuth Callback] Sessao invalida ou state nao pertence ao usuario autenticado.');
      return NextResponse.json({ error: 'Acesso negado para este gestor.' }, { status: 403 });
    }

    const clientId = process.env.MERCADOPAGO_CLIENT_ID;
    const clientSecret = process.env.MERCADOPAGO_CLIENT_SECRET;
    const redirectUri = resolveMercadoPagoRedirectUri(origin);

    if (!clientId || !clientSecret) {
      console.error('[OAuth Callback] Variáveis de ambiente MERCADOPAGO_CLIENT_ID ou MERCADOPAGO_CLIENT_SECRET não configuradas.');
      return NextResponse.json({ error: 'Credenciais do aplicativo Mercado Pago não configuradas no servidor.' }, { status: 500 });
    }

    await assertManagerOperationalAccess(supabaseAdmin, auth.user);

    console.log(`[OAuth Callback] Iniciando troca de token para o gestor: ${userId}...`);

    const mpResponse = await fetch('https://api.mercadopago.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'accept': 'application/json'
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirectUri
      })
    });

    if (!mpResponse.ok) {
      const errorData = await mpResponse.json();
      const mpErrorCode = errorData?.error || 'unknown';
      const mpErrorMessage = errorData?.message || errorData?.cause?.[0]?.description || '';
      console.error('[OAuth Callback] Erro retornado pela API do Mercado Pago:', errorData);
      console.error(`[OAuth Callback] Código do erro MP: ${mpErrorCode}. Mensagem: ${mpErrorMessage}`);
      return NextResponse.json({
        error: 'Erro de comunicação com o Mercado Pago.',
        detail: mpErrorCode
      }, { status: 400 });
    }

    const tokenData = await mpResponse.json();
    const expiresIn = Number(tokenData.expires_in || 15552000); // Default de 180 dias
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    console.log(`[OAuth Callback] Token obtido. Gravando na tabela mercadopago_accounts para o usuário: ${userId}...`);

    // 1. Gravar dados públicos
    const { error: dbPublicError } = await supabaseAdmin
      .from('mercadopago_accounts')
      .upsert({
        user_id: userId,
        mercadopago_user_id: String(tokenData.user_id),
        public_key: tokenData.public_key,
        expires_at: expiresAt,
        status: 'connected',
        updated_at: new Date().toISOString()
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

    console.log(`[OAuth Callback] Conta Mercado Pago do gestor ${userId} conectada com sucesso.`);
    return NextResponse.json({ success: true });

  } catch (err) {
    if (err instanceof ManagerAccessError) {
      return NextResponse.json({ error: 'O período de uso da plataforma expirou.' }, { status: 403 });
    }
    if (err instanceof MercadoPagoConfigError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[OAuth Callback] Erro crítico inesperado no processamento do callback:', err);
    return NextResponse.json({ error: 'Erro crítico interno no servidor.' }, { status: 500 });
  }
}
