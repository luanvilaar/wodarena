import { NextResponse } from 'next/server';
import {
  canActOnUser,
  createSupabaseAdmin,
  hashPassword,
  requireSession,
  verifyPassword
} from '@/lib/serverSecurity';

export async function POST(request: Request) {
  try {
    const auth = requireSession(request);
    if (auth.response) return auth.response;
    const actor = auth.user;

    const body = await request.json();
    const { userId, currentPassword, newPassword } = body;

    if (!userId || !currentPassword || !newPassword) {
      return NextResponse.json({ error: 'Parâmetros userId, currentPassword e newPassword são obrigatórios.' }, { status: 400 });
    }

    if (!canActOnUser(actor, userId)) {
      return NextResponse.json({ error: 'Acesso negado para alterar esta senha.' }, { status: 403 });
    }

    const supabaseAdmin = createSupabaseAdmin();
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
    const passwordCheck = verifyPassword(String(currentPassword), secret.password);
    if (!passwordCheck.valid) {
      console.warn(`[API Auth ChangePassword] Tentativa de alteração frustrada. Senha atual incorreta para o usuário ${userId}`);
      return NextResponse.json({ error: 'A senha atual está incorreta.' }, { status: 401 });
    }

    // 3. Atualizar a nova senha na tabela privada
    const { error: updateError } = await supabaseAdmin
      .from('users_secrets')
      .update({ password: hashPassword(String(newPassword)) })
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
