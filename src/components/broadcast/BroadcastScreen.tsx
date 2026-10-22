'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Check, ChevronDown, ChevronUp, Maximize, Minus, WifiOff } from 'lucide-react';

import {
  broadcastIntervalPhase,
  describeIntervalClock,
  intervalLaneProgress,
  intervalSchemeText,
  type BroadcastLiveEntry,
  type BroadcastPayload,
  type BroadcastStandingsBoard,
  type BroadcastWorkout
} from '@/lib/broadcastPayload';
import styles from './Broadcast.module.css';

// Telão ao vivo (Story 1.57), aberto na TV pelo link secreto do gestor. Pergunta
// ao servidor a cada 1 s durante a bateria e a cada 5 s no resto; sem conexão,
// mantém a última tela e avisa. O relógio da bateria anda no aparelho, acertado
// pela hora do servidor. Desenho aprovado: docs/design/telao-ao-vivo/ (C).

const LIVE_POLL_MS = 1_000;
const IDLE_POLL_MS = 5_000;
const PAGE_MS = 10_000;
const ROWS_PER_PAGE = 10;
const MAX_LIST_HEIGHT = 42;
const IDLE_CURSOR_MS = 3_000;

type Status = 'loading' | 'ok' | 'revoked' | 'error';

const fmt = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
};

