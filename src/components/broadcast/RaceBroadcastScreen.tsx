'use client';

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { ChevronDown, ChevronUp, Maximize, WifiOff } from 'lucide-react';

import type { RaceBoardRow, RaceStationRecord } from '@/lib/raceBroadcast';
import {
  RACE_FLAG_INITIAL,
  RACE_LIGHTS_UNITS,
  describeRaceCardAWithPurple,
  describeRaceFlag,
  detectSeenStart,
  nextRaceFlagState,
  racePurpleByAthlete,
  raceArrivalWaveTitle,
  raceClassGridFrame,
  raceGridFrame,
  raceLightsFrame,
  raceLightsMessage,
  raceLightsPlan,
  withRacePurple,
  type RaceFlagState,
  type RaceGridFrame,
  type RacePurpleCard,
  type RaceSeenStart
} from '@/lib/raceBroadcastMoments';
import type { RaceArrivalView, RaceBroadcastPayload, RaceLivePayload, RaceStageView } from '@/lib/raceBroadcastPayload';
import {
  RACE_CLASS_FOOTER,
  describeRaceStandby,
  raceClassFrame,
  type RaceClassFrame,
  type RaceStandbyFrame
} from '@/lib/raceBroadcastScreens';
import {
  describeRaceCardB,
  describeRaceGap,
  describeRaceHeader,
  describeRaceTicker,
  describeRaceWhere,
  nextRankArrows,
  placeRaceMarkers,
  raceBoardMarkers,
  raceClosingStationId,
  raceFinishedCount,
  raceLastTickerEvent,
  raceLiveFrame,
  raceMapLayout,
  raceRankOrder,
  raceRowPosition,
  raceRunLabel,
  raceSilenceNotice,
  raceStageLines,
  type RaceCardA,
  type RaceCardB,
  type RaceGapView,
  type RaceLiveFrame,
  type RaceWhereView,
  type RankArrow
} from '@/lib/raceBroadcastView';
import styles from './RaceBroadcast.module.css';

// Tela do telão do Fitness Race: a tela ao vivo (Story 1.113), com a torre de
// posições, o mapa do percurso, os cartões e a faixa da direção de prova, e os
// momentos da Story 1.114: o grid de largada, as luzes, a bandeirada e o roxo.
// Desenho aprovado em docs/design/telao-fitness-race/. Não faz requisição: o
// BroadcastScreen consulta o servidor (um `fetch` só) e entrega o payload já
// pronto, com a hora do servidor. Os textos e números vêm de raceBroadcastView.ts
// e de raceBroadcastMoments.ts. O telão só lê: nada aqui larga onda (D45). As telas
// de classificação e de espera (Story 1.115) saem de raceBroadcastScreens.ts.

type Props = {
  payload: RaceBroadcastPayload;
  /** Hora do servidor (corrigida pelo `serverTime` da última resposta). */
  now: number;
  /** Hora local do aparelho, só para "atualizado há N s". */
  localNow: number;
  offline: boolean;
  lastOkAt: number | null;
  idle: boolean;
};

type ArrowsByBoard = Map<string, Map<string, RankArrow>>;

const boardKey = (frame: RaceLiveFrame) => `${frame.board.waveKey}|${frame.board.divisionKey}`;

/**
 * Setas de variação por torre (onda × categoria). A ordem de cada torre é guardada
 * entre as respostas e comparada com a nova; o estado é derivado do payload durante
 * o render (padrão documentado do React), nunca na primeira carga.
 */
function useRankArrows(live: RaceLivePayload | null, now: number) {
  const [state, setState] = useState<{ source: RaceLivePayload | null; orders: Map<string, string[]>; arrows: ArrowsByBoard }>({
    source: null,
    orders: new Map(),
    arrows: new Map()
  });
  if (live !== state.source) {
    const orders = new Map<string, string[]>();
    const arrows: ArrowsByBoard = new Map();
    for (const board of live?.boards ?? []) {
      const key = `${board.waveKey}|${board.divisionKey}`;
      const order = raceRankOrder(board.rows);
      orders.set(key, order);
      arrows.set(key, nextRankArrows(state.arrows.get(key) ?? new Map(), state.orders.get(key) ?? null, order, now));
    }
    setState({ source: live, orders, arrows });
  }
  return state.arrows;
}

/**
 * Luzes de largada (D3): a largada que o telão viu entre a resposta anterior e a nova,
 * derivada durante o render como as setas (nunca na primeira carga). O painel avisa por
 * `dismiss` quando a sequência termina.
 */
