'use client';

import { useId, useState } from 'react';
import type { EventCurrency } from '@/types';
import type { OwnerMonthlyPoint } from '@/lib/ownerOverview';
import { formatOwnerMoney } from '@/components/owner/ownerUi';

// Receita WODArena por mês (Story 1.124): uma série, uma moeda, 12 meses. Barras
// finas (até 24 px) com a ponta arredondada e a base reta, grade discreta, mês
// atual com hachura (parcial). Passar o mouse ou o foco numa coluna mostra o valor;
// a tabela escondida dá os mesmos números a quem usa leitor de tela.

const MONTH_LABELS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const WIDTH = 560;
const HEIGHT = 210;
const LEFT = 56;
const RIGHT = 552;
const TOP = 12;
const BASELINE = 178;
const BAR_WIDTH = 22;

/** Teto do eixo: quatro marcas de passo redondo (1, 2, 2,5, 3, 4 ou 5 × 10ⁿ) acima do maior valor. */
export const resolveChartCeiling = (max: number): number => {
  if (max <= 0) return 4;
  const rough = max / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 3, 4, 5, 10].map(factor => factor * magnitude).find(candidate => candidate >= rough) || 10 * magnitude;
  return step * 4;
};

const formatTick = (value: number) => {
  if (value === 0) return '0';
  if (value >= 1000) return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(value / 1000)} mil`;
  return new Intl.NumberFormat('pt-BR').format(value);
};

const monthLabel = (month: string) => {
  const [year, monthNumber] = month.split('-');
  return { short: MONTH_LABELS[Number(monthNumber) - 1] || month, year };
};

type Props = {
  points: OwnerMonthlyPoint[];
  currency: EventCurrency;
};

export function OwnerRevenueChart({ points, currency }: Props) {
  const [hovered, setHovered] = useState<number | null>(null);
  const hatchId = `owner-hatch-${useId().replace(/:/g, '')}`;
  const values = points.map(point => point.serviceFee[currency] || 0);
  const ceiling = resolveChartCeiling(Math.max(...values, 0));
  const ticks = [0, 1, 2, 3, 4].map(index => (ceiling / 4) * index);
  const band = (RIGHT - LEFT) / Math.max(points.length, 1);
  const scaleY = (value: number) => BASELINE - (value / ceiling) * (BASELINE - TOP);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="block h-auto w-full" role="img" aria-label={`Receita WODArena por mês em ${currency}, últimos 12 meses`}>
        <defs>
          <pattern id={hatchId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="rgba(252,213,53,.28)" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="#fcd535" strokeWidth="2.5" />
          </pattern>
        </defs>
        {ticks.map(tick => (
          <g key={tick}>
            <line x1={LEFT} x2={RIGHT} y1={scaleY(tick)} y2={scaleY(tick)} stroke="#2b3139" strokeWidth="1" />
            <text x={LEFT - 8} y={scaleY(tick) + 4} textAnchor="end" className="fill-muted text-[11px]">{formatTick(tick)}</text>
          </g>
        ))}
        {points.map((point, index) => {
          const value = values[index];
          const x = LEFT + band * index + (band - BAR_WIDTH) / 2;
          const height = Math.max(0, BASELINE - scaleY(value));
          const y = BASELINE - height;
          const radius = Math.min(4, height);
          const path = height > 0
            ? `M${x},${BASELINE} V${y + radius} Q${x},${y} ${x + radius},${y} H${x + BAR_WIDTH - radius} Q${x + BAR_WIDTH},${y} ${x + BAR_WIDTH},${y + radius} V${BASELINE} Z`
            : '';
          const { short } = monthLabel(point.month);
          const dimmed = hovered !== null && hovered !== index;
          return (
            <g key={point.month}>
              {path && (
                <path d={path} fill={point.partial ? `url(#${hatchId})` : '#fcd535'} opacity={dimmed ? 0.35 : 1} className="transition-opacity motion-reduce:transition-none" />
              )}
              <text x={x + BAR_WIDTH / 2} y={BASELINE + 17} textAnchor="middle" className="fill-muted text-[11px]">{short}</text>
              {point.partial && <text x={x + BAR_WIDTH / 2} y={BASELINE + 30} textAnchor="middle" className="fill-muted text-[10px]">parcial</text>}
              <rect
                x={LEFT + band * index}
                y={TOP}
                width={band}
                height={BASELINE - TOP}
                fill="transparent"
                tabIndex={0}
                aria-label={`${short}/${monthLabel(point.month).year}: ${formatOwnerMoney(value, currency)}${point.partial ? ' (parcial)' : ''}`}
                onPointerEnter={() => setHovered(index)}
                onPointerLeave={() => setHovered(null)}
                onFocus={() => setHovered(index)}
                onBlur={() => setHovered(null)}
                className="cursor-crosshair outline-none"
              />
            </g>
          );
        })}
      </svg>
      {hovered !== null && points[hovered] && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-card-border bg-dark-gray px-2.5 py-1.5 text-xs text-muted shadow-lg"
          style={{
            left: `${((LEFT + band * hovered + band / 2) / WIDTH) * 100}%`,
            top: `${(Math.max(TOP, scaleY(values[hovered])) / HEIGHT) * 100}%`
          }}
          aria-hidden
        >
          {monthLabel(points[hovered].month).short}/{monthLabel(points[hovered].month).year}{points[hovered].partial ? ' · parcial' : ''}
          <b className="block font-number text-[13px] text-white">{formatOwnerMoney(values[hovered], currency)}</b>
        </div>
      )}
      <table className="sr-only">
        <caption>Receita WODArena por mês em {currency}</caption>
        <thead><tr><th scope="col">Mês</th><th scope="col">Receita</th></tr></thead>
        <tbody>
          {points.map((point, index) => (
            <tr key={point.month}>
              <td>{point.month}{point.partial ? ' (parcial)' : ''}</td>
              <td>{formatOwnerMoney(values[index], currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
