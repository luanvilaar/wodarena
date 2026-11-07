import { NextResponse } from 'next/server';
import {
  normalizeOwnerSignupsBefore,
  normalizeOwnerSignupsLimit,
  OWNER_SIGNUP_KINDS,
  readOwnerSignups,
  sanitizeOwnerSearch,
  type OwnerSignupKind
} from '@/lib/serverOwnerSignups';
import { createSupabaseAdmin, requireSession } from '@/lib/serverSecurity';

// Cadastros recentes com busca (Story 1.122, decisão E2): só leitura, só owner.
// ?q= nome ou e-mail · ?before= cursor (ISO) · ?limit= até 50 · ?kind= um dos tipos ou todos.
export async function GET(request: Request) {
  const auth = requireSession(request, ['owner']);
  if (auth.response) return auth.response;

  const params = new URL(request.url).searchParams;
  const kindParam = params.get('kind');
  const kinds: OwnerSignupKind[] = OWNER_SIGNUP_KINDS.includes(kindParam as OwnerSignupKind)
    ? [kindParam as OwnerSignupKind]
    : OWNER_SIGNUP_KINDS;

  try {
    const result = await readOwnerSignups(createSupabaseAdmin(), {
      search: sanitizeOwnerSearch(params.get('q')),
      before: normalizeOwnerSignupsBefore(params.get('before')),
      limit: normalizeOwnerSignupsLimit(params.get('limit')),
      kinds
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[Owner Signups] Falha ao listar cadastros:', error);
    return NextResponse.json({ error: 'Não foi possível carregar os cadastros.' }, { status: 500 });
  }
}
