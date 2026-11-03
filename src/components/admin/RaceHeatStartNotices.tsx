import { X } from 'lucide-react';

import type { HeatStartNotice } from '@/lib/raceStartQueue';

// Avisos da largada no painel Ondas (Story 1.110, REQ-002): a largada recusada
// pelo servidor, o "outro aparelho largou antes" e a sessão expirada aparecem
// aqui, fora da folha, e ficam até o gestor dispensar. Assim a resposta que
// chega com a folha fechada, ou a fila guardada de uma sessão anterior, não
// deixa a onda voltar a "Aguardando largada" sem dizer o motivo.

type Props = {
  notices: readonly HeatStartNotice[];
  waves: readonly { id: string; title: string }[];
  /** Onda com a folha aberta: o aviso dela aparece na própria folha. */
  openHeatId?: string | null;
  onDismiss: (heatId: string) => void;
  /** Sessão expirada: recarrega a página para o login aparecer (a fila continua guardada no aparelho). */
  onReload: () => void;
};

export function RaceHeatStartNotices({ notices, waves, openHeatId = null, onDismiss, onReload }: Props) {
  const visible = notices.filter((notice) => notice.heatId !== openHeatId);
  if (visible.length === 0) return null;
  return (
    <ul className="space-y-2" aria-label="Avisos da largada">
      {visible.map((notice) => {
        const title = waves.find((wave) => wave.id === notice.heatId)?.title ?? 'Onda';
        const tone = notice.kind === 'conflict' ? 'border-primary bg-primary/10' : 'border-red-500/50 bg-red-950/30';
        return (
          <li key={notice.heatId} role="alert" className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border-2 px-4 py-3 text-sm ${tone}`}>
            <p className="min-w-0 flex-1">
              <span className="block font-extrabold">{title}</span>
              <span className="block font-semibold">{notice.text}</span>
              {notice.kind === 'conflict' && <span className="block text-muted">Outro aparelho largou esta onda antes. Nada foi alterado: vale o horário registrado.</span>}
              {notice.kind === 'error' && <span className="block text-muted">A largada não foi registrada. Abra a onda e largue de novo, se for o caso.</span>}
            </p>
            <div className="flex items-center gap-2">
              {notice.kind === 'session' && (
                <button type="button" onClick={onReload} className="inline-flex min-h-14 items-center rounded-lg border border-card-border bg-dark-gray px-4 text-xs font-bold uppercase tracking-wider hover:border-primary">
                  Entrar de novo
                </button>
              )}
              {notice.kind !== 'session' && (
                <button
                  type="button"
                  onClick={() => onDismiss(notice.heatId)}
                  aria-label={`Dispensar o aviso da ${title}`}
                  className="flex min-h-14 min-w-14 items-center justify-center rounded-lg border border-card-border bg-dark-gray hover:border-primary"
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
