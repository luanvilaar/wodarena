import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://momigbtnsswoldqnadmc.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function POST(request: Request) {
  try {
    if (!supabaseServiceKey) {
      console.error('[API Admin CreateUser] SUPABASE_SERVICE_ROLE_KEY não configurada no servidor.');
      return NextResponse.json({ error: 'Configuração do servidor ausente.' }, { status: 500 });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const body = await request.json();
    const { name, email, password, organization } = body;

    if (!name || !email || !password || !organization) {
      return NextResponse.json({ error: 'Todos os campos (name, email, password, organization) são obrigatórios.' }, { status: 400 });
    }

    console.log(`[API Admin CreateUser] Criando novo gestor: ${email}...`);

    // 1. Verificar se usuário com este e-mail já existe
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', email.trim())
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
        email: email.trim().toLowerCase(),
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
        password: password
      });

    if (secretError) {
      console.error('[API Admin CreateUser] Erro ao gravar segredo:', secretError);
      // Rollback do perfil público criado anteriormente para manter consistência
      await supabaseAdmin.from('users').delete().eq('id', newUserId);
      return NextResponse.json({ error: 'Erro ao gravar credenciais de acesso.' }, { status: 500 });
    }

    console.log(`[API Admin CreateUser] Gestor ${email} criado com sucesso. ID: ${newUserId}`);
    return NextResponse.json({
      success: true,
      user: {
        id: newUserId,
        name: name.trim(),
        email: email.trim().toLowerCase(),
        role: 'manager',
        organization: organization.trim()
      }
    });

  } catch (err) {
    console.error('[API Admin CreateUser] Erro crítico inesperado:', err);
    return NextResponse.json({ error: 'Erro crítico interno no servidor.' }, { status: 500 });
  }
}
