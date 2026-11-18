import { NextResponse } from 'next/server';

import { RULES_DOCUMENT_MAX_BYTES } from '@/lib/eventMediaFields';
import {
  RulesDocumentError,
  confirmRulesDocumentUpload,
  createRulesDocumentUpload,
  ensureEventDocumentsBucket
} from '@/lib/mediaStorage';
import { ManagerAccessError, assertManagerOperationalAccess, managerAccessErrorResponse } from '@/lib/serverManagerAccess';
import { checkRateLimit, createSupabaseAdmin, requireSession } from '@/lib/serverSecurity';

// Regulamento em PDF (Story 1.150, docs/design/regulamento-patrocinadores/, D3).
// Dois passos, só para gestor ou owner com acesso válido:
// - `sign`: confere o tamanho informado e devolve o link assinado para o
//   navegador enviar o PDF direto ao Storage (a Vercel recusa corpo acima de
//   4,5 MB, então o arquivo não passa por aqui);
// - `confirm`: confere o arquivo enviado (caminho do próprio gestor, %PDF-,
//   até 10 MB) e devolve o documento que o painel grava no evento.
// O documento só passa a valer quando o gestor salva o evento.

export async function POST(request: Request) {
  try {
    const auth = requireSession(request, ['manager', 'owner']);
    if (auth.response) return auth.response;
    const actor = auth.user;

    const limited = checkRateLimit({ key: `rules-document:${actor.id}`, limit: 20, windowMs: 10 * 60 * 1000 });
    if (limited) return limited;

    const supabaseAdmin = createSupabaseAdmin();
    await assertManagerOperationalAccess(supabaseAdmin, actor);

    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const action = body?.action;

    if (action === 'sign') {
      const size = Number(body?.size);
      if (!Number.isInteger(size) || size <= 0) return NextResponse.json({ error: 'Informe o tamanho do PDF.' }, { status: 400 });
      if (size > RULES_DOCUMENT_MAX_BYTES) {
        return NextResponse.json({ error: 'O PDF passa de 10 MB. Reduza as imagens do documento e envie de novo.' }, { status: 400 });
      }
      await ensureEventDocumentsBucket(supabaseAdmin);
      return NextResponse.json(await createRulesDocumentUpload(supabaseAdmin, actor.id));
    }

    if (action === 'confirm') {
      const document = await confirmRulesDocumentUpload(supabaseAdmin, actor.id, body?.path, body?.fileName);
      return NextResponse.json({ document });
    }

    return NextResponse.json({ error: 'Ação desconhecida.' }, { status: 400 });
  } catch (error) {
    if (error instanceof ManagerAccessError) return managerAccessErrorResponse(error);
    if (error instanceof RulesDocumentError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('[Rules Document API] Erro ao enviar o regulamento:', error);
    return NextResponse.json({ error: 'Não foi possível enviar o PDF agora. Tente de novo.' }, { status: 500 });
  }
}