const clockTime = (ms: number) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const formatLabel = (format: BroadcastWorkout['format']) => (
  format === 'amrap' ? 'AMRAP' : format === 'max_load' ? 'Carga máxima' : format === 'interval' ? 'Intervalado' : 'For Time'
);
/** Rótulo do tempo da prova: o intervalado e o AMRAP têm duração, nunca "time cap" (Story 1.63). */
const capWord = (format: BroadcastWorkout['format']) => (
  format === 'amrap' || format === 'interval' ? 'Duração' : format === 'max_load' ? 'Janela' : 'Time cap'
);
const joinWords = (items: string[]) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}` : items[0] ?? '');
const workoutTitle = (workout: BroadcastWorkout | null) => (
  workout ? [workout.code, workout.scheme ? `${workout.scheme} ${joinWords(workout.lines)}` : workout.name].filter(Boolean).join(' · ') : 'Prova'
);

function useBroadcast(token: string) {
  const [payload, setPayload] = useState<BroadcastPayload | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [message, setMessage] = useState('');
  const [offline, setOffline] = useState(false);
  const [lastOkAt, setLastOkAt] = useState<number | null>(null);
  const offset = useRef(0);
  const screen = useRef<BroadcastPayload['screen'] | null>(null);
  const appVersion = useRef<string | null>(null);

  useEffect(() => {
    let timer: number | null = null;
    let etag = '';
    let failures = 0;
    let stopped = false;

    const schedule = () => {
      if (stopped) return;
      const base = screen.current === 'live' ? LIVE_POLL_MS : IDLE_POLL_MS;
      timer = window.setTimeout(tick, failures > 0 ? Math.min(IDLE_POLL_MS, base * 2 ** failures) : base);
    };

    const tick = async () => {
      try {
        const response = await fetch(`/api/telao/${encodeURIComponent(token)}`, {
          cache: 'no-store',
          headers: etag ? { 'If-None-Match': etag } : {}
        });
        failures = 0;
        setOffline(false);
        if (response.status === 304) {
          setLastOkAt(Date.now());
        } else if (response.status === 404) {
          const data = await response.json().catch(() => ({})) as { error?: string };
          setStatus('revoked');
          setMessage(data.error || 'Link do telão desativado.');
          screen.current = null;
        } else if (!response.ok) {
          const data = await response.json().catch(() => ({})) as { error?: string };
          setStatus((current) => (current === 'ok' ? 'ok' : 'error'));
          setMessage(data.error || 'O telão não conseguiu carregar o evento.');
          if (response.status >= 500) setOffline(true);
        } else {
          const data = await response.json() as BroadcastPayload;
          if (appVersion.current !== null && data.appVersion && data.appVersion !== appVersion.current) {
            window.location.reload();
            return;
          }
          appVersion.current = data.appVersion || appVersion.current || '';
          etag = response.headers.get('ETag') || '';
          offset.current = Date.parse(data.serverTime) - Date.now();
          screen.current = data.screen;
          setPayload(data);
          setStatus('ok');
          setLastOkAt(Date.now());
        }
      } catch {
        failures += 1;
        setOffline(true);
      } finally {
        schedule();
      }
    };

    void tick();
    return () => {
      stopped = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [token]);

  return { payload, status, message, offline, lastOkAt, offset };
}

function useNow(stepMs: number, offset: { current: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), stepMs);
    return () => window.clearInterval(timer);
  }, [stepMs]);
  return { serverNow: now + offset.current, localNow: now };
}

/** Tela cheia, cursor escondido parado e pedido para a TV não apagar a tela. */
function useTvChrome() {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    let timer: number | null = null;
    const wake = () => {
      setIdle(false);
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => setIdle(true), IDLE_CURSOR_MS);
    };
    wake();
    window.addEventListener('pointermove', wake);
    window.addEventListener('keydown', wake);

    type WakeLockSentinel = { release: () => Promise<void> };
    let lock: WakeLockSentinel | null = null;
    const requestLock = async () => {
      try {
        const wakeLock = (navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinel> } }).wakeLock;
        if (wakeLock && document.visibilityState === 'visible') lock = await wakeLock.request('screen');
      } catch {
        lock = null;
      }
    };
    const onVisible = () => { if (document.visibilityState === 'visible') void requestLock(); };
    void requestLock();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener('pointermove', wake);
      window.removeEventListener('keydown', wake);
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release().catch(() => {});
    };
  }, []);
  return idle;
}

// ---------------------------------------------------------------------------
// Bateria ao vivo
// ---------------------------------------------------------------------------

type EntryView = { value: string; unit: string; line: string; lineStrong: string; official: boolean; capped: boolean };

const describeEntry = (entry: BroadcastLiveEntry, workout: BroadcastWorkout | null, elapsed: number | null): EntryView => {
  const cap = workout?.timeCapSeconds ?? null;
  const capped = workout?.format === 'for_time' && entry.completedAt === null && cap !== null && elapsed !== null && elapsed >= cap;
  const official = entry.status === 'submitted' && Boolean(entry.officialResult);
  const interval = workout?.format === 'interval' ? workout.intervalSpec : null;
  const segmentIndex = workout?.segments.findIndex((segment) => segment.id === entry.currentSegmentId) ?? -1;
  const segment = segmentIndex >= 0 ? workout?.segments[segmentIndex] : undefined;

  let value = String(entry.repsDone);
  let unit = '';
  if (official) value = entry.officialResult as string;
  else if (workout?.format === 'max_load') { value = entry.scoreKg ? String(entry.scoreKg) : '–'; unit = 'kg'; }
  // Intervalado: o resultado parcial (repsDone do resumo ao vivo), em repetições.
  else if (interval && entry.status !== 'waiting') unit = 'reps';
  else if (workout?.format === 'for_time' && entry.completedAt !== null) value = fmt(entry.completedAt);
  else if (workout?.format === 'amrap' && workout.scoreDisplay === 'rounds_reps' && workout.totalReps > 0) {
    value = `${entry.roundsCompleted}+${entry.repsDone - entry.roundsCompleted * workout.totalReps}`;
  }
  if (entry.status === 'waiting') value = '–';

  let line = '';
  let lineStrong = '';
  if (entry.status === 'waiting') line = 'Aguardando o primeiro registro';
  else if (official) lineStrong = 'Oficial';
  else if (entry.status === 'returned') line = 'Súmula em correção';
  else if (entry.status === 'submitted') line = 'Enviada';
  else if (workout?.format === 'for_time' && entry.completedAt !== null) line = 'Terminou · aguardando a súmula';
  else if (capped) line = `Time cap · ${entry.repsDone} reps · aguardando a súmula`;
  else if (workout?.format === 'max_load') line = entry.scoreKg ? 'Melhor carga válida' : 'Sem tentativa válida ainda';
  else if (interval && entry.currentSegmentId === interval.max.id) lineStrong = `Máx. ${interval.max.name}`;
  else if (segment) {
    lineStrong = segment.label;
    line = ` · faltam ${Math.max(0, segment.reps - (entry.segments[segmentIndex] ?? 0))}`;
    if (workout?.format === 'amrap') line += ` · round ${entry.roundsCompleted + 1}`;
  }
  return { value, unit, line, lineStrong, official, capped };
};

function ProgressBar({ entry, workout }: { entry: BroadcastLiveEntry; workout: BroadcastWorkout | null }) {
  if (!workout || workout.format === 'max_load' || workout.segments.length === 0) return null;
  return (
    <div className={styles.bar} aria-hidden="true">
      {workout.segments.map((segment, index) => {
        const done = entry.segments[index] ?? 0;
        const fill = segment.reps > 0 ? Math.min(1, done / segment.reps) : 0;
        return (
          <span key={segment.id} style={{ flex: Math.max(1, segment.reps) }} className={segment.id === entry.currentSegmentId ? styles.cur : undefined}>
            <i style={{ transform: `scaleX(${fill})` }} />
          </span>
        );
      })}
    </div>
  );
}

function LiveBoard({ live, now }: { live: NonNullable<BroadcastPayload['live']>; now: number }) {
  const workout = live.heat.workout;
  const elapsed = live.startedAt ? (now - Date.parse(live.startedAt)) / 1000 : null;
  // Intervalado: a fase vem do relógio da bateria (o mesmo do cabeçalho), pela função da súmula.
  const spec = workout?.format === 'interval' ? workout.intervalSpec : null;
  const phase = spec && elapsed !== null ? broadcastIntervalPhase(spec, elapsed) : null;
  const entries = spec && workout
    ? live.entries.map((entry) => {
      const { segments, currentSegmentId } = intervalLaneProgress(entry, workout, phase);
      return { ...entry, segments, currentSegmentId };
    })
    : live.entries;
  const leader = entries[0]?.position ? entries[0] : null;
  const rest = leader ? entries.slice(1) : entries;
  const rowHeight = Math.min(5.5, MAX_LIST_HEIGHT / Math.max(rest.length, 1));
  const rowStyle = (index: number): CSSProperties => ({
    height: `${rowHeight}cqw`,
    transform: `translateY(${index * rowHeight}cqw)`,
    ['--rs' as string]: String(Math.max(0.6, rowHeight / 5.5))
  });

  const leaderView = leader ? describeEntry(leader, workout, elapsed) : null;
  const second = leader ? rest.find((entry) => entry.position !== null) : undefined;
  let gapLabel = '';
  let gapValue = '';
  if (leader && second) {
    if (workout?.format === 'max_load') { gapLabel = 'Vantagem sobre o 2º'; gapValue = `+${Math.max(0, (leader.scoreKg ?? 0) - (second.scoreKg ?? 0))} kg`; }
    else if (leader.completedAt !== null && second.completedAt !== null) { gapLabel = 'Vantagem sobre o 2º'; gapValue = fmt(second.completedAt - leader.completedAt); }
    else if (leader.completedAt !== null) { gapLabel = '2º lugar'; gapValue = `${second.repsDone} reps`; }
    else { gapLabel = 'Vantagem sobre o 2º'; gapValue = `+${leader.repsDone - second.repsDone} reps`; }
  }

  return (
    <div className={styles.live}>
      <div className={styles.lead}>
        {leader && leaderView ? (
          <div key={leader.key} className={styles.leadInner}>
            <div className={`${styles.leadPos} ${styles.num}`}>{leader.position}<small>º</small></div>
            <div className={styles.leadWho}>
              <div className={styles.ln}>{leader.lane ? `Raia ${leader.lane}` : leader.divisionName}</div>
              <div className={styles.nm}>{leader.name}</div>
              <div className={styles.bx}>{leader.box}</div>
            </div>
            <div className={styles.leadStat}>
              <div className={`${styles.leadValue} ${styles.num} ${leaderView.official ? styles.official : ''}`}>
                <span key={leaderView.value} className={styles.bump}>{leaderView.value}</span>
                {workout?.format === 'for_time' && leader.completedAt === null && !leaderView.official && <small>/{workout.totalReps}</small>}
                {leaderView.unit && <small> {leaderView.unit}</small>}
              </div>
              <div className={styles.leadLine}>
                {leaderView.lineStrong && <b className={leaderView.official ? styles.official : undefined}>{leaderView.lineStrong}</b>}{leaderView.line}
              </div>
            </div>
            <div className={styles.gap}>{gapLabel ? <><span>{gapLabel}</span><b className={styles.num}>{gapValue}</b></> : <span>Primeiro registro da bateria</span>}</div>
          </div>
        ) : (
          <div className={styles.leadInner}>
            <div className={styles.leadWho}><div className={styles.nm}>Bateria começando</div><div className={styles.bx}>Aguardando os primeiros registros das súmulas</div></div>
          </div>
        )}
      </div>
      <div className={styles.list}>
        {rest.map((entry, index) => {
          const view = describeEntry(entry, workout, elapsed);
          return (
            <div key={entry.key} className={`${styles.row} ${entry.status === 'waiting' ? styles.waiting : ''}`} style={rowStyle(index)}>
              <div className={`${styles.p} ${styles.num}`}>{entry.position ? `${entry.position}º` : '–'}</div>
              <div className={styles.ln}>{entry.lane ? `R${entry.lane}` : '–'}</div>
              <div style={{ minWidth: 0 }}>
                <div className={styles.nm}>{entry.name}</div>
                <div className={styles.bx}>{[entry.box, live.heat.divisionNames.length > 1 ? entry.divisionName : ''].filter(Boolean).join(' · ')}</div>
              </div>
              <div className={styles.prog}>
                <ProgressBar entry={entry} workout={workout} />
                <div className={styles.progCap}>{view.lineStrong && <b className={view.official ? styles.official : undefined}>{view.lineStrong}</b>}{view.line}</div>
              </div>
              <div className={`${styles.v} ${styles.num} ${view.official ? styles.official : ''}`}>
                {view.capped && !view.official && <small>CAP</small>}
                <span key={view.value} className={styles.bump}>{view.value}</span>
                {view.unit && <small>{view.unit}</small>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chamada, intervalo e espera
// ---------------------------------------------------------------------------

function CallBoard({ call }: { call: NonNullable<BroadcastPayload['call']> }) {
  const workout = call.heat.workout;
  const dense = call.lanes.length > 8;
  const columns = dense ? 3 : 2;
  const opened = call.lanes.filter((lane) => lane.sheetOpened).length;
  const capLabel = workout?.timeCapSeconds ? `${capWord(workout.format)} ${fmt(workout.timeCapSeconds)}` : '';
  const scheme = workout?.format === 'interval' && workout.intervalSpec ? intervalSchemeText(workout.intervalSpec) : '';
  return (
    <div className={styles.call}>
      <div
        className={`${styles.lanes} ${dense ? styles.lanesDense : ''}`}
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${Math.max(1, Math.ceil(call.lanes.length / columns))}, minmax(0, 1fr))` }}
      >
        {call.lanes.map((lane, index) => (
          <div key={`${lane.lane ?? 'x'}-${index}`} className={styles.lane}>
            <div className={`${styles.ln} ${styles.num}`}>{lane.lane ?? '–'}</div>
            <div style={{ minWidth: 0 }}>
              <div className={styles.nm}>{lane.name}</div>
              <div className={styles.bx}>{[lane.box, call.heat.divisionNames.length > 1 ? lane.divisionName : ''].filter(Boolean).join(' · ')}</div>
            </div>
            {lane.sheetOpened ? <Check className={styles.ready} aria-label="Judge na raia" /> : <span />}
          </div>
        ))}
      </div>
      <div className={styles.side}>
        <div className={styles.spec}>
          <div className={styles.label}>{[workout?.code, workout ? formatLabel(workout.format) : ''].filter(Boolean).join(' · ')}</div>
          {workout?.scheme
            ? <div className={`${styles.big} ${styles.num}`}>{workout.scheme}</div>
            : <div className={`${styles.big} ${styles.bigName}`}>{workout?.name ?? 'Prova'}</div>}
          {scheme && <div className={styles.scheme}>{scheme}</div>}
          {workout?.lines.map((line) => <div key={line} className={styles.mv}>{line}</div>)}
          {capLabel && <div className={styles.cap}>{capLabel}</div>}
        </div>
        <div className={styles.when}>
          <div className={styles.label}>Na quadra</div>
          <div className={styles.whenBig}>{opened > 0 ? `${opened} de ${call.lanes.length} judges prontos` : 'Atletas para as raias'}</div>
          {call.heat.time && <div className={styles.whenSmall}>Horário previsto no cronograma: {call.heat.time}</div>}
        </div>
      </div>
    </div>
  );
}

