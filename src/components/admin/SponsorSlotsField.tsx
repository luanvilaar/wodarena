'use client';

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import Image from 'next/image';
import { ChevronDown, ChevronUp, ImagePlus, Loader2, Minus, Plus, X } from 'lucide-react';

import { SPONSOR_LINK_MAX, SPONSOR_MAX_SLOTS, SPONSOR_NAME_MAX, type SponsorSlot } from '@/lib/eventMediaFields';
import { EventMediaUploadError, uploadEventMedia } from '@/lib/eventMediaUpload';

// Patrocinadores no painel (Story 1.151, docs/design/regulamento-patrocinadores/,
// D4 e D5): "Quantas marcas?" cria as vagas, na ordem do carrossel; cada vaga
// recebe um PNG (até 2 MB, transparência mantida), o nome (texto do leitor de
// tela) e um link opcional. Vaga vazia não aparece no site. Diminuir a
// quantidade guarda as vagas tiradas até o formulário fechar: aumentar de novo
// traz de volta. As marcas valem quando o gestor salva o evento.

type SponsorSlotsFieldProps = {
  idPrefix: string;
  value: SponsorSlot[];
  // O setter do estado do formulário: o envio do PNG aplica sobre o estado mais recente.
  onChange: Dispatch<SetStateAction<SponsorSlot[]>>;
  // O formulário não salva enquanto um logo sobe.
  onUploadingChange?: (uploading: boolean) => void;
  disabled?: boolean;
};

const EMPTY_SLOT: SponsorSlot = { name: '', logoUrl: null, link: '' };
const inputClass = 'w-full min-h-10 rounded-md border border-card-border bg-dark-gray px-3 py-2 text-sm text-white placeholder:text-muted focus:border-primary/50 focus:outline-none';
const iconButton = 'flex h-9 w-9 items-center justify-center rounded-md border border-card-border text-white transition-colors hover:border-primary disabled:cursor-not-allowed disabled:opacity-40';

