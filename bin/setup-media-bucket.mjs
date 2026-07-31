#!/usr/bin/env node
// Provisiona (de forma idempotente) o bucket publico "event-media" no Supabase
// Storage. Ver supabase/migrations/20260730170000_event_media_storage_bucket.sql
// para o registro versionado da mesma infraestrutura.

import { createClient } from '@supabase/supabase-js';

const BUCKET = 'event-media';
const FILE_SIZE_LIMIT = 3 * 1024 * 1024;
const ALLOWED_MIME_TYPES = ['image/webp', 'image/png', 'image/jpeg'];

const getRequiredEnv = (name) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variavel de ambiente obrigatoria ausente: ${name}`);
  }
  return value;
};

const main = async () => {
  const supabase = createClient(
    getRequiredEnv('SUPABASE_URL'),
    getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const { data: existing, error: getError } = await supabase.storage.getBucket(BUCKET);
  if (getError && !/not.*found/i.test(getError.message || '')) {
    throw new Error(`Falha ao verificar bucket: ${getError.message}`);
  }

  if (existing) {
    console.log(JSON.stringify({ status: 'ja_existe', bucket: BUCKET, public: existing.public }, null, 2));
    return;
  }

  const { error: createError } = await supabase.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: FILE_SIZE_LIMIT,
    allowedMimeTypes: ALLOWED_MIME_TYPES
  });

  if (createError) {
    throw new Error(`Falha ao criar bucket: ${createError.message}`);
  }

  console.log(JSON.stringify({ status: 'criado', bucket: BUCKET, public: true, fileSizeLimit: FILE_SIZE_LIMIT, allowedMimeTypes: ALLOWED_MIME_TYPES }, null, 2));
};

main().catch((error) => {
  console.error('[setup-media-bucket] Erro:', error.message || error);
  process.exit(1);
});