function useSeenStart(payload: RaceBroadcastPayload, now: number) {
  const [state, setState] = useState<{ source: RaceBroadcastPayload | null; start: RaceSeenStart | null }>({ source: null, start: null });
  if (payload !== state.source) {
    setState({ source: payload, start: detectSeenStart(state.source, payload, now) ?? state.start });
  }
  const dismiss = useCallback(() => setState((current) => (current.start ? { ...current, start: null } : current)), []);
  return { start: state.start, dismiss };
}

/**
 * Bandeirada: a fila de chegadas dos últimos 30 s, uma vez por abertura da tela. O estado
 * é só da tela, e avança com a hora do servidor (`now` anda a cada 250 ms).
 */
function useArrivalFlags(live: RaceLivePayload | null, now: number) {
  const [state, setState] = useState<RaceFlagState>(RACE_FLAG_INITIAL);
  const next = nextRaceFlagState(state, live?.arrivals ?? [], now);
  if (next !== state) setState(next);
  return next;
}

/** `prefers-reduced-motion`: com ele, as luzes não fazem passo a passo (T4-6). */
const subscribeReducedMotion = (onChange: () => void) => {
  if (typeof window.matchMedia !== 'function') return () => {};
  const query = window.matchMedia('(prefers-reduced-motion: reduce)');
  query.addEventListener?.('change', onChange);
  return () => query.removeEventListener?.('change', onChange);
};
const reducedMotionSnapshot = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const usePrefersReducedMotion = () => useSyncExternalStore(subscribeReducedMotion, reducedMotionSnapshot, () => false);

const toneClass = (tone: RaceWhereView['tone']) => (
  tone === 'station' ? styles.toneStation
    : tone === 'track' ? styles.toneTrack
      : tone === 'stalled' ? styles.toneStalled
        : tone === 'finished' ? styles.toneFinished
          : tone === 'purple' ? styles.tonePurple
            : styles.toneDnf
);
const gapClass = (tone: RaceGapView['tone']) => (tone === 'lead' ? styles.gapLead : tone === 'final' ? styles.gapFinal : tone === 'none' ? styles.gapNone : '');

// ---------------------------------------------------------------------------
// Torre
// ---------------------------------------------------------------------------

function TowerRow({ row, index, closingStationId, arrow, purple, now }: { row: RaceBoardRow; index: number; closingStationId: string | null; arrow: RankArrow | undefined; purple: RaceStationRecord | undefined; now: number }) {
  const where = withRacePurple(describeRaceWhere(row, closingStationId, now), row, purple);
  const gap = describeRaceGap(row);
  const direction = arrow && arrow.until > now ? arrow.dir : null;
  const className = [
    styles.twRow,
    row.isLeader ? styles.lead : '',
    row.status === 'dnf' ? styles.dnf : '',
    direction === 'up' ? styles.flashUp : direction === 'down' ? styles.flashDown : '',
    where.tone === 'purple' ? styles.flashPurple : ''
  ].filter(Boolean).join(' ');
  return (
    <div className={className} style={{ '--rank': index } as CSSProperties}>
      <span className={`${styles.twPos} ${styles.num}`}><span>{raceRowPosition(row)}</span></span>
      <span className={`${styles.twChg} ${direction === 'up' ? styles.chgUp : direction === 'down' ? styles.chgDown : ''}`}>
        {direction === 'up' ? <ChevronUp aria-hidden="true" strokeWidth={3} /> : direction === 'down' ? <ChevronDown aria-hidden="true" strokeWidth={3} /> : null}
      </span>
      <span className={styles.twWho}>
        <span className={styles.twNm}>{row.name}</span>
        <span className={styles.twBx}>{row.box}</span>
      </span>
      <span className={`${styles.twWhere} ${toneClass(where.tone)}`}>
        <b><span className={styles.whName}>{where.parts.name}</span>{where.parts.progress && <span className={styles.whProg}>{where.parts.progress}</span>}</b>
        <span><span className={styles.whSub}>{where.parts.subText}</span>{where.parts.counter && <span className={styles.whCounter}> · {where.parts.counter}</span>}</span>
      </span>
      <span className={`${styles.twGap} ${gapClass(gap.tone)} ${styles.num}`}>
        <b>{gap.text}</b>
        {gap.penalty ? <span className={styles.pen}>{gap.penalty}</span> : gap.sub ? <span>{gap.sub}</span> : null}
      </span>
    </div>
  );
}

