import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://momigbtnsswoldqnadmc.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function POST(request: Request) {
  try {
    if (!supabaseServiceKey) {
      console.error('[API Auth ChangePassword] SUPABASE_SERVICE_ROLE_KEY não configurada no servidor.');
      return NextResponse.json({ error: 'Configuração do servidor ausente.' }, { status: 500 });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const body = await request.json();
    const { userId, currentPassword, newPassword } = body;

    if (!userId || !currentPassword || !newPassword) {
      return NextResponse.json({ error: 'Parâmetros userId, currentPassword e newPassword são obrigatórios.' }, { status: 400 });
    }

    console.log(`[API Auth ChangePassword] Processando alteração de senha para o usuário: ${userId}...`);

    // 1. Obter a senha atual da tabela privada
    const { data: secret, error: secretError } = await supabaseAdmin
      .from('users_secrets')
      .select('password')
      .eq('user_id', userId)
      .maybeSingle();

    if (secretError || !secret) {
      console.error(`[API Auth ChangePassword] Usuário ou segredo não encontrado para ID ${userId}`);
      return NextResponse.json({ error: 'Usuário não encontrado.' }, { status: 404 });
    }

    // 2. Validar senha atual
    if (secret.password !== currentPassword) {
      console.warn(`[API Auth ChangePassword] Tentativa de alteração frustrada. Senha atual incorreta para o usuário ${userId}`);
      return NextResponse.json({ error: 'A senha atual está incorreta.' }, { status: 401 });
    }

    // 3. Atualizar a nova senha na tabela privada
    const { error: updateError } = await supabaseAdmin
      .from('users_secrets')
      .update({ password: newPassword })
      .eq('user_id', userId);

    if (updateError) {
      console.error(`[API Auth ChangePassword] Erro ao gravar nova senha para usuário ${userId}:`, updateError);
      return NextResponse.json({ error: 'Erro ao salvar a nova senha.' }, { status: 500 });
    }

    console.log(`[API Auth ChangePassword] Senha atualizada com sucesso para usuário ${userId}`);
    return NextResponse.json({ success: true });

  } catch (err) {
    console.error('[API Auth ChangePassword] Erro crítico inesperado:', err);
    return NextResponse.json({ error: 'Erro crítico interno no servidor.' }, { status: 500 });
  }
}
