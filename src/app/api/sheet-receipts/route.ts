import { NextResponse } from 'next/server';

import { checkRateLimit, createSupabaseAdmin, getClientIp, requireSession, safeErrorMessage } from '@/lib/serverSecurity';
import { SheetAccessError } from '@/lib/serverSheetAccess';
import {
  SHEET_RECEIPT_NOT_FOUND,
  SheetReceiptError,
  listAthleteSheetReceipts,
  readSheetReceiptByToken,
  readSheetReceiptForActor
} from '@/lib/serverSheetReceipt';

// Comprovante de envio da súmula digital (Story 1.144; plano em
// docs/design/comprovante-sumula/):
// - ?token=  link assinado, sem login, com limite por IP (a página do comprovante);
// - ?sheetId= com sessão de atleta dono, judge do evento, gestor dono ou owner; devolve o link;
// - ?view=mine lista do atleta logado (Área do Atleta), opcionalmente &registrationId=.
// Respostas sem cache: o comprovante acompanha o estado atual da súmula.

const NO_STORE = { 'Cache-Control': 'no-store' };

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const supabaseAdmin = createSupabaseAdmin();

    const token = searchParams.get('token');
    if (token !== null) {
      const limited = checkRateLimit({ key: `sheet-receipt:${getClientIp(request)}`, limit: 60, windowMs: 60_000 });
      if (limited) return limited;
      const receipt = await readSheetReceiptByToken(supabaseAdmin, token);
      return receipt ? json({ receipt }) : json({ error: SHEET_RECEIPT_NOT_FOUND }, 404);
    }

    const auth = requireSession(request, ['athlete', 'judge', 'manager', 'owner']);
    if (auth.response) return auth.response;
    const actor = auth.user;

    if (searchParams.get('view') === 'mine') {
      if (actor.role !== 'athlete') return json({ error: 'Lista disponível só na Área do Atleta.' }, 403);
      const limited = checkRateLimit({ key: `sheet-receipts-mine:${actor.id}`, limit: 60, windowMs: 60_000 });
      if (limited) return limited;
      return json({ registrations: await listAthleteSheetReceipts(supabaseAdmin, actor, searchParams.get('registrationId')) });
    }

    return json(await readSheetReceiptForActor(supabaseAdmin, actor, searchParams.get('sheetId')));
  } catch (error) {
    if (error instanceof SheetReceiptError || error instanceof SheetAccessError) return json({ error: error.message }, error.status);
    console.error('Erro no comprovante da súmula:', error);
    return json({ error: safeErrorMessage(error, 'Erro ao carregar o comprovante.') }, 500);
  }
}
