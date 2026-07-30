import { NextResponse } from 'next/server';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { MercadoPagoConfigError, resolveMercadoPagoRedirectUri } from '@/lib/mercadopagoServer';
import { ManagerAccessError, assertManagerOperationalAccess, managerAccessErrorResponse } from '@/lib/serverManagerAccess';
import {
  canActOnUser,
  createSupabaseAdmin,
  loadUserById,
  requireSession
} from '@/lib/serverSecurity';

export async function GET(request: Request) {
  try {
    const auth = requireSession(request, ['manager', 'owner']);
    if (auth.response) return auth.response;
    const actor = auth.user;
    const supabaseAdmin = createSupabaseAdmin();
    await assertManagerOperationalAccess(supabaseAdmin, actor);

    const { searchParams } = new URL(request.url);
    const requestedUserId = searchParams.get('userId');
    const userId = requestedUserId || actor.id;

    if (!canActOnUser(actor, userId)) {
      return NextResponse.json({ error: 'Acesso negado para este gestor.' }, { status: 403 });
    }

    const checkUser = await loadUserById(supabaseAdmin, userId);
    if (!checkUser || (checkUser.role !== 'manager' && checkUser.role !== 'owner')) {
      return NextResponse.json({ error: 'Usuário inválido ou sem permissão.' }, { status: 403 });
    }

    const action = searchParams.get('action');
    if (action === 'oauth_url') {
      const clientId = process.env.MERCADOPAGO_CLIENT_ID;
      const origin = request.headers.get('origin') || new URL(request.url).origin;

      if (!clientId) {
        console.error('[API Admin MercadoPago GET] Erro de configuracao: MERCADOPAGO_CLIENT_ID nao esta definido nas variaveis de ambiente.');
        return NextResponse.json({ error: 'A conexao automatica do Mercado Pago nao esta configurada no servidor da plataforma.' }, { status: 500 });
      }

      const redirectUri = resolveMercadoPagoRedirectUri(origin);

      // PKCE: gera code_verifier (32 bytes aleatórios) e code_challenge (SHA-256 do verifier)
      const codeVerifierBytes = randomBytes(32);
      const codeVerifier = codeVerifierBytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
      const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

      const state = randomUUID();
      const { error: stateError } = await supabaseAdmin
        .from('mercadopago_oauth_states')
        .insert({
          state: state,
          user_id: userId,
          code_verifier: codeVerifier
        });

      if (stateError) {
        console.error('[API Admin MercadoPago GET] Erro ao gravar oauth state no banco:', stateError);
        return NextResponse.json({ error: 'Erro interno ao iniciar o fluxo de autenticação.' }, { status: 500 });
      }

      const oauthUrl = `https://auth.mercadopago.com.br/authorization?client_id=${clientId}&response_type=code&platform_id=mp&state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}&code_challenge=${codeChallenge}&code_challenge_method=S256`;
      console.log(`[API Admin MercadoPago GET] OAuth URL gerada com PKCE para o gestor ${userId}. redirect_uri=${redirectUri}`);
      return NextResponse.json({ url: oauthUrl });
    }

    const { data, error } = await supabaseAdmin
      .from('mercadopago_accounts')
      .select('id, mercadopago_user_id, status, public_key')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      console.error('[API Admin MercadoPago GET] Erro ao buscar conta Mercado Pago:', error);
      return NextResponse.json({ error: 'Erro ao buscar conta Mercado Pago.' }, { status: 500 });
    }

    const { data: secret, error: secretError } = await supabaseAdmin
      .from('mercadopago_secrets')
      .select('refresh_token')
      .eq('user_id', userId)
      .maybeSingle<{ refresh_token: string | null }>();

    if (secretError) {
      console.error('[API Admin MercadoPago GET] Erro ao classificar conexão:', secretError);
      return NextResponse.json({ error: 'Erro ao buscar conta Mercado Pago.' }, { status: 500 });
    }

    return NextResponse.json({
      account: data ? {
        ...data,
        connectionType: secret?.refresh_token === 'manual' ? 'manual' : 'oauth'
      } : null
    });
  } catch (err) {
    if (err instanceof ManagerAccessError) {
      return managerAccessErrorResponse(err);
    }
    if (err instanceof MercadoPagoConfigError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[API Admin MercadoPago GET] Erro crítico inesperado:', err);
    return NextResponse.json({ error: 'Erro crítico interno no servidor.' }, { status: 500 });
  }
}

export async function POST() {
  return NextResponse.json({
    error: 'Credenciais manuais não são aceitas. Conecte a conta Mercado Pago via OAuth para receber inscrições com a taxa de serviço WODArena.'
  }, { status: 410 });
}

export async function DELETE(request: Request) {
  try {
    const auth = requireSession(request, ['manager', 'owner']);
    if (auth.response) return auth.response;
    const actor = auth.user;
    const supabaseAdmin = createSupabaseAdmin();
    await assertManagerOperationalAccess(supabaseAdmin, actor);

    const body = await request.json();
    const { userId: requestedUserId } = body;
    const userId = requestedUserId || actor.id;

    if (!canActOnUser(actor, userId)) {
      return NextResponse.json({ error: 'Acesso negado para este gestor.' }, { status: 403 });
    }

    const checkUser = await loadUserById(supabaseAdmin, userId);
    if (!checkUser) {
      return NextResponse.json({ error: 'Usuário inválido ou não encontrado.' }, { status: 403 });
    }

    if (checkUser.role !== 'manager' && checkUser.role !== 'owner') {
      return NextResponse.json({ error: 'Acesso negado. Apenas gestores podem configurar chaves de pagamento.' }, { status: 403 });
    }

    console.log(`[API Admin MercadoPago DELETE] Desconectando conta Mercado Pago do gestor: ${userId}...`);

    // 1. Atualiza dados públicos na tabela pública
    const { error: publicError } = await supabaseAdmin
      .from('mercadopago_accounts')
      .update({
        public_key: '',
        status: 'disconnected',
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId);

    if (publicError) {
      console.error('[API Admin MercadoPago DELETE] Erro ao limpar mercadopago_accounts:', publicError);
      return NextResponse.json({ error: 'Erro ao desconectar conta pública no banco de dados.' }, { status: 500 });
    }

    // 2. Limpa segredos na tabela privada
    const { error: secretError } = await supabaseAdmin
      .from('mercadopago_secrets')
      .delete()
      .eq('user_id', userId);

    if (secretError) {
      console.error('[API Admin MercadoPago DELETE] Erro ao remover segredos de mercadopago_secrets:', secretError);
      return NextResponse.json({ error: 'Erro ao desconectar credenciais privadas no banco de dados.' }, { status: 500 });
    }

    console.log(`[API Admin MercadoPago DELETE] Conta desconectada com sucesso para o usuário ${userId}`);
    return NextResponse.json({ success: true });

  } catch (err) {
    if (err instanceof ManagerAccessError) {
      return managerAccessErrorResponse(err);
    }
    console.error('[API Admin MercadoPago DELETE] Erro crítico inesperado:', err);
    return NextResponse.json({ error: 'Erro crítico interno no servidor.' }, { status: 500 });
  }
}
