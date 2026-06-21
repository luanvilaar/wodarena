import { NextResponse } from 'next/server';
import { ManagerAccessError, assertManagerOperationalAccess, managerAccessErrorResponse } from '@/lib/serverManagerAccess';
import {
  canActOnUser,
  createSupabaseAdmin,
  loadUserById,
  requireSession
} from '@/lib/serverSecurity';

type SupabaseWriteError = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

const isMercadoPagoUserIdUniqueError = (error: SupabaseWriteError) => {
  const detail = `${error.code || ''} ${error.message || ''} ${error.details || ''} ${error.hint || ''}`;
  return error.code === '23505' && detail.includes('mercadopago_user_id');
};

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

    const { data, error } = await supabaseAdmin
      .from('mercadopago_accounts')
      .select('id, mercadopago_user_id, status, public_key')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      console.error('[API Admin MercadoPago GET] Erro ao buscar conta Mercado Pago:', error);
      return NextResponse.json({ error: 'Erro ao buscar conta Mercado Pago.' }, { status: 500 });
    }

    return NextResponse.json({ account: data || null });
  } catch (err) {
    if (err instanceof ManagerAccessError) {
      return managerAccessErrorResponse(err);
    }
    console.error('[API Admin MercadoPago GET] Erro crítico inesperado:', err);
    return NextResponse.json({ error: 'Erro crítico interno no servidor.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const auth = requireSession(request, ['manager', 'owner']);
    if (auth.response) return auth.response;
    const actor = auth.user;
    const supabaseAdmin = createSupabaseAdmin();
    await assertManagerOperationalAccess(supabaseAdmin, actor);

    const body = await request.json();
    const { publicKey, accessToken } = body;
    const userId = actor.id;

    if (!publicKey || !accessToken) {
      return NextResponse.json({ error: 'Parâmetros publicKey e accessToken são obrigatórios.' }, { status: 400 });
    }

    const checkUser = await loadUserById(supabaseAdmin, userId);
    if (!checkUser) {
      return NextResponse.json({ error: 'Usuário inválido ou não encontrado.' }, { status: 403 });
    }

    if (checkUser.role !== 'manager' && checkUser.role !== 'owner') {
      return NextResponse.json({ error: 'Acesso negado. Apenas gestores podem configurar chaves de pagamento.' }, { status: 403 });
    }

    let tokenToSave = accessToken;
    if (accessToken === '••••••••••••••••') {
      const { data: existing } = await supabaseAdmin
        .from('mercadopago_secrets')
        .select('access_token')
        .eq('user_id', userId)
        .maybeSingle();

      if (!existing?.access_token) {
        return NextResponse.json({ error: 'Nenhuma credencial anterior encontrada. Por favor, insira o Access Token completo.' }, { status: 400 });
      }
      tokenToSave = existing.access_token;
    }

    const mpUserResponse = await fetch('https://api.mercadopago.com/users/me', {
      headers: {
        'Authorization': `Bearer ${tokenToSave}`
      }
    });

    if (!mpUserResponse.ok) {
      const errorData = await mpUserResponse.json().catch(() => null);
      console.error('[API Admin MercadoPago] Access Token inválido ou sem acesso a /users/me:', errorData);
      return NextResponse.json({ error: 'Access Token Mercado Pago inválido. Verifique a credencial informada.' }, { status: 400 });
    }

    const mpUserData = await mpUserResponse.json();
    const mercadopagoUserId = mpUserData?.id ? String(mpUserData.id) : `manual-${userId}`;

    console.log(`[API Admin MercadoPago] Salvando credenciais de forma segura para o gestor: ${userId}...`);

    // 1. Gravar informações públicas
    const { data: publicData, error: publicError } = await supabaseAdmin
      .from('mercadopago_accounts')
      .upsert({
        user_id: userId,
        public_key: publicKey,
        status: 'connected',
        mercadopago_user_id: mercadopagoUserId,
        expires_at: new Date('2099-12-31T23:59:59Z').toISOString(),
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' })
      .select('user_id, public_key, status')
      .single();

    if (publicError) {
      console.error('[API Admin MercadoPago] Erro ao gravar informações públicas no Supabase:', publicError);
      if (isMercadoPagoUserIdUniqueError(publicError)) {
        return NextResponse.json({
          error: 'Esta conta Mercado Pago já existe em outro cadastro. Aplique a migration mais recente do Supabase para permitir reutilizar a mesma conta em gestores diferentes.'
        }, { status: 409 });
      }
      return NextResponse.json({ error: 'Erro ao gravar informações públicas no banco de dados.' }, { status: 500 });
    }

    // 2. Gravar segredos na tabela privada
    const { error: secretError } = await supabaseAdmin
      .from('mercadopago_secrets')
      .upsert({
        user_id: userId,
        access_token: tokenToSave,
        refresh_token: 'manual',
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });

    if (secretError) {
      console.error('[API Admin MercadoPago] Erro ao gravar segredos no Supabase:', secretError);
      return NextResponse.json({ error: 'Erro ao gravar credenciais privadas no banco de dados.' }, { status: 500 });
    }

    console.log(`[API Admin MercadoPago] Credenciais salvas com sucesso para o usuário ${userId}`);
    return NextResponse.json({ success: true, account: publicData });

  } catch (err) {
    if (err instanceof ManagerAccessError) {
      return managerAccessErrorResponse(err);
    }
    console.error('[API Admin MercadoPago] Erro crítico inesperado:', err);
    return NextResponse.json({ error: 'Erro crítico interno no servidor.' }, { status: 500 });
  }
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
