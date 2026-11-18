import { getUfName, ufFlagSrc, type BrUf } from '@/lib/ufFlags';

// Bandeira do estado (Story 1.153): retângulo 3:2 de cantos arredondados que já
// vem desenhado no SVG. Entra sempre por <img>: os 27 arquivos usam as mesmas
// classes de CSS (.cls-1...) e, inline, um sobrescreveria as cores do outro.
// Largura e altura fixas evitam salto de layout; carrega na hora (são poucos KB e
// ficam na primeira tela do ranking). É decorativa: o nome do estado
// vai no texto ao lado ou no rótulo do botão, nunca só na imagem.

export type UfFlagSize = 'sm' | 'md' | 'lg';

const SIZES: Record<UfFlagSize, { width: number; height: number }> = {
  sm: { width: 18, height: 12 },
  md: { width: 24, height: 16 },
  lg: { width: 36, height: 24 }
};

type UfFlagProps = {
  uf: BrUf;
  size?: UfFlagSize;
  className?: string;
};

export function UfFlag({ uf, size = 'md', className = '' }: UfFlagProps) {
  const { width, height } = SIZES[size];
  return (
    // eslint-disable-next-line @next/next/no-img-element -- SVG estático de public/flags; next/image não otimiza SVG
    <img
      src={ufFlagSrc(uf)}
      alt=""
      aria-hidden="true"
      title={getUfName(uf)}
      width={width}
      height={height}
      decoding="async"
      draggable={false}
      className={`block shrink-0 ${className}`.trim()}
    />
  );
}
