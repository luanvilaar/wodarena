import { randomBytes } from 'node:crypto';
import { SupabaseClient } from '@supabase/supabase-js';

import { EVENT_DOCUMENTS_BUCKET, RULES_DOCUMENT_MAX_BYTES, cleanPdfFileName, isPdfSignature, type RulesDocument } from '@/lib/eventMediaFields';

export const EVENT_MEDIA_BUCKET = 'event-media';
export const EVENT_MEDIA_MAX_BYTES = 3 * 1024 * 1024;
export const EVENT_MEDIA_ACCEPTED_TYPES = ['image/webp', 'image/png', 'image/jpeg'] as const;

const EXTENSION_BY_TYPE: Record<string, string> = {
  'image/webp': 'webp',
  'image/png': 'png',
  'image/jpeg': 'jpg'
};

export const ensureEventMediaBucket = async (supabaseAdmin: SupabaseClient) => {
  const { data: existing, error: getError } = await supabaseAdmin.storage.getBucket(EVENT_MEDIA_BUCKET);
  if (getError && !/not.*found/i.test(getError.message || '')) {
    throw new Error(`Falha ao verificar bucket de mídia: ${getError.message}`);
  }
  if (existing) return existing;

  const { error: createError } = await supabaseAdmin.storage.createBucket(EVENT_MEDIA_BUCKET, {
    public: true,
    fileSizeLimit: EVENT_MEDIA_MAX_BYTES,
    allowedMimeTypes: [...EVENT_MEDIA_ACCEPTED_TYPES]
  });
  if (createError) {
    throw new Error(`Falha ao criar bucket de mídia: ${createError.message}`);
  }
};

// Confere magic bytes reais do arquivo contra o Content-Type declarado pelo
// cliente — o header de um multipart/form-data é controlável em uma requisição
// crua, então validar só o `file.type` não impede um payload arbitrário
// disfarçado de imagem.
export const matchesDeclaredImageType = (bytes: Uint8Array, contentType: string): boolean => {
  if (contentType === 'image/png') {
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return png.every((byte, index) => bytes[index] === byte);
  }
  if (contentType === 'image/jpeg') {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (contentType === 'image/webp') {
    const isRiff = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
    const isWebp = bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
    return isRiff && isWebp;
  }
  return false;
};

export type UploadEventMediaInput = {
  bytes: Uint8Array;
  contentType: string;
  ownerId: string;
  // Story 1.151: logo de patrocinador (só PNG, conferido na rota).
  kind: 'logo' | 'banner' | 'sponsor';
};

export const uploadEventMediaObject = async (
  supabaseAdmin: SupabaseClient,
  { bytes, contentType, ownerId, kind }: UploadEventMediaInput
) => {
  const extension = EXTENSION_BY_TYPE[contentType];
  if (!extension) {
    throw new Error('Tipo de imagem não suportado.');
  }

  const uniqueSuffix = `${Date.now().toString(36)}-${randomBytes(6).toString('hex')}`;
  const path = `events/${ownerId}/${kind}-${uniqueSuffix}.${extension}`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from(EVENT_MEDIA_BUCKET)
    .upload(path, bytes, { contentType, upsert: false });

  if (uploadError) {
    throw new Error(`Falha ao enviar imagem: ${uploadError.message}`);
  }

  const { data } = supabaseAdmin.storage.from(EVENT_MEDIA_BUCKET).getPublicUrl(path);
  return { path, publicUrl: data.publicUrl };
};

// ---------------------------------------------------------------------------
// Regulamento em PDF (Story 1.150, docs/design/regulamento-patrocinadores/, D3)
// ---------------------------------------------------------------------------
// O PDF vai direto do navegador ao Storage por um link assinado: a Vercel
// recusa requisições acima de 4,5 MB, então ele não passa pelo servidor. O
// servidor assina o envio para um caminho do próprio gestor e, depois, confere
// o arquivo (começa com %PDF-, até 10 MB) antes de devolver a URL pública.

export class RulesDocumentError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = 'RulesDocumentError';
  }
}

export const ensureEventDocumentsBucket = async (supabaseAdmin: SupabaseClient) => {
  const { data: existing, error: getError } = await supabaseAdmin.storage.getBucket(EVENT_DOCUMENTS_BUCKET);
  if (getError && !/not.*found/i.test(getError.message || '')) {
    throw new Error(`Falha ao verificar o espaço de documentos: ${getError.message}`);
  }
  if (existing) return existing;
  const { error: createError } = await supabaseAdmin.storage.createBucket(EVENT_DOCUMENTS_BUCKET, {
    public: true,
    fileSizeLimit: RULES_DOCUMENT_MAX_BYTES,
    allowedMimeTypes: ['application/pdf']
  });
  if (createError && !/already exists/i.test(createError.message || '')) {
    throw new Error(`Falha ao criar o espaço de documentos: ${createError.message}`);
  }
};

const RULES_FILE_PATTERN = /^regulamento-[a-z0-9]+-[a-f0-9]{12}\.pdf$/;
const rulesFolder = (ownerId: string) => `events/${ownerId}/`;

/** Caminho do gestor para o PDF, com o link de envio assinado (vale 2 horas no Supabase). */
export const createRulesDocumentUpload = async (supabaseAdmin: SupabaseClient, ownerId: string) => {
  const uniqueSuffix = `${Date.now().toString(36)}-${randomBytes(6).toString('hex')}`;
  const path = `${rulesFolder(ownerId)}regulamento-${uniqueSuffix}.pdf`;
  const { data, error } = await supabaseAdmin.storage.from(EVENT_DOCUMENTS_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new Error(`Falha ao preparar o envio do PDF: ${error?.message || 'sem resposta'}`);
  return { bucket: EVENT_DOCUMENTS_BUCKET, path, token: data.token };
};

/** Só caminhos criados por createRulesDocumentUpload para este gestor. */
export const isOwnRulesDocumentPath = (path: unknown, ownerId: string): path is string => (
  typeof path === 'string' && path.startsWith(rulesFolder(ownerId)) && RULES_FILE_PATTERN.test(path.slice(rulesFolder(ownerId).length))
);

/**
 * Confere o PDF enviado e devolve o documento para gravar no evento. Arquivo
 * que não é PDF ou passa de 10 MB é apagado do Storage.
 */
export const confirmRulesDocumentUpload = async (
  supabaseAdmin: SupabaseClient,
  ownerId: string,
  path: unknown,
  fileName: unknown
): Promise<RulesDocument> => {
  if (!isOwnRulesDocumentPath(path, ownerId)) throw new RulesDocumentError('Envio de PDF inválido.');
  const bucket = supabaseAdmin.storage.from(EVENT_DOCUMENTS_BUCKET);
  const { data: blob, error } = await bucket.download(path);
  if (error || !blob) throw new RulesDocumentError('O PDF não chegou ao servidor. Envie de novo.', 404);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (!isPdfSignature(bytes) || bytes.length > RULES_DOCUMENT_MAX_BYTES) {
    await bucket.remove([path]);
    throw new RulesDocumentError(bytes.length > RULES_DOCUMENT_MAX_BYTES
      ? 'O PDF passa de 10 MB. Reduza as imagens do documento e envie de novo.'
      : 'Este arquivo não é um PDF. Exporte o regulamento em PDF e envie de novo.');
  }
  const { data } = bucket.getPublicUrl(path);
  return { url: data.publicUrl, name: cleanPdfFileName(fileName), size: bytes.length, uploadedAt: new Date().toISOString() };
};
