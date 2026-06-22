import { NextResponse } from 'next/server';
import { buildPublicBootstrapPayload } from '@/lib/bootstrapPayload';
import { createSupabaseAdmin } from '@/lib/serverSecurity';

export async function GET() {
  try {
    const supabaseAdmin = createSupabaseAdmin();
    const payload = await buildPublicBootstrapPayload(supabaseAdmin);
    return NextResponse.json(payload);
  } catch (err) {
    console.error('[Bootstrap Public API] Erro ao carregar dados publicos iniciais:', err);
    return NextResponse.json({ error: 'Erro ao carregar dados publicos iniciais.' }, { status: 500 });
  }
}
