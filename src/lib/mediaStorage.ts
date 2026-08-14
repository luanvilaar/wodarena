import { randomBytes } from 'node:crypto';
import { SupabaseClient } from '@supabase/supabase-js';

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
  kind: 'logo' | 'banner';
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
