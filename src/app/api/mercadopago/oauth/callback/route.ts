import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET(request: Request) {
  const origin = request.headers.get('origin') || new URL(request.url).origin;
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const userId = searchParams.get('state'); // O state deve carregar o ID do gestor autenticado

    if (!code || !userId) {
      console.error('[OAuth Callback] Parâmetros de callback inválidos. Code ou User ID ausentes.');
      return NextResponse.redirect(`${origin}/admin?tab=payments&error=oauth_failed`);
    }

    const clientId = process.env.MERCADOPAGO_CLIENT_ID;
    const clientSecret = process.env.MERCADOPAGO_CLIENT_SECRET;
    const redirectUri = process.env.MERCADOPAGO_REDIRECT_URI || `${origin}/api/mercadopago/oauth/callback`;

    if (!clientId || !clientSecret) {
      console.error('[OAuth Callback] Variáveis de ambiente MERCADOPAGO_CLIENT_ID ou MERCADOPAGO_CLIENT_SECRET não configuradas.');
      return NextResponse.redirect(`${origin}/admin?tab=payments&error=critical_error`);
    }

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
      console.error('[OAuth Callback] Erro retornado pela API do Mercado Pago:', errorData);
      return NextResponse.redirect(`${origin}/admin?tab=payments&error=oauth_mp_error`);
    }

    const tokenData = await mpResponse.json();
    const expiresIn = Number(tokenData.expires_in || 15552000); // Default de 180 dias
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    console.log(`[OAuth Callback] Token obtido. Gravando na tabela mercadopago_accounts para o usuário: ${userId}...`);

    const { error: dbError } = await supabase
      .from('mercadopago_accounts')
      .upsert({
        user_id: userId,
        mercadopago_user_id: String(tokenData.user_id),
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        public_key: tokenData.public_key,
        expires_at: expiresAt,
        status: 'connected',
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });

    if (dbError) {
      console.error('[OAuth Callback] Erro ao gravar conta no Supabase:', dbError);
      return NextResponse.redirect(`${origin}/admin?tab=payments&error=db_error`);
    }

    console.log(`[OAuth Callback] Conta Mercado Pago do gestor ${userId} conectada com sucesso.`);
    return NextResponse.redirect(`${origin}/admin?tab=payments&success=mp_connected`);

  } catch (err) {
    console.error('[OAuth Callback] Erro crítico inesperado no processamento do callback:', err);
    return NextResponse.redirect(`${origin}/admin?tab=payments&error=critical_error`);
  }
}
