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