function StandingsBoard({ board, afterTitle, pageIndex, pageCount, progress, rows, next }: {
  board: BroadcastStandingsBoard;
  afterTitle: string;
  pageIndex: number;
  pageCount: number;
  progress: number;
  rows: BroadcastStandingsBoard['rows'];
  next: BroadcastPayload['next'];
}) {
  const columns = `4.4cqw 4.6cqw minmax(0, 1fr) ${board.columns.map(() => '11cqw').join(' ')} 8cqw`;
  return (
    <div className={styles.int}>
      <div className={styles.intHead}>
        <h2>Geral · {board.divisionName}</h2>
        <span>{[afterTitle, `${board.athleteCount} ${board.athleteCount === 1 ? 'atleta' : 'atletas'}`].filter(Boolean).join(' · ')}</span>
        <div className={styles.grow} />
        {pageCount > 1 && (
          <div className={styles.page}>
            <span className={styles.num}>{pageIndex + 1}/{pageCount}</span>
            <div className={styles.track}><i style={{ width: `${progress * 100}%` }} /></div>
          </div>
        )}
      </div>
      <div className={styles.cols} style={{ gridTemplateColumns: columns }}>
        <span>Pos</span><span>Var</span><span>Atleta</span>
        {board.columns.map((column) => <span key={column.label} className={`${styles.r} ${column.fresh ? styles.hot : ''}`}>{column.label}</span>)}
        <span className={styles.r}>Pontos</span>
      </div>
      <div className={styles.ibody}>
        {rows.length === 0 && <p className={styles.cellEmpty}>Nenhum resultado publicado nesta categoria ainda.</p>}
        {rows.map((row, index) => {
          const Icon = row.delta > 0 ? ChevronUp : row.delta < 0 ? ChevronDown : Minus;
          return (
            <div key={`${row.name}-${index}`} className={`${styles.irow} ${row.fresh ? styles.rowFresh : ''}`} style={{ gridTemplateColumns: columns }}>
              <span className={`${styles.p} ${styles.num}`}>{row.position}</span>
              <span className={`${styles.var} ${styles.num} ${row.delta > 0 ? styles.up : row.delta < 0 ? styles.down : ''}`}>
                <Icon aria-hidden="true" strokeWidth={3} />{row.delta ? Math.abs(row.delta) : ''}
              </span>
              <span className={styles.who}>
                <span className={styles.nm}>{row.name}</span>
                {row.fresh && <span className={styles.fresh}>NOVO</span>}
                <span className={styles.bx}>{row.box}</span>
              </span>
              {row.cells.map((cell, cellIndex) => (
                <span key={cellIndex} className={`${styles.cell} ${styles.num} ${board.columns[cellIndex]?.fresh && row.fresh ? styles.cellHot : ''} ${cell ? '' : styles.cellEmpty}`}>
                  {cell ? <>{cell.rank ? `${cell.rank}º` : ''}<small>{cell.result}</small></> : '–'}
                </span>
              ))}
              <span className={`${styles.pts} ${styles.num}`}>{row.points}</span>
            </div>
          );
        })}
      </div>
      {next ? (
        <div className={styles.next}>
          <span className={styles.label}>Próxima bateria</span>
          <b>{[next.title, ...next.divisionNames].join(' · ')}</b>
          <span className={styles.grow}>{next.workoutName}</span>
          {next.time && <span className={styles.muted}>Previsto {next.time}</span>}
        </div>
      ) : <div />}
    </div>
  );
}

