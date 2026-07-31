-- Bucket publico do Supabase Storage para logos e banners de eventos.
-- Substitui o armazenamento de imagens como base64 nas colunas events.logo_url /
-- events.banner_url, que inflava o payload do bootstrap (ver diagnostico do
-- timeout de carregamento de 30/07/2026).
--
-- Escritas acontecem exclusivamente via service role na rota
-- POST /api/admin/media/upload (src/app/api/admin/media/upload/route.ts), que
-- ja garante sessao de manager/owner antes de gravar. Por isso nao ha policy
-- de INSERT/UPDATE/DELETE para anon/authenticated: o service role ignora RLS.
-- A flag "public" do bucket e o que autoriza leitura publica dos objetos via
-- /storage/v1/object/public/event-media/..., independente de RLS.
--
-- Nota operacional: este projeto nao possui Supabase CLI linkado nem
-- DATABASE_URL para aplicar migrations via `supabase db push`. O bucket foi
-- provisionado em producao via bin/setup-media-bucket.mjs (Storage Admin API),
-- que produz o mesmo efeito deste bloco INSERT. Este arquivo documenta a
-- infraestrutura para reprodutibilidade em outros ambientes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'event-media',
  'event-media',
  true,
  3145728, -- 3 MB
  array['image/webp', 'image/png', 'image/jpeg']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Leitura publica dos objetos do bucket (redundante com a flag "public" acima,
-- mantida para clareza de intenção caso a flag seja revisada no futuro).
drop policy if exists "event_media_public_read" on storage.objects;
create policy "event_media_public_read"
  on storage.objects for select
  using (bucket_id = 'event-media');
