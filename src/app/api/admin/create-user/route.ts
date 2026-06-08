import { NextResponse } from 'next/server';
import {
  createSupabaseAdmin,
  hashPassword,
  maskEmailForLog,
  requireSession
} from '@/lib/serverSecurity';

export async function POST(request: Request) {
  try {
    const auth = requireSession(request, ['owner']);
    if (auth.response) return auth.response;

    const body = await request.json();
    const { name, email, password, organization } = body;

    if (!name || !email || !password || !organization) {
      return NextResponse.json({ error: 'Todos os campos (name, email, password, organization) são obrigatórios.' }, { status: 400 });
    }

    const supabaseAdmin = createSupabaseAdmin();
    const normalizedEmail = String(email).trim().toLowerCase();
    console.log(`[API Admin CreateUser] Criando novo gestor: ${maskEmailForLog(normalizedEmail)}...`);

    // 1. Verificar se usuário com este e-mail já existe
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (existingUser) {
      return NextResponse.json({ error: 'Este e-mail já está cadastrado.' }, { status: 409 });
    }

    const newUserId = `org-${Date.now()}`;

    // 2. Inserir o perfil público na tabela users
    const { error: userError } = await supabaseAdmin
      .from('users')
      .insert({
        id: newUserId,
        name: name.trim(),
        email: normalizedEmail,
        role: 'manager',
        organization: organization.trim()
      });

    if (userError) {
      console.error('[API Admin CreateUser] Erro ao gravar perfil público:', userError);
      return NextResponse.json({ error: 'Erro ao cadastrar perfil do usuário.' }, { status: 500 });
    }

    // 3. Inserir a senha na tabela privada users_secrets
    const { error: secretError } = await supabaseAdmin
      .from('users_secrets')
      .insert({
        user_id: newUserId,
        password: hashPassword(String(password))
      });

    if (secretError) {
      console.error('[API Admin CreateUser] Erro ao gravar segredo:', secretError);
      // Rollback do perfil público criado anteriormente para manter consistência
      await supabaseAdmin.from('users').delete().eq('id', newUserId);
      return NextResponse.json({ error: 'Erro ao gravar credenciais de acesso.' }, { status: 500 });
    }

    console.log(`[API Admin CreateUser] Gestor criado com sucesso. ID: ${newUserId}`);
    return NextResponse.json({
      success: true,
      user: {
        id: newUserId,
        name: name.trim(),
        email: normalizedEmail,
        role: 'manager',
        organization: organization.trim()
      }
    });

  } catch (err) {
    console.error('[API Admin CreateUser] Erro crítico inesperado:', err);
    return NextResponse.json({ error: 'Erro crítico interno no servidor.' }, { status: 500 });
  }
}
