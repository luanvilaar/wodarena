import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { createSupabaseAdmin, hashPassword } from '@/lib/serverSecurity';

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export async function POST(request: Request) {
  try {
    const { token, newPassword } = await request.json();
    const rawToken = String(token || '');
    const password = String(newPassword || '');

    if (!rawToken || !password) {
      return NextResponse.json({ error: 'Token e nova senha são obrigatórios.' }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json({ error: 'A nova senha deve ter pelo menos 6 caracteres.' }, { status: 400 });
    }

    const supabaseAdmin = createSupabaseAdmin();

    const tokenHash = hashToken(rawToken);
    const { data: resetToken, error: tokenError } = await supabaseAdmin
      .from('password_reset_tokens')
      .select('token_hash, user_id, expires_at, used_at')
      .eq('token_hash', tokenHash)
      .maybeSingle();

    if (tokenError) {
      console.error('[API Auth ResetPassword] Erro ao buscar token:', tokenError);
      return NextResponse.json({ error: 'Erro ao validar token.' }, { status: 500 });
    }

    if (!resetToken || resetToken.used_at || new Date(resetToken.expires_at).getTime() < Date.now()) {
      return NextResponse.json({ error: 'Link de recuperação inválido ou expirado.' }, { status: 400 });
    }

    const { error: secretError } = await supabaseAdmin
      .from('users_secrets')
      .upsert({
        user_id: resetToken.user_id,
        password: hashPassword(password)
      }, { onConflict: 'user_id' });

    if (secretError) {
      console.error('[API Auth ResetPassword] Erro ao salvar nova senha:', secretError);
      return NextResponse.json({ error: 'Erro ao salvar a nova senha.' }, { status: 500 });
    }

    const { error: consumeError } = await supabaseAdmin
      .from('password_reset_tokens')
      .update({ used_at: new Date().toISOString() })
      .eq('token_hash', tokenHash);

    if (consumeError) {
      console.error('[API Auth ResetPassword] Erro ao invalidar token:', consumeError);
      return NextResponse.json({ error: 'Senha alterada, mas houve erro ao invalidar o link.' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[API Auth ResetPassword] Erro crítico:', err);
    return NextResponse.json({ error: 'Erro interno ao redefinir senha.' }, { status: 500 });
  }
}
