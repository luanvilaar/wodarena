'use client';

import { useState, type DragEvent } from 'react';
import { ExternalLink, FileText, Loader2, Upload, X } from 'lucide-react';

import { formatFileSize, type RulesDocument } from '@/lib/eventMediaFields';
import { RulesDocumentUploadError, uploadRulesDocument } from '@/lib/rulesDocumentUpload';

// Regulamento em PDF no painel (Story 1.150, docs/design/regulamento-patrocinadores/,
// D1 a D3): enviar, abrir para conferir, substituir e remover. O PDF só passa a
// valer na página quando o gestor salva o evento. O resumo em texto continua no
// campo ao lado (o `rules` de antes).

type RulesDocumentFieldProps = {
  id: string;
  value: RulesDocument | null;
  onChange: (document: RulesDocument | null) => void;
  disabled?: boolean;
};

const formatDate = (iso: string) => {
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleDateString('pt-BR', { timeZone: 'America/Fortaleza' }) : '';
};

export function RulesDocumentField({ id, value, onChange, disabled = false }: RulesDocumentFieldProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const send = async (file: File | undefined) => {
    if (!file || uploading) return;
    setUploading(true);
    setError('');
    try {
      onChange(await uploadRulesDocument(file));
    } catch (cause) {
      setError(cause instanceof RulesDocumentUploadError || cause instanceof Error ? cause.message : 'Não foi possível enviar o PDF.');
    } finally {
      setUploading(false);
    }
  };

  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    void send(event.dataTransfer.files?.[0]);
  };

  const fileInput = (
    <input
      id={id}
      type="file"
      accept="application/pdf,.pdf"
      className="sr-only"
      disabled={disabled || uploading}
      onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        void send(file);
      }}
    />
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="block text-xs font-bold uppercase tracking-wider text-muted">Regulamento em PDF</span>
        <span className="text-[11px] text-muted">Até 10 MB. O atleta abre e baixa pelo botão Regulamento.</span>
      </div>

      {value ? (
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-lg border border-card-border bg-dark-gray p-3">
          <span className="flex h-12 w-10 items-center justify-center rounded-md border border-trading-down/60 bg-trading-down/10 font-number text-[10px] font-bold text-trading-down" aria-hidden="true">PDF</span>
          <div className="min-w-0">
            <p className="break-words text-sm font-bold text-white">{value.name}</p>
            <p className="text-xs text-muted">{formatFileSize(value.size)}{value.uploadedAt ? ` · enviado em ${formatDate(value.uploadedAt)}` : ''}</p>
          </div>
          <div className="col-span-2 flex flex-wrap gap-2">
            <a
              href={value.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-10 items-center gap-1.5 rounded-md border border-card-border px-3 text-xs font-bold text-white hover:border-primary"
            >
              <ExternalLink className="h-4 w-4" aria-hidden="true" />Abrir
            </a>
            <label className={`inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-md border border-card-border px-3 text-xs font-bold text-white hover:border-primary ${uploading ? 'opacity-60' : ''}`}>
              {uploading ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" /> : <Upload className="h-4 w-4" aria-hidden="true" />}
              {uploading ? 'Enviando…' : 'Substituir'}
              {fileInput}
            </label>
            <button
              type="button"
              onClick={() => onChange(null)}
              disabled={disabled || uploading}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-md border border-card-border px-3 text-xs font-bold text-white hover:border-trading-down hover:text-trading-down disabled:opacity-50"
            >
              <X className="h-4 w-4" aria-hidden="true" />Remover
            </button>
          </div>
        </div>
      ) : (
        <label
          onDragOver={(event) => event.preventDefault()}
          onDrop={onDrop}
          className={`group flex min-h-[120px] w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-card-border bg-dark-gray p-4 text-center transition-colors hover:border-primary focus-within:border-primary ${uploading ? 'pointer-events-none opacity-70' : ''}`}
        >
          {uploading ? <Loader2 className="h-6 w-6 text-primary motion-safe:animate-spin" aria-hidden="true" /> : <FileText className="h-6 w-6 text-muted group-hover:text-primary" aria-hidden="true" />}
          <span className="text-xs font-semibold text-white group-hover:text-primary">{uploading ? 'Enviando o PDF…' : 'Enviar o regulamento em PDF'}</span>
          <span className="text-[10px] text-muted">Arraste o arquivo ou toque para escolher</span>
          {fileInput}
        </label>
      )}

      {error && <p role="alert" className="text-xs font-semibold text-trading-down">{error}</p>}
    </div>
  );
}