export function SponsorSlotsField({ idPrefix, value, onChange, onUploadingChange, disabled = false }: SponsorSlotsFieldProps) {
  // Vagas tiradas pelo "−" ficam aqui até o formulário fechar.
  const [stash, setStash] = useState<SponsorSlot[]>([]);
  const [uploading, setUploading] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<number, string>>({});
  // Durante o envio de um logo, quantidade, ordem e "tirar" ficam travados: a
  // resposta cai na vaga que começou o envio (o índice não muda).
  const busy = uploading !== null;
  const mounted = useRef(true);
  const reportUploading = useRef(onUploadingChange);
  useEffect(() => {
    reportUploading.current = onUploadingChange;
  }, [onUploadingChange]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      reportUploading.current?.(false);
    };
  }, []);
  const count = value.length;
  const filled = value.filter((slot) => slot.logoUrl).length;
  const empty = count - filled;

  const setCount = (next: number) => {
    const target = Math.max(0, Math.min(SPONSOR_MAX_SLOTS, next));
    if (target < count) {
      setStash([...value.slice(target), ...stash]);
      onChange(value.slice(0, target));
    } else if (target > count) {
      const added = target - count;
      const restored = stash.slice(0, added);
      setStash(stash.slice(added));
      onChange([...value, ...restored, ...Array.from({ length: added - restored.length }, () => ({ ...EMPTY_SLOT }))]);
    }
  };

  const update = (index: number, patch: Partial<SponsorSlot>) => onChange(value.map((slot, i) => (i === index ? { ...slot, ...patch } : slot)));
  const move = (index: number, delta: -1 | 1) => {
    const next = [...value];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const sendLogo = async (index: number, file: File | undefined) => {
    if (!file) return;
    setUploading(index);
    reportUploading.current?.(true);
    setErrors((current) => ({ ...current, [index]: '' }));
    try {
      const url = await uploadEventMedia(file, 'sponsor');
      // O gestor pode ter digitado o nome durante o envio: aplica sobre o estado de agora.
      const fallbackName = file.name.replace(/\.png$/i, '').replace(/[-_]+/g, ' ').trim().slice(0, SPONSOR_NAME_MAX);
      if (mounted.current) onChange((slots) => slots.map((slot, i) => (i === index ? { ...slot, logoUrl: url, name: slot.name || fallbackName } : slot)));
    } catch (cause) {
      const message = cause instanceof EventMediaUploadError || cause instanceof Error ? cause.message : 'Não foi possível enviar o logo.';
      if (mounted.current) setErrors((current) => ({ ...current, [index]: message }));
    } finally {
      if (mounted.current) {
        setUploading(null);
        reportUploading.current?.(false);
      }
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span id={`${idPrefix}-label`} className="block text-xs font-bold uppercase tracking-wider text-muted">Patrocinadores</span>
        <span className="text-[11px] text-muted">PNG até 2 MB, de preferência com fundo transparente</span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span id={`${idPrefix}-count-label`} className="text-sm font-semibold text-white">Quantas marcas?</span>
        <div role="group" aria-labelledby={`${idPrefix}-count-label`} className="inline-flex items-center overflow-hidden rounded-md border border-card-border">
          <button type="button" onClick={() => setCount(count - 1)} disabled={disabled || busy || count <= 0} aria-label="Uma marca a menos" className="flex h-10 w-10 items-center justify-center bg-dark-gray text-white hover:bg-card-border disabled:opacity-40">
            <Minus className="h-4 w-4" aria-hidden="true" />
          </button>
          <output aria-live="polite" className="min-w-12 text-center font-number text-base font-bold text-white">{count}</output>
          <button type="button" onClick={() => setCount(count + 1)} disabled={disabled || busy || count >= SPONSOR_MAX_SLOTS} aria-label="Uma marca a mais" className="flex h-10 w-10 items-center justify-center bg-dark-gray text-white hover:bg-card-border disabled:opacity-40">
            <Plus className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <span className="text-xs text-muted"><b className="text-white">{filled}</b> de {count} com logo</span>
      </div>

      {empty > 0 && (
        <p className="text-xs font-semibold text-primary">
          {empty === 1 ? 'Uma vaga está vazia e não aparece na página.' : `${empty} vagas estão vazias e não aparecem na página.`}
        </p>
      )}
      {count === 0 && <p className="text-xs text-muted">Sem patrocinadores: a área não aparece na página do evento.</p>}

      {count > 0 && (
        <ol className="space-y-2.5" aria-labelledby={`${idPrefix}-label`}>
          {value.map((slot, index) => {
            const nameId = `${idPrefix}-name-${index}`;
            const linkId = `${idPrefix}-link-${index}`;
            const missingName = Boolean(slot.logoUrl) && !slot.name.trim();
            return (
              <li key={index} className={`grid grid-cols-1 gap-3 rounded-lg border bg-dark-gray p-3 sm:grid-cols-[7.5rem_minmax(0,1fr)_auto] ${slot.logoUrl ? 'border-card-border' : 'border-dashed border-card-border'}`}>
                <div className="space-y-1.5">
                  <span className="font-number text-[11px] font-bold text-muted">{index + 1}º</span>
                  {/* Cartão claro, como na página (D6): logo preto ou colorido aparece igual. */}
                  <div className={`flex h-14 w-[7.5rem] items-center justify-center overflow-hidden rounded-md p-1.5 ${slot.logoUrl ? 'border border-sponsor-tile-border bg-sponsor-tile' : 'border border-dashed border-card-border bg-background text-[11px] font-semibold text-muted'}`}>
                    {slot.logoUrl ? (
                      <Image src={slot.logoUrl} alt="" width={240} height={112} unoptimized className="h-full w-full object-contain" />
                    ) : 'sem logo'}
                  </div>
                  <label className={`inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-md border border-card-border px-2.5 text-xs font-bold text-white hover:border-primary ${uploading === index ? 'pointer-events-none opacity-60' : ''}`}>
                    {uploading === index ? <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden="true" /> : <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" />}
                    {uploading === index ? 'Enviando…' : slot.logoUrl ? 'Trocar PNG' : 'Enviar PNG'}
                    <input
                      type="file"
                      accept="image/png"
                      className="sr-only"
                      disabled={disabled || uploading !== null}
                      aria-label={`Logo da marca ${index + 1}`}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = '';
                        void sendLogo(index, file);
                      }}
                    />
                  </label>
                </div>

                <div className="min-w-0 space-y-2">
                  <div>
                    <label htmlFor={nameId} className="sr-only">Nome da marca {index + 1}</label>
                    <input id={nameId} value={slot.name} maxLength={SPONSOR_NAME_MAX} onChange={(event) => update(index, { name: event.target.value })} placeholder="Nome da marca" className={inputClass} disabled={disabled} />
                  </div>
                  <div>
                    <label htmlFor={linkId} className="sr-only">Link da marca {index + 1}</label>
                    <input id={linkId} value={slot.link} maxLength={SPONSOR_LINK_MAX} onChange={(event) => update(index, { link: event.target.value })} placeholder="Site ou Instagram (opcional)" inputMode="url" className={inputClass} disabled={disabled} />
                  </div>
                  {missingName && <p className="text-xs font-semibold text-trading-down">Falta o nome: ele é lido por quem usa leitor de tela.</p>}
                  {errors[index] && <p role="alert" className="text-xs font-semibold text-trading-down">{errors[index]}</p>}
                </div>

                <div className="flex gap-1.5 sm:flex-col">
                  <button type="button" onClick={() => move(index, -1)} disabled={disabled || busy || index === 0} aria-label={`Subir a marca ${index + 1}`} className={iconButton}>
                    <ChevronUp className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => move(index, 1)} disabled={disabled || busy || index === count - 1} aria-label={`Descer a marca ${index + 1}`} className={iconButton}>
                    <ChevronDown className="h-4 w-4" aria-hidden="true" />
                  </button>
                  {slot.logoUrl && (
                    <button type="button" onClick={() => update(index, { logoUrl: null })} disabled={disabled || busy} aria-label={`Tirar o logo da marca ${index + 1}`} className={`${iconButton} hover:border-trading-down hover:text-trading-down`}>
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
