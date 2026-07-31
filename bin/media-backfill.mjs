#!/usr/bin/env node
// Migra logo_url/banner_url gravados como data URI base64 na tabela events
// para o Supabase Storage (bucket "event-media"), substituindo a coluna pela
// URL publica resultante. Faz backup dos valores originais antes de
// sobrescrever qualquer linha.
//
// Uso:
//   node bin/media-backfill.mjs            (dry-run: soh mostra o que seria feito)
//   node bin/media-backfill.mjs --confirm  (executa de fato: backup + upload + update)

import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BUCKET = 'event-media';
const BACKUP_DIR = process.env.MEDIA_BACKFILL_BACKUP_DIR
  || '/private/tmp/claude-501/-Users-luanvilaar-Desktop-Projetos-wodarena/d03e9af6-e631-45c8-ae10-30b272636f6c/scratchpad';

const getRequiredEnv = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Variavel de ambiente obrigatoria ausente: ${name}`);
  return value;
};

const getSupabaseAdmin = () => createClient(
  getRequiredEnv('SUPABASE_URL'),
  getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const sniffContentType = (buffer) => {
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return { type: 'image/png', ext: 'png' };
  if (buffer[0] === 0xFF && buffer[1] === 0xD8) return { type: 'image/jpeg', ext: 'jpg' };
  if (buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP') return { type: 'image/webp', ext: 'webp' };
  return null;
};

const parseDataUri = (value) => {
  if (typeof value !== 'string' || !value.startsWith('data:')) return null;
  const commaIndex = value.indexOf(',');
  if (commaIndex === -1) return null;
  const meta = value.slice(5, commaIndex);
  if (!meta.includes('base64')) return null;
  const base64Payload = value.slice(commaIndex + 1);
  const buffer = Buffer.from(base64Payload, 'base64');
  const sniffed = sniffContentType(buffer);
  return { buffer, declaredMeta: meta, sniffed };
};

const uploadToStorage = async (supabase, { buffer, contentType, extension, ownerId, kind }) => {
  const uniqueSuffix = `${Date.now().toString(36)}-${randomBytes(6).toString('hex')}`;
  const path = `events/${ownerId}/${kind}-backfill-${uniqueSuffix}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType, upsert: false });

  if (uploadError) throw new Error(`Falha ao enviar ${kind}: ${uploadError.message}`);

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
};

const main = async () => {
  const confirm = process.argv.includes('--confirm');
  const supabase = getSupabaseAdmin();

  const { data: events, error } = await supabase
    .from('events')
    .select('id, name, organizer_id, logo_url, banner_url');
  if (error) throw error;

  const targets = [];
  for (const event of events || []) {
    for (const column of ['logo_url', 'banner_url']) {
      const parsed = parseDataUri(event[column]);
      if (parsed) targets.push({ event, column, ...parsed });
    }
  }

  if (targets.length === 0) {
    console.log('Nenhuma imagem em base64 encontrada em events.logo_url/banner_url. Nada a fazer.');
    return;
  }

  console.log(`Encontradas ${targets.length} imagens em base64 a migrar:\n`);
  for (const t of targets) {
    const kb = (t.buffer.length / 1024).toFixed(1);
    const typeInfo = t.sniffed ? t.sniffed.type : `desconhecido (declarado: ${t.declaredMeta})`;
    console.log(`  - ${String(t.event.name).slice(0, 32).padEnd(34)} ${t.column.padEnd(11)} ${kb.padStart(9)} KB  tipo=${typeInfo}`);
  }

  const skipped = targets.filter(t => !t.sniffed);
  if (skipped.length > 0) {
    console.log(`\nAVISO: ${skipped.length} imagem(ns) com formato não reconhecido (não é PNG/JPEG/WebP) — serão ignoradas.`);
  }

  const runnable = targets.filter(t => t.sniffed);

  if (!confirm) {
    console.log(`\nDry-run (nenhuma alteração feita). Rode com --confirm para migrar ${runnable.length} imagem(ns) de fato.`);
    return;
  }

  mkdirSync(BACKUP_DIR, { recursive: true });
  const backupPath = join(BACKUP_DIR, `media-backfill-backup-${Date.now()}.json`);
  const backupEntries = runnable.map(t => ({
    eventId: t.event.id,
    eventName: t.event.name,
    column: t.column,
    originalValue: t.event[t.column]
  }));
  writeFileSync(backupPath, JSON.stringify(backupEntries, null, 2));
  console.log(`\nBackup dos valores originais salvo em: ${backupPath}`);

  const updatesByEvent = new Map();
  for (const t of runnable) {
    const url = await uploadToStorage(supabase, {
      buffer: t.buffer,
      contentType: t.sniffed.type,
      extension: t.sniffed.ext,
      ownerId: t.event.organizer_id,
      kind: t.column === 'logo_url' ? 'logo' : 'banner'
    });
    const current = updatesByEvent.get(t.event.id) || {};
    current[t.column] = url;
    updatesByEvent.set(t.event.id, current);
    console.log(`  enviado: ${t.event.name} / ${t.column} -> ${url}`);
  }

  for (const [eventId, patch] of updatesByEvent) {
    const { error: updateError } = await supabase.from('events').update(patch).eq('id', eventId);
    if (updateError) throw new Error(`Falha ao atualizar evento ${eventId}: ${updateError.message}`);
  }

  console.log(`\nConcluído. ${runnable.length} imagem(ns) migradas para o Storage e ${updatesByEvent.size} evento(s) atualizados.`);
  console.log(`Backup em: ${backupPath}`);
};

main().catch((error) => {
  console.error('[media-backfill] Erro:', error.message || error);
  process.exit(1);
});
