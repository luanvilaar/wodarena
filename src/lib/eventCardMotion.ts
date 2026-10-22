// Movimento do card de evento da home (Story 1.65). Os tempos da entrada, do
// brilho e da compressão vivem em globals.css (event-card-*); aqui ficam só os
// que o JavaScript precisa para a contagem andar junto com a cascata.
export const EVENT_CARD_MOTION = {
  priceCount: { delayMs: 450, durationMs: 700 },
  divisionCount: { delayMs: 500, durationMs: 500 },
  // O card começa a animar quando chega a 96 px da borda inferior da tela.
  revealRootMargin: '0px 0px -96px 0px',
  // Brilho único do Garantir Vaga em tela sem hover: toca quando o botão está
  // visível (60% dele), não antes de a cascata assentar (1250 ms depois da
  // entrada do card) e, se o visitante só chegar ao botão depois disso, quase
  // na hora (150 ms).
  shine: { settleMs: 1250, minDelayMs: 150, visibleRatio: 0.6 }
} as const;

export type CountTiming = { readonly delayMs: number; readonly durationMs: number };

// Desaceleração exponencial: chega perto do valor rápido e assenta devagar.
export const easeOutExpo = (progress: number): number =>
  progress >= 1 ? 1 : progress <= 0 ? 0 : 1 - Math.pow(2, -10 * progress);

// Atraso do brilho do botão, contado do momento em que ele ficou visível.
export function getShineDelayMs(elapsedSinceRevealMs: number): number {
  const { settleMs, minDelayMs } = EVENT_CARD_MOTION.shine;
  return Math.max(minDelayMs, settleMs - elapsedSinceRevealMs);
}

// Troca, no texto já traduzido com o valor final ("6 divisões disponíveis"), o
// número final pelo que a contagem está mostrando. O plural continua o do valor
// final, então a contagem nunca mostra "0 divisão disponível".
export function swapCountInText(finalText: string, finalValue: number, shownValue: number): string {
  if (finalValue === shownValue) return finalText;
  return finalText.replace(String(finalValue), String(shownValue));
}

// Valor exibido a `elapsedMs` do início da entrada. Antes do atraso é 0, no fim é
// exatamente `target` (sem arredondar); no meio é sempre um inteiro abaixo do
// alvo, para o número final nunca aparecer antes da hora.
export function getCountValue(target: number, elapsedMs: number, timing: CountTiming): number {
  if (!(target > 0)) return target;
  const progress = (elapsedMs - timing.delayMs) / timing.durationMs;
  if (progress >= 1) return target;
  if (progress <= 0) return 0;
  return Math.min(Math.floor(target * easeOutExpo(progress)), target);
}
