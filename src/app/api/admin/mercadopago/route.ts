import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://momigbtnsswoldqnadmc.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function POST(request: Request) {
  try {
    if (!supabaseServiceKey) {
      console.error('[API Admin MercadoPago] SUPABASE_SERVICE_ROLE_KEY não configurada no servidor.');
      return NextResponse.json({ error: 'Configuração do servidor ausente.' }, { status: 500 });
    }

    // Inicializa o cliente do Supabase com privilégios administrativos (bypassa RLS)
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const body = await request.json();
    const { userId, publicKey, accessToken } = body;

    if (!userId || !publicKey || !accessToken) {
      return NextResponse.json({ error: 'Parâmetros userId, publicKey e accessToken são obrigatórios.' }, { status: 400 });
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
    console.error('[API Admin MercadoPago] Erro crítico inesperado:', err);
    return NextResponse.json({ error: 'Erro crítico interno no servidor.' }, { status: 500 });
  }
}