function IntervalBoard({ interval, next, now }: { interval: NonNullable<BroadcastPayload['interval']>; next: BroadcastPayload['next']; now: number }) {
  const pages = interval.boards.flatMap((board) => {
    const count = Math.max(1, Math.ceil(board.rows.length / ROWS_PER_PAGE));
    return Array.from({ length: count }, (_, page) => ({ board, page, count }));
  });
  if (pages.length === 0) {
    return <Message title="Classificação geral" text="Nenhuma categoria com resultado publicado ainda." />;
  }
  const slot = Math.floor(now / PAGE_MS) % pages.length;
  const { board, page, count } = pages[slot];
  return (
    <StandingsBoard
      board={board}
      afterTitle={interval.afterTitle}
      pageIndex={page}
      pageCount={count}
      progress={(now % PAGE_MS) / PAGE_MS}
      rows={board.rows.slice(page * ROWS_PER_PAGE, (page + 1) * ROWS_PER_PAGE)}
      next={next}
    />
  );
}

function StandbyBoard({ payload }: { payload: BroadcastPayload }) {
  const upcoming = payload.standby?.upcoming ?? [];
  return (
    <div className={styles.wait}>
      <div className={styles.waitBrand}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={payload.event.logoUrl || '/Ativo_1.svg'} alt="" />
        <h2>{payload.event.name}</h2>
        <p>{upcoming.length > 0 ? 'As próximas baterias aparecem aqui assim que os judges abrirem as súmulas.' : 'Acompanhe o placar ao vivo neste telão.'}</p>
      </div>
      <div>
        {upcoming.map((item, index) => (
          <div key={`${item.title}-${index}`} className={styles.item}>
            <div className={`${styles.h} ${styles.num}`}>{item.time || '—'}</div>
            <div><b>{[item.title, ...item.divisionNames].join(' · ')}</b><span>{item.workoutName}</span></div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Message({ title, text }: { title: string; text: string }) {
  return (
    <div className={styles.message}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icon.svg" alt="" />
      <h2>{title}</h2>
      <p>{text}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Moldura
// ---------------------------------------------------------------------------

export function BroadcastScreen({ token }: { token: string }) {
  const { payload, status, message, offline, lastOkAt, offset } = useBroadcast(token);
  const idle = useTvChrome();
  const { serverNow: now, localNow } = useNow(250, offset);
  const stageRef = useRef<HTMLDivElement>(null);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void stageRef.current?.requestFullscreen?.().catch(() => {});
  };

  const live = payload?.screen === 'live' ? payload.live : null;
  const elapsed = live?.startedAt ? Math.max(0, (now - Date.parse(live.startedAt)) / 1000) : null;
  const cap = live?.heat.workout?.timeCapSeconds ?? null;
  // Intervalado: round e fase pelo relógio da bateria (recalculados a cada passo do relógio local).
  const liveSpec = live?.heat.workout?.format === 'interval' ? live.heat.workout.intervalSpec : null;
  const intervalClock = liveSpec && elapsed !== null ? describeIntervalClock(liveSpec, broadcastIntervalPhase(liveSpec, elapsed)) : null;

  let titleText = 'Telão ao vivo';
  let category = '';
  let subtitle = '';
  let pill: { text: string; className?: string } = { text: 'TELÃO' };
  let clockMain = clockTime(now);
  let clockSub = 'horário';
  let countdown: { caption: string; value: string } | null = null;
  let footText = 'Placar ao vivo pelas súmulas digitais';

  if (status === 'ok' && payload) {
    if (payload.screen === 'live' && payload.live) {
      const heat = payload.live.heat;
      titleText = workoutTitle(heat.workout);
      category = heat.divisionNames.join(' · ');
      subtitle = heat.heatCount ? `${heat.title} de ${heat.heatCount}` : heat.title;
      pill = payload.live.finished ? { text: 'ENCERRADA' } : { text: 'AO VIVO', className: styles.pillLive };
      clockMain = elapsed === null ? '--:--' : fmt(cap ? Math.min(elapsed, cap) : elapsed);
      if (intervalClock) {
        // Intervalado: round e fase no lugar do subtítulo, com a contagem regressiva ao lado.
        clockSub = intervalClock.line;
        countdown = intervalClock.countdownCaption && intervalClock.countdown
          ? { caption: intervalClock.countdownCaption, value: intervalClock.countdown }
          : null;
      } else {
        clockSub = cap ? (elapsed !== null && elapsed >= cap ? 'time cap' : `de ${fmt(cap)}`) : 'tempo de prova';
      }
      footText = 'Parcial. O resultado oficial sai quando o judge envia a súmula';
    } else if (payload.screen === 'call' && payload.call) {
      const heat = payload.call.heat;
      titleText = workoutTitle(heat.workout);
      category = heat.divisionNames.join(' · ');
      subtitle = heat.heatCount ? `${heat.title} de ${heat.heatCount}` : heat.title;
      pill = { text: 'CHAMADA', className: styles.pillCall };
      footText = 'Raias conforme o cronograma e as súmulas abertas pelos judges';
    } else if (payload.screen === 'interval') {
      titleText = 'Classificação geral';
      category = payload.interval?.boards.map((board) => board.divisionName).join(' · ') ?? '';
      subtitle = payload.interval?.afterTitle ?? '';
      pill = { text: 'INTERVALO' };
      footText = 'Resultados publicados pelas súmulas · pontos por colocação (menor soma vence)';
    } else {
      titleText = 'Próximas baterias';
      pill = { text: 'PROGRAMAÇÃO' };
      footText = 'Ordem conforme o cronograma oficial';
    }
  }

  const agoSeconds = lastOkAt ? Math.max(1, Math.round((localNow - lastOkAt) / 1000)) : null;

  let body;
  if (status === 'revoked') body = <Message title="Link do telão desativado" text={message} />;
  else if (!payload) body = status === 'error' ? <Message title="Telão indisponível" text={message} /> : <Message title="Conectando ao evento" text="O placar aparece em instantes." />;
  else if (payload.screen === 'live' && payload.live) body = <LiveBoard live={payload.live} now={now} />;
  else if (payload.screen === 'call' && payload.call) body = <CallBoard call={payload.call} />;
  else if (payload.screen === 'interval' && payload.interval) body = <IntervalBoard interval={payload.interval} next={payload.next} now={now} />;
  else body = <StandbyBoard payload={payload} />;

  return (
    <div ref={stageRef} className={`${styles.stage} ${idle ? styles.idle : ''}`}>
      <div className={styles.tv} role="region" aria-label="Telão ao vivo" aria-live="off">
        <div className={styles.frame}>
          <header className={styles.top}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className={styles.logo} src={payload?.event.logoUrl || '/icon.svg'} alt="" />
            <div className={styles.id}>
              <div className={styles.event}>{payload?.event.name || 'WODArena'}</div>
              <div className={styles.title}>{titleText}</div>
            </div>
            {(category || subtitle) && <div className={styles.cat}><b>{category}</b><span>{subtitle}</span></div>}
            <div className={`${styles.pill} ${pill.className ?? ''}`}><i />{pill.text}</div>
            {countdown && <div className={styles.countdown}><b className={styles.num}>{countdown.value}</b><span>{countdown.caption}</span></div>}
            <div className={`${styles.clock} ${intervalClock ? styles.clockPhase : ''}`}><b className={styles.num}>{clockMain}</b><span>{clockSub}</span></div>
          </header>
          <div key={payload ? `${payload.screen}-${payload.live?.heat.key ?? payload.call?.heat.key ?? ''}` : status} className={styles.body}>{body}</div>
          <footer className={styles.foot}>
            <span className={styles.grow}>{footText}</span>
            {offline
              ? <span className={styles.offline}><WifiOff aria-hidden="true" />Sem conexão · mostrando {lastOkAt ? new Date(lastOkAt).toLocaleTimeString('pt-BR') : 'a última tela'}</span>
              : agoSeconds !== null && <span>Atualizado há <b className={styles.num}>{agoSeconds} s</b></span>}
            <span className={styles.brand}>WODARENA</span>
          </footer>
        </div>
      </div>
      <button type="button" className={styles.fullscreen} onClick={toggleFullscreen}>
        <Maximize size={16} aria-hidden="true" />Tela cheia
      </button>
    </div>
  );
}