function Tower({ frame, arrows, purples, now }: { frame: RaceLiveFrame; arrows: Map<string, RankArrow> | undefined; purples: ReadonlyMap<string, RaceStationRecord>; now: number }) {
  const closingStationId = raceClosingStationId(frame.board);
  return (
    <div className={`${styles.tower} ${styles.fade}`}>
      <div className={styles.twHead}>
        <span>Pos</span>
        <span />
        <span>{frame.pageCount > 1 ? `Atleta · página ${frame.pageIndex + 1} de ${frame.pageCount}` : 'Atleta'}</span>
        <span>Onde está</span>
        <span className={styles.r}>Dif. líder</span>
      </div>
      <div className={styles.twBody}>
        {frame.rows.map((row, index) => (
          <TowerRow key={row.athleteKey} row={row} index={index} closingStationId={closingStationId} arrow={arrows?.get(row.athleteKey)} purple={purples.get(row.athleteKey)} now={now} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mapa do percurso
// ---------------------------------------------------------------------------

function StageCell({ stage, index, layout, runOrder }: { stage: RaceStageView; index: number; layout: ReturnType<typeof raceMapLayout>; runOrder: number }) {
  const slot = layout.slots[index];
  if (stage.type === 'run') {
    const offsetY = slot.part === 'top' ? 36 : slot.part === 'bottom' ? -26 : 5;
    const offsetX = slot.part === 'curve' ? -34 : 0;
    return <text x={slot.x + offsetX} y={slot.y + offsetY} textAnchor="middle" fill="#8a93a0" fontSize={16} fontWeight={700}>{raceRunLabel(stage, runOrder)}</text>;
  }
  const width = layout.cardWidth;
  const height = layout.cardHeight;
  const fontSize = width >= 96 ? 15 : 13;
  const lines = raceStageLines(stage.name, Math.floor((width - 10) / (fontSize * 0.6)));
  const firstY = slot.y + (lines.length === 1 ? fontSize * 0.35 : -fontSize * 0.2);
  const below = slot.part !== 'bottom';
  return (
    <g>
      <rect
        x={slot.x - width / 2}
        y={slot.y - height / 2}
        width={width}
        height={height}
        rx={11}
        fill={stage.semJudge ? '#101317' : '#1e2329'}
        stroke={stage.closesTime ? '#fcd535' : stage.semJudge ? '#5d6672' : '#4a525d'}
        strokeWidth={stage.closesTime ? 2.5 : 2}
        strokeDasharray={stage.semJudge ? '6 6' : undefined}
      />
      {lines.map((line, lineIndex) => (
        <text key={lineIndex} x={slot.x} y={firstY + lineIndex * (fontSize + 2)} textAnchor="middle" fill={stage.semJudge ? '#8a93a0' : '#eaecef'} fontSize={fontSize} fontWeight={800}>{line}</text>
      ))}
      {stage.semJudge && (
        <text
          x={slot.x + (slot.part === 'curve' ? -(width / 2 + 4) : 0)}
          y={slot.part === 'bottom' ? slot.y - height / 2 - 6 : below && slot.part !== 'curve' ? slot.y + height / 2 + 16 : slot.y + height / 2 + 16}
          textAnchor={slot.part === 'curve' ? 'end' : 'middle'}
          fill="#8a93a0"
          fontSize={15}
          fontWeight={600}
        >sem judge</text>
      )}
    </g>
  );
}

function RouteMap({ frame, purpleKeys }: { frame: RaceLiveFrame; purpleKeys: ReadonlySet<string> }) {
  const patternId = useId();
  const stages = frame.board.stages;
  const layout = raceMapLayout(stages.length);
  const markers = raceBoardMarkers(frame.board, purpleKeys);
  const places = new Map(placeRaceMarkers(layout, markers).map((place) => [place.key, place]));
  const finished = raceFinishedCount(frame.board);
  // Ordem de cada corrida entre as corridas (rótulo "C1", "C2"...), calculada antes de desenhar.
  const runOrders = stages.map((stage, index) => (stage.type === 'run' ? stages.slice(0, index).filter((item) => item.type === 'run').length : -1));
  return (
    <div className={styles.map}>
      <div className={styles.mapHead}>
        <b>Percurso</b>
        <span className={styles.grow} />
        <span className={styles.mapLeg}><i className={styles.legCard} />na estação</span>
        <span className={styles.mapLeg}><i className={styles.legEst} />estimado</span>
        <span className={styles.mapLeg}><i className={styles.legDash} />sem judge</span>
      </div>
      <svg className={styles.mapSvg} viewBox={`0 0 ${layout.width} ${layout.height}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <defs>
          <pattern id={patternId} width="8" height="8" patternUnits="userSpaceOnUse">
            <rect width="8" height="8" fill="#0d1014" />
            <rect width="4" height="4" fill="#eaecef" />
            <rect x="4" y="4" width="4" height="4" fill="#eaecef" />
          </pattern>
        </defs>
        <path d={layout.trackPath} fill="none" stroke="#232930" strokeWidth={16} strokeLinecap="round" />
        <path d={layout.trackPath} fill="none" stroke="#3a424c" strokeWidth={2} strokeDasharray="2 10" strokeLinecap="round" />
        <rect x={layout.x0 - 6} y={layout.y1 - 18} width={4} height={36} fill="#eaecef" />
        <text x={layout.x0 - 16} y={layout.y1 + 6} textAnchor="end" fill="#929aa5" fontSize={17} fontWeight={700} letterSpacing={1}>LARGADA</text>
        <rect x={layout.x0 - 10} y={layout.y2 - 18} width={10} height={36} fill={`url(#${patternId})`} />
        <text x={layout.x0 - 18} y={layout.y2 + 6} textAnchor="end" fill="#929aa5" fontSize={17} fontWeight={700} letterSpacing={1}>CHEGADA</text>
        {finished > 0 && (
          <text className="n" x={layout.x0 - 18} y={layout.y2 + 30} textAnchor="end" fill="#0ecb81" fontSize={16} fontWeight={700}>{finished} {finished === 1 ? 'chegou' : 'chegaram'}</text>
        )}
        {stages.map((stage, index) => (
          <StageCell key={stage.id} stage={stage} index={index} layout={layout} runOrder={runOrders[index]} />
        ))}
        {markers.map((marker) => {
          const place = places.get(marker.key);
          if (!place) return null;
          // Líder em amarelo; o roxo é de quem acabou de fazer o melhor tempo da categoria numa estação.
          const stroke = marker.leader ? '#fcd535' : marker.purple ? '#b47cff' : '#c6ccd4';
          return (
            <g key={marker.key} className={styles.marker} style={{ transform: `translate(${place.x.toFixed(1)}px, ${place.y.toFixed(1)}px)` }}>
              <circle
                r={place.radius}
                fill={marker.estimated ? '#0d1014' : marker.leader ? '#fcd535' : marker.purple ? '#b47cff' : '#eaecef'}
                stroke={marker.estimated ? stroke : '#0d1014'}
                strokeWidth={marker.estimated ? 2.5 : 2}
              />
              <text className="n" y={place.radius * 0.35} textAnchor="middle" fontSize={place.radius * 0.95} fontWeight={700} fill={marker.estimated ? (marker.leader ? '#fcd535' : '#eaecef') : '#14171c'}>{marker.position ?? ''}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cartões
// ---------------------------------------------------------------------------

function CardABox({ card }: { card: RaceCardA | RacePurpleCard | null }) {
  if (!card) return <div className={styles.card}><div className={styles.cardEb}>Onda</div></div>;
  const key = card.kind === 'battle' ? `battle-${card.ahead.name}-${card.back.name}` : card.kind === 'purple' ? `purple-${card.station}-${card.who}` : card.kind;
  return (
    <div className={`${styles.card} ${card.kind === 'battle' ? styles.cardBattle : ''} ${card.kind === 'purple' ? styles.cardPurple : ''}`}>
      <div className={styles.cardEb}>{card.eyebrow}</div>
      <div key={key} className={styles.cardIn}>
        {card.kind === 'purple' && (
          <div className={styles.pp}>
            <span className={styles.ppSt}>{card.station}</span>
            <span className={`${styles.ppT} ${styles.num}`}>{card.time}</span>
            <span className={styles.ppW}>{card.who}</span>
            <span className={styles.ppWas}>{card.was}</span>
          </div>
        )}
        {card.kind === 'battle' && (
          <div className={styles.bt}>
            <div className={styles.btLine}>
              <span className={`${styles.p} ${styles.num}`}><span>{card.ahead.position ?? '–'}</span></span>
              <div className={styles.w}><b>{card.ahead.name}</b><span>{card.ahead.box}</span></div>
            </div>
            <div className={styles.btGap}><b className={styles.num}>{card.interval}</b><span>{['de diferença', card.trend].filter(Boolean).join(' · ')}</span></div>
            <div className={styles.btLine}>
              <span className={`${styles.p} ${styles.num}`}><span>{card.back.position ?? '–'}</span></span>
              <div className={styles.w}><b>{card.back.name}</b><span>{card.back.box}</span></div>
            </div>
          </div>
        )}
        {card.kind === 'waiting' && (
          <div className={styles.ld}>
            <span className={styles.w}>{card.title}</span>
            <span className={styles.bx}>{card.detail}</span>
            <span className={styles.at}>{card.at}</span>
          </div>
        )}
        {card.kind === 'leader' && (
          <div className={styles.ld}>
            <span className={styles.w}>{card.name}</span>
            <span className={styles.bx}>{card.box}</span>
            <span className={styles.at}>{card.at}</span>
            <span className={styles.adv}>{card.advantage.label}: {card.advantage.known ? <b className={styles.num}>{card.advantage.value}</b> : card.advantage.value}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function CardBBox({ card }: { card: RaceCardB }) {
  return (
    <div className={styles.card}>
      <div className={styles.cardEb}>{card.eyebrow}</div>
      <div key={card.kind === 'finalists' ? 'finalists' : 'next'} className={styles.cardIn}>
        {card.kind === 'finalists' ? (
          <div className={styles.wb}>
            {card.items.map((item) => (
              <div key={item.key} className={styles.wbRow}>
                <div className={styles.w}><b>{[item.position ?? '–', item.name].join(' · ')}</b><span>{[item.box, item.caption].filter(Boolean).join(' · ')}</span></div>
                <span className={`${styles.c} ${styles.num}`}>{item.value}{item.of && <small>{item.of}</small>}</span>
                {item.fraction !== null && <div className={styles.wbBar}><i style={{ transform: `scaleX(${item.fraction.toFixed(3)})` }} /></div>}
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.nx}>
            <span className={styles.w}>{card.title}</span>
            {card.time && <span className={`${styles.h} ${styles.num}`}>{card.time}</span>}
            {card.detail && <span className={styles.c}>{card.detail}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Momentos (Story 1.114): grid de largada, luzes, bandeirada
// ---------------------------------------------------------------------------

/** As cinco unidades de duas lâmpadas; `lit` é quantas estão acesas (o grid mostra todas apagadas). */
function Gantry({ lit }: { lit: number }) {
  return (
    <div className={styles.gantry} aria-hidden="true">
      {Array.from({ length: RACE_LIGHTS_UNITS }, (_, index) => (
        <div key={index} className={`${styles.unit} ${index < lit ? styles.unitOn : ''}`}>
          <i className={styles.lamp} />
          <i className={styles.lamp} />
        </div>
      ))}
    </div>
  );
}

/**
 * Painel das luzes: as unidades acendem uma a uma, apagam juntas, "Largada!" e sai. Os
 * tempos vêm de `raceLightsPlan` (e, com movimento reduzido, sem passo a passo). O telão só
 * mostra: quem larga é o gestor, na seção Ondas.
 */
function LightsOverlay({ start, reduced, placement, onDone }: { start: RaceSeenStart; reduced: boolean; placement: 'screen' | 'map'; onDone: () => void }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const plan = raceLightsPlan(reduced);
    const marks = [...new Set([...plan.litAtMs, plan.offAtMs, plan.endMs])];
    const timers = marks.map((mark) => window.setTimeout(() => {
      setElapsed(mark);
      if (mark >= plan.endMs) onDone();
    }, mark));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [reduced, onDone]);
  const frame = raceLightsFrame(raceLightsPlan(reduced), elapsed);
  if (frame.phase === 'done') return null;
  const className = [styles.lightsOv, placement === 'map' ? styles.lightsMap : styles.lightsScreen, frame.phase === 'go' ? styles.lightsGo : ''].filter(Boolean).join(' ');
  return (
    <div className={className} aria-hidden="true">
      <Gantry lit={frame.lit} />
      <div className={styles.lightsMsg}>{raceLightsMessage(start, frame)}</div>
    </div>
  );
}

/** Bandeirada: cobre o mapa e os cartões, nunca a torre. Fica montada depois de vencer para sair com a transição. */
function FlagOverlay({ arrival, waveTitle, records, on }: { arrival: RaceArrivalView; waveTitle: string | null; records: readonly RaceStationRecord[]; on: boolean }) {
  const view = describeRaceFlag(arrival, waveTitle, records);
  return (
    <div className={`${styles.flag} ${on ? styles.flagOn : ''}`} aria-hidden="true">
      <div className={styles.flagStrip} />
      <div className={styles.flagIn}>
        <div className={styles.flagEb}>{view.eyebrow}</div>
        <div className={styles.flagPos}>
          <b className={styles.num}>{view.position}</b>
          <span>{view.positionCaption}</span>
        </div>
        <div className={styles.flagWho}>
          <b>{view.name}</b>
          <span>{view.who}</span>
        </div>
        <div className={styles.flagTime}>
          <b className={styles.num}>{view.time}</b>
          <span>{view.timeCaption}</span>
          {view.best && <span className={styles.flagBest}>{view.best}</span>}
        </div>
      </div>
    </div>
  );
}

/** O grid da onda: as vagas à esquerda; à direita as luzes apagadas, a hora prevista e o percurso. Também serve à alternância com a classificação (1.115). */
export function RaceGridBody({ frame }: { frame: RaceGridFrame }) {
  return (
    <div className={styles.gridScr}>
      <div className={styles.gLeft}>
        <div className={styles.gTitle}>
          <div className={styles.gEb}>Grid de largada</div>
          <h3>{frame.heading}</h3>
          <p>{frame.summary}{frame.pageCount > 1 ? ` · página ${frame.pageIndex + 1} de ${frame.pageCount}` : ''}</p>
        </div>
        <div key={frame.pageIndex} className={styles.gSlots}>
          {frame.slots.map((slot) => (
            <div key={slot.number} className={styles.gSlot}>
              <span className={`${styles.gN} ${styles.num}`}>{slot.number}</span>
              <div className={styles.gWho}>
                <b>{slot.name}</b>
                <span>{frame.showDivision ? [slot.box, slot.division].filter(Boolean).join(' · ') : slot.box}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className={styles.gRight}>
        <Gantry lit={0} />
        <div className={styles.gWhen}>
          <span className={styles.gLb}>{frame.when.label}</span>
          {frame.when.time && <b className={styles.num}>{frame.when.time}</b>}
          <span>{frame.when.hint}</span>
        </div>
        <div className={styles.gCourse}>
          <span className={styles.gCourseLb}>{frame.course.label}</span>
          {frame.course.stations.map((station, index) => (
            <div key={`${index}-${station.name}`}><b>{station.name}</b>{station.meta && <span>{station.meta}</span>}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Classificação e espera (Story 1.115)
// ---------------------------------------------------------------------------

/** A classificação da categoria do passo: tabela de 10 linhas, melhores por estação e a próxima largada. */
function RaceClassBody({ frame }: { frame: RaceClassFrame }) {
  return (
    <div className={styles.classScr}>
      <div className={styles.cHead}>
        <h3>Classificação · <span className={styles.cCat}>{frame.divisionName}</span></h3>
        {frame.meta && <span className={styles.cMeta}>{frame.meta}</span>}
        <span className={styles.grow} />
        <span className={styles.pager}>
          {frame.pageIndex + 1}/{frame.pageCount}
          {Array.from({ length: frame.pageCount }, (_, index) => <i key={index} className={index === frame.pageIndex ? styles.pagerOn : ''} />)}
        </span>
      </div>
      <div className={styles.cBody}>
        <div key={`${frame.divisionKey}-${frame.pageIndex}`} className={styles.cTable}>
          <div className={styles.cCols}>
            <span>Pos</span>
            <span>Atleta</span>
            <span>Onda</span>
            <span className={styles.r}>Tempo</span>
            <span className={styles.r}>Dif.</span>
          </div>
          {frame.rows.map((row) => (
            <div key={row.key} className={[styles.cRow, row.fresh ? styles.cFresh : '', row.dnf ? styles.cDnf : ''].filter(Boolean).join(' ')}>
              <span className={`${styles.cP} ${styles.num}`}>{row.position}</span>
              <span className={styles.cWho}>
                <span className={styles.cNm}>{row.name}</span>
                <span className={styles.cBx}>{row.box}</span>
                {row.fresh && <span className={styles.tagNew}>NOVO</span>}
              </span>
              <span className={styles.cWv}>{row.wave}</span>
              <span className={`${styles.cTm} ${styles.num}`}>{row.time}</span>
              <span className={`${styles.cDf} ${styles.num}`}>{row.gap}</span>
            </div>
          ))}
          {frame.emptyText && <div className={styles.cEmpty}>{frame.emptyText}</div>}
        </div>
        <div className={styles.cBest}>
          <h4>Melhores por estação</h4>
          <div className={styles.bList}>
            {frame.bests.map((best) => (
              <div key={best.key} className={styles.bRow}>
                <b>{best.station}</b>
                <span className={`${styles.bT} ${styles.num}`}>{best.time}</span>
                <span className={styles.bWho}>{best.who}</span>
              </div>
            ))}
            {frame.bestsEmpty && <p className={styles.bEmpty}>{frame.bestsEmpty}</p>}
          </div>
          <p>{frame.bestsNote}</p>
        </div>
      </div>
      {frame.next && (
        <div className={styles.cNext}>
          <b>{frame.next.label}</b>
          <span className={styles.num}>{frame.next.wave}</span>
          <span className={styles.grow}>{frame.next.detail}</span>
        </div>
      )}
    </div>
  );
}

/** A espera: a marca do evento, a data e as próximas ondas por largar (o horário é só o previsto). */
function RaceStandbyBody({ frame, logoUrl }: { frame: RaceStandbyFrame; logoUrl: string }) {
  const solo = frame.waves.length === 0;
  return (
    <div className={`${styles.waitScr} ${solo ? styles.waitSolo : ''}`}>
      <div className={styles.wBrand}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoUrl || '/icon.svg'} alt="" />
        <h2>{frame.name}</h2>
        {frame.dateText && <p>{frame.dateText}</p>}
        {solo && <p>{frame.emptyText}</p>}
      </div>
      {!solo && (
        <div className={styles.wList}>
          <span className={styles.wLb}>Próximas ondas</span>
          {frame.waves.map((wave, index) => (
            <div key={wave.key} className={`${styles.wItem} ${index === 0 ? styles.wItemNext : ''}`}>
              <span className={`${styles.wH} ${styles.num}`}>{wave.time}</span>
              <div>
                <b>{wave.title}</b>
                <span>{wave.detail}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Moldura
// ---------------------------------------------------------------------------

const SCREEN_LABELS: Record<RaceBroadcastPayload['screen'], string> = {
  live: 'Ao vivo',
  grid: 'Grid de largada',
  class: 'Classificação',
  standby: 'Espera'
};

const timeOfDay = (ms: number, timeZone: string) => {
  const format = (zone: string | undefined) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: zone });
  try {
    return format(timeZone);
  } catch {
    return format(undefined);
  }
};

function NeutralScreen({ payload, text }: { payload: RaceBroadcastPayload; text: string }) {
  return (
    <div className={styles.message}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={payload.event.logoUrl || '/icon.svg'} alt="" />
      <h2>{payload.event.name || 'WODArena'}</h2>
      <p>{text}</p>
    </div>
  );
}

export function RaceBroadcastScreen({ payload, now, localNow, offline, lastOkAt, idle }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const arrows = useRankArrows(payload.live, now);
  const flags = useArrivalFlags(payload.live, now);
  const { start: lightsStart, dismiss: dismissLights } = useSeenStart(payload, now);
  const reducedMotion = usePrefersReducedMotion();

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void stageRef.current?.requestFullscreen?.().catch(() => {});
  };

  const live = payload.screen === 'live' ? payload.live : null;
  const frame = live ? raceLiveFrame(live, now) : null;
  // O grid entra sozinho (`grid`) ou alternando com a classificação, no passo de 12 s que é dele (AC2).
  const gridFrame = payload.screen === 'grid' && payload.grid
    ? raceGridFrame(payload.grid, now)
    : payload.screen === 'class' && payload.class ? raceClassGridFrame(payload.class, now) : null;
  const classFrame = payload.screen === 'class' && payload.class ? raceClassFrame(payload.class, payload.next, now) : null;
  const standbyFrame = payload.screen === 'standby' && payload.standby ? describeRaceStandby(payload.standby, payload.event) : null;
  const header = frame ? describeRaceHeader(frame, now) : null;
  const ticker = live && frame ? raceLastTickerEvent(live, frame.wave.key) : null;
  const tickerView = ticker ? describeRaceTicker(ticker) : null;
  const silence = frame ? raceSilenceNotice(frame.wave, now) : null;
  const agoSeconds = lastOkAt ? Math.max(1, Math.round((localNow - lastOkAt) / 1000)) : null;

  let pill: { text: string; className?: string };
  if (frame) pill = frame.wave.racingCount === 0 ? { text: 'ENCERRADA' } : { text: 'AO VIVO', className: styles.pillLive };
  else if (gridFrame || payload.screen === 'grid') pill = { text: 'GRID', className: styles.pillCall };
  else if (payload.screen === 'class') pill = { text: 'RESULTADOS', className: styles.pillRes };
  else if (payload.screen === 'live') pill = { text: 'AO VIVO', className: styles.pillLive };
  else pill = { text: 'ESPERA' };

  const title = header?.title ?? gridFrame?.title ?? classFrame?.title ?? standbyFrame?.name ?? (payload.screen === 'live' ? 'Ao vivo' : SCREEN_LABELS[payload.screen]);
  const clockMain = header?.clock ?? timeOfDay(now, payload.event.timeZone);
  const clockSub = header?.caption ?? 'Hora local';

  // Rodapé: a faixa da direção de prova ao vivo; no grid, o aviso de que o relógio começa no sinal do organizador;
  // na classificação, a origem do resultado; na espera, a próxima largada.
  const tick = tickerView
    ? { label: 'Direção de prova', key: `${ticker?.kind}-${ticker?.at}-${ticker?.name}`, text: [tickerView.clock, tickerView.text].filter(Boolean).join(' · ') }
    : gridFrame ? { label: gridFrame.footer.label, key: `grid-${gridFrame.waveKey}`, text: gridFrame.footer.text }
      : classFrame ? { label: RACE_CLASS_FOOTER.label, key: 'class', text: RACE_CLASS_FOOTER.text }
        : standbyFrame?.footer ? { label: standbyFrame.footer.label, key: `standby-${standbyFrame.waves[0]?.key ?? ''}`, text: standbyFrame.footer.text } : null;

  // Luzes: no ao vivo de outra onda entram por cima do mapa; nos demais casos cobrem a tela.
  const lightsKey = lightsStart ? `${lightsStart.waveKey}|${lightsStart.startedAt}` : '';
  const lightsOnMap = Boolean(lightsStart && lightsStart.placement === 'map' && frame);

  let body;
  if (frame && live) {
    const purples = racePurpleByAthlete(live.records, now);
    const cardA = describeRaceCardAWithPurple(live, frame, now);
    const cardB = describeRaceCardB(frame.board, payload.next, now);
    const stepKey = boardKey(frame);
    const lastFlag = flags.last;
    body = (
      <div className={styles.live}>
        <Tower key={stepKey} frame={frame} arrows={arrows.get(stepKey)} purples={purples} now={now} />
        <div className={styles.right}>
          <div key={stepKey} className={`${styles.rightIn} ${styles.fade}`}>
            <RouteMap frame={frame} purpleKeys={new Set(purples.keys())} />
            <div className={styles.cards}>
              <CardABox card={cardA} />
              <CardBBox card={cardB} />
            </div>
          </div>
          {lastFlag && <FlagOverlay arrival={lastFlag} waveTitle={raceArrivalWaveTitle(live, lastFlag)} records={live.records} on={flags.current !== null} />}
          {lightsStart && lightsOnMap && <LightsOverlay key={lightsKey} start={lightsStart} reduced={reducedMotion} placement="map" onDone={dismissLights} />}
        </div>
      </div>
    );
  } else if (gridFrame) {
    body = <RaceGridBody frame={gridFrame} />;
  } else if (classFrame) {
    body = <RaceClassBody frame={classFrame} />;
  } else if (standbyFrame) {
    body = <RaceStandbyBody frame={standbyFrame} logoUrl={payload.event.logoUrl} />;
  } else if (payload.screen === 'live') {
    body = <NeutralScreen payload={payload} text="Nenhuma onda com atletas no ar neste momento." />;
  } else {
    body = <NeutralScreen payload={payload} text={`${SCREEN_LABELS[payload.screen]}. Esta tela ainda está sendo preparada.`} />;
  }

  return (
    <div ref={stageRef} className={`${styles.stage} ${idle ? styles.idle : ''}`}>
      <div className={styles.tv} role="region" aria-label="Telão ao vivo" aria-live="off">
        <div className={styles.frame}>
          <header className={styles.top}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className={styles.logo} src={payload.event.logoUrl || '/icon.svg'} alt="" />
            <div className={styles.id}>
              <div className={styles.event}>{payload.event.name || 'WODArena'}</div>
              <div className={styles.title}>{title}</div>
            </div>
            <div className={`${styles.pill} ${pill.className ?? ''}`}><i /><span>{pill.text}</span></div>
            <div className={styles.clock}><b className={styles.num}>{clockMain}</b><span>{clockSub}</span></div>
          </header>
          <div key={payload.screen} className={styles.body}>{body}</div>
          <footer className={styles.foot}>
            {offline
              ? <span className={styles.offline}><WifiOff aria-hidden="true" />Sem conexão · mostrando {lastOkAt ? new Date(lastOkAt).toLocaleTimeString('pt-BR') : 'a última tela'}</span>
              : agoSeconds !== null && <span className={styles.sync}>Atualizado há <b className={styles.num}>{agoSeconds} s</b></span>}
            {silence && <span className={styles.silence}>{silence}</span>}
            <span className={styles.tick}>
              {tick ? (
                <>
                  <b className={styles.tickLabel}><span>{tick.label}</span></b>
                  <span key={tick.key} className={styles.tickText}>{tick.text}</span>
                </>
              ) : <span className={styles.grow} />}
            </span>
            <span className={styles.brand}>WODARENA</span>
          </footer>
          {lightsStart && !lightsOnMap && <LightsOverlay key={lightsKey} start={lightsStart} reduced={reducedMotion} placement="screen" onDone={dismissLights} />}
        </div>
      </div>
      <button type="button" className={styles.fullscreen} onClick={toggleFullscreen}>
        <Maximize size={16} aria-hidden="true" />Tela cheia
      </button>
    </div>
  );
}
