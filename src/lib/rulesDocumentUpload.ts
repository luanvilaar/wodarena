'use client';

import { RULES_DOCUMENT_MAX_BYTES, isPdfSignature, type RulesDocument } from '@/lib/eventMediaFields';

// Envio do regulamento em PDF pelo painel (Story 1.150, D3): pede ao servidor o
// link assinado, manda o arquivo direto ao Storage e pede ao servidor para
// conferir. O PDF não passa pela Vercel (limite de 4,5 MB por requisição). O
// cliente do Supabase só é carregado na hora do envio.

export class RulesDocumentUploadError extends Error {}

const call = async (body: Record<string, unknown>) => {
  const response = await fetch('/api/admin/documents/upload', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new RulesDocumentUploadError(data.error || 'Não foi possível enviar o PDF.');
  return data as Record<string, unknown>;
};

/** Confere no aparelho antes de enviar: começa com %PDF- e tem até 10 MB. */
export const checkRulesPdfFile = async (file: File) => {
  if (file.size > RULES_DOCUMENT_MAX_BYTES) {
    throw new RulesDocumentUploadError('O PDF passa de 10 MB. Reduza as imagens do documento e envie de novo.');
  }
  const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  if (!isPdfSignature(head)) throw new RulesDocumentUploadError('Este arquivo não é um PDF. Exporte o regulamento em PDF e envie de novo.');
};

export const uploadRulesDocument = async (file: File): Promise<RulesDocument> => {
  await checkRulesPdfFile(file);
  const signed = await call({ action: 'sign', size: file.size });
  if (typeof signed.bucket !== 'string' || typeof signed.path !== 'string' || typeof signed.token !== 'string') {
    throw new RulesDocumentUploadError('Resposta inválida ao preparar o envio do PDF.');
  }
  const { supabase } = await import('@/lib/supabase');
  const body = new File([file], 'regulamento.pdf', { type: 'application/pdf' });
  const { error } = await supabase.storage.from(signed.bucket).uploadToSignedUrl(signed.path, signed.token, body);
  if (error) throw new RulesDocumentUploadError(`Não foi possível enviar o PDF: ${error.message}`);
  const confirmed = await call({ action: 'confirm', path: signed.path, fileName: file.name });
  const document = confirmed.document as RulesDocument | undefined;
  if (!document || typeof document.url !== 'string') throw new RulesDocumentUploadError('Resposta inválida ao conferir o PDF.');
  return document;
};
