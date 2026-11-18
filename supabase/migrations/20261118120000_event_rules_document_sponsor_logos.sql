-- Regulamento em PDF e patrocinadores com logo (Stories 1.150 e 1.151,
-- docs/design/regulamento-patrocinadores/, decisões D1, D3, D4 e D8).
--
-- 1. events.rules_document (JSONB, nulo): o PDF oficial do regulamento,
--    {url, name, size, uploadedAt}. O texto de events.rules continua e vira
--    o resumo opcional (D1). A rota de gravação confere o formato e que a URL
--    é do espaço de documentos do Storage.
-- 2. events.sponsor_logos (JSONB, lista): as vagas de patrocinador, na ordem
--    do carrossel, [{name, logoUrl, link}]. Vaga sem logo (logoUrl nulo) é a
--    vaga que o gestor criou em "Quantas marcas?" e ainda não preencheu; não
--    aparece no site (D4). Máximo de 12 vagas, conferido na rota de gravação.
--    A coluna antiga events.sponsors (nomes em texto) não é apagada (D8): a
--    página deixa de mostrá-la e o painel deixa de gravar os nomes fixos.
-- 3. Bucket event-documents (público, só application/pdf, 10 MB): o PDF é
--    enviado direto ao Storage por um link assinado pelo servidor
--    (POST /api/admin/documents/upload), porque a Vercel recusa requisições
--    acima de 4,5 MB (D3). O servidor também cria o bucket no primeiro envio
--    (ensureEventDocumentsBucket em src/lib/mediaStorage.ts); este bloco
--    documenta e reproduz a infraestrutura, como o de event-media.
--
-- RLS e grants: nada muda em events. As escritas no bucket acontecem só pelo
-- service role (rota do servidor); a leitura é pública, como a de event-media.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS; o bucket usa ON CONFLICT. Nenhuma
-- migration anterior é alterada.
--
-- Sem esta migration: a página e o painel seguem como antes (o bootstrap lê
-- sem as colunas novas); só salvar um PDF ou marcas responde que a migration
-- está pendente.
--
-- Rollback (apaga os PDFs ligados e as marcas; os arquivos ficam no Storage):
--   ALTER TABLE public.events DROP COLUMN IF EXISTS rules_document;
--   ALTER TABLE public.events DROP COLUMN IF EXISTS sponsor_logos;
--   DROP POLICY IF EXISTS "event_documents_public_read" ON storage.objects;
--   -- O bucket só pode ser removido vazio: DELETE FROM storage.buckets WHERE id = 'event-documents';

ALTER TABLE public.events ADD COLUMN IF NOT EXISTS rules_document JSONB;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS sponsor_logos JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.events.rules_document IS
  'Regulamento oficial em PDF (Story 1.150): {url, name, size, uploadedAt}. Nulo sem PDF. O texto de rules vira o resumo opcional.';
COMMENT ON COLUMN public.events.sponsor_logos IS
  'Vagas de patrocinador na ordem do carrossel (Story 1.151): [{name, logoUrl, link}]. logoUrl nulo = vaga ainda sem logo, fora do site. Máximo 12.';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('event-documents', 'event-documents', true, 10485760, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "event_documents_public_read" ON storage.objects;
CREATE POLICY "event_documents_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'event-documents');
