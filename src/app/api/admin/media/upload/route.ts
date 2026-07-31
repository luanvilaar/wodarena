import { NextResponse } from 'next/server';
import { ManagerAccessError, assertManagerOperationalAccess, managerAccessErrorResponse } from '@/lib/serverManagerAccess';
import { EVENT_MEDIA_ACCEPTED_TYPES, EVENT_MEDIA_MAX_BYTES, uploadEventMediaObject } from '@/lib/mediaStorage';
import { checkRateLimit, createSupabaseAdmin, requireSession } from '@/lib/serverSecurity';

export async function POST(request: Request) {
  try {
    const auth = requireSession(request, ['manager', 'owner']);
    if (auth.response) return auth.response;
    const actor = auth.user;

    const rateLimitResponse = checkRateLimit({
      key: `media-upload:${actor.id}`,
      limit: 30,
      windowMs: 10 * 60 * 1000
    });
    if (rateLimitResponse) return rateLimitResponse;

    const supabaseAdmin = createSupabaseAdmin();
    await assertManagerOperationalAccess(supabaseAdmin, actor);

    const formData = await request.formData();
    const kind = formData.get('type');
    const file = formData.get('file');

    if (kind !== 'logo' && kind !== 'banner') {
      return NextResponse.json({ error: 'Tipo de mídia inválido.' }, { status: 400 });
    }
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: 'Nenhum arquivo enviado.' }, { status: 400 });
    }
    if (!EVENT_MEDIA_ACCEPTED_TYPES.includes(file.type as typeof EVENT_MEDIA_ACCEPTED_TYPES[number])) {
      return NextResponse.json({ error: 'Formato de imagem não suportado.' }, { status: 400 });
    }
    if (file.size > EVENT_MEDIA_MAX_BYTES) {
      return NextResponse.json({ error: 'Imagem muito grande após processamento.' }, { status: 400 });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const { publicUrl } = await uploadEventMediaObject(supabaseAdmin, {
      bytes,
      contentType: file.type,
      ownerId: actor.id,
      kind
    });

    return NextResponse.json({ url: publicUrl });
  } catch (err) {
    if (err instanceof ManagerAccessError) {
      return managerAccessErrorResponse(err);
    }
    console.error('[Media Upload API] Erro ao enviar imagem:', err);
    return NextResponse.json({
      error: err instanceof Error ? err.message : 'Erro ao enviar imagem.'
    }, { status: 500 });
  }
}
