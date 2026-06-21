import { NextResponse } from 'next/server';
import { getManagerAccessStatus, normalizeServiceValidUntil } from '@/lib/managerAccess';
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
    const { name, email, password, organization, serviceValidUntil } = body;

    if (!name || !email || !password || !organization) {
      return NextResponse.json({ error: 'Todos os campos (name, email, password, organization) são obrigatórios.' }, { status: 400 });
    }

    const supabaseAdmin = createSupabaseAdmin();
    const normalizedEmail = String(email).trim().toLowerCase();
    const normalizedServiceValidUntil = normalizeServiceValidUntil(serviceValidUntil);
    if (serviceValidUntil && !normalizedServiceValidUntil) {
      return NextResponse.json({ error: 'A validade de uso deve estar no formato YYYY-MM-DD.' }, { status: 400 });
    }
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
        organization: organization.trim(),
        service_valid_until: normalizedServiceValidUntil || null
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
        organization: organization.trim(),
        serviceValidUntil: normalizedServiceValidUntil,
        managerAccessStatus: getManagerAccessStatus(normalizedServiceValidUntil)
      }
    });

  } catch (err) {
    console.error('[API Admin CreateUser] Erro crítico inesperado:', err);
    return NextResponse.json({ error: 'Erro crítico interno no servidor.' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const auth = requireSession(request, ['owner']);
    if (auth.response) return auth.response;

    const body = await request.json();
    const { userId, serviceValidUntil } = body;
    const normalizedUserId = String(userId || '').trim();
    const normalizedServiceValidUntil = normalizeServiceValidUntil(serviceValidUntil);
    if (serviceValidUntil && !normalizedServiceValidUntil) {
      return NextResponse.json({ error: 'A validade de uso deve estar no formato YYYY-MM-DD.' }, { status: 400 });
    }

    if (!normalizedUserId) {
      return NextResponse.json({ error: 'Informe o userId do gestor.' }, { status: 400 });
    }

    const supabaseAdmin = createSupabaseAdmin();
    const { data: targetUser, error: targetUserError } = await supabaseAdmin
      .from('users')
      .select('id, name, email, role, organization')
      .eq('id', normalizedUserId)
      .maybeSingle();

    if (targetUserError || !targetUser || targetUser.role !== 'manager') {
      return NextResponse.json({ error: 'Gestor nao encontrado para atualizar a validade.' }, { status: 404 });
    }

    const { data: updatedUser, error: updateError } = await supabaseAdmin
      .from('users')
      .update({ service_valid_until: normalizedServiceValidUntil || null })
      .eq('id', normalizedUserId)
      .select('id, name, email, role, organization, service_valid_until')
      .maybeSingle();

    if (updateError || !updatedUser) {
      console.error('[API Admin CreateUser PUT] Erro ao atualizar validade do gestor:', updateError);
      return NextResponse.json({ error: 'Erro ao atualizar validade do gestor.' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        role: updatedUser.role,
        organization: updatedUser.organization || undefined,
        serviceValidUntil: normalizeServiceValidUntil(updatedUser.service_valid_until),
        managerAccessStatus: getManagerAccessStatus(updatedUser.service_valid_until)
      }
    });
  } catch (err) {
    console.error('[API Admin CreateUser PUT] Erro crítico inesperado:', err);
    return NextResponse.json({ error: 'Erro crítico interno no servidor.' }, { status: 500 });
  }
}
