'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Search, ShieldAlert, ChevronDown, ChevronUp, X, TrendingUp, User, Flame, Zap, BarChart3, Clock, Info, ArrowLeftRight } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { useMediaQuery } from '@/hooks/useMediaQuery';

const InstagramIcon = ({ className = 'h-3.5 w-3.5' }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
    <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
  </svg>
);
import { Event, Athlete, Workout, Score } from '@/types';
import { getAgeGroupFromDate } from '@/lib/fitnessRacing';
import { getTeamDisplayName } from '@/lib/teamDisplay';

interface LeaderboardProps {
  event: Event;
}

const getTeamMembersArray = (teamMembers: unknown): { name: string; instagram?: string }[] => {
  if (!teamMembers) return [];
  if (Array.isArray(teamMembers)) return teamMembers as { name: string; instagram?: string }[];
  if (typeof teamMembers === 'string') {
    try {
      const parsed = JSON.parse(teamMembers);
      return Array.isArray(parsed) ? (parsed as { name: string; instagram?: string }[]) : [];
    } catch {
      return [];
    }
  }
  return [];
};

const secondsToTimeStr = (totalSecs: number): string => {
  if (!totalSecs || totalSecs === 999999) return '-';
  const hrs = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  const pad = (num: number) => String(num).padStart(2, '0');
  if (hrs > 0) {
    return `${hrs}:${pad(mins)}:${pad(secs)}`;
  }
  return `${pad(mins)}:${pad(secs)}`;
};

const timeToSeconds = (timeStr: string): number => {
  if (!timeStr || timeStr === '-') return 0;
  const parts = timeStr.trim().split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return 0;
};

// Cores de pódio reutilizadas para o badge numérico de colocação (Functional Fitness)
const getRankBadgeClasses = (rank?: number): string => {
  if (rank === 1) return 'border-primary bg-primary text-ink';
  if (rank === 2) return 'border-slate-300 bg-slate-300 text-ink';
  if (rank === 3) return 'border-amber-600 bg-amber-600 text-ink';
  return 'border-transparent bg-transparent text-muted-soft';
};

// Badge numérico estilizado de colocação, com aria-label (não depende só de cor — WCAG AA)
const RankBadge = ({ rank }: { rank?: number }) => {
  const hasRank = typeof rank === 'number' && rank > 0;
  return (
    <span
      className={`inline-flex items-center justify-center min-w-[2.25rem] h-7 px-2 rounded-md border font-mono text-xs font-black ${getRankBadgeClasses(rank)}`}
      aria-label={hasRank ? `${rank}º lugar` : 'Sem colocação'}
    >
      {hasRank ? `${rank}º` : '–'}
    </span>
  );
};

// Card de resumo: colocação geral + pontos totais reais (Functional Fitness)
const OverallPlacementCard = ({ rank, totalPoints }: { rank?: number; totalPoints?: number }) => (
  <div className="col-span-2 rounded-xl border border-primary/20 bg-primary/5 p-4 flex items-center justify-between gap-3">
    <span className="text-[10px] font-bold text-muted uppercase tracking-wider">Colocação Geral</span>
    <div className="flex items-center gap-3">
      <RankBadge rank={rank} />
      <span className="font-mono text-2xl font-black text-primary leading-none whitespace-nowrap">
        {totalPoints ?? 0}
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted font-sans ml-1">pts</span>
      </span>
    </div>
  </div>
);

// Molécula: pontuação e colocação obtidas por prova (Functional Fitness)
const ScorePerWorkoutList = ({ workouts, scores }: { workouts: Workout[]; scores: Record<string, Score> }) => {
  const ordered = [...workouts].sort((a, b) => a.orderIndex - b.orderIndex);

  if (ordered.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-card-border p-6 text-center">
        <p className="text-xs text-muted">Nenhuma prova cadastrada nesta categoria.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 animate-fadeIn">
      {ordered.map((workout) => {
        const score = scores[workout.id];
        const pending = !score || score.result === '-' || score.result === '';

        return (
          <div key={workout.id} className="rounded-xl border border-card-border/60 bg-dark-gray/30 p-3">
            <p className="text-[11px] font-bold text-white uppercase tracking-wide truncate" title={workout.name}>
              {workout.name}
            </p>
            {pending ? (
              <p className="text-[11px] text-muted-soft mt-2 flex items-center gap-1.5">
                <Clock className="h-3 w-3" /> Aguardando lançamento
              </p>
            ) : (
              <div className="flex items-center justify-between mt-2 gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <RankBadge rank={score.rank} />
                  <span className="font-mono text-[11px] text-muted-soft truncate" title={score.result}>
                    {score.result}
                  </span>
                </div>
                <span className="font-mono text-sm font-black text-primary whitespace-nowrap">
                  {score.points ?? 0}
                  <span className="text-[8px] font-bold uppercase tracking-wider text-muted font-sans ml-0.5">pts</span>
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

type LeaderboardParticipantCellProps = {
  athlete: Athlete;
  rank: number;
  isExpanded: boolean;
  onToggleTeam: () => void;
  onOpenProfile: () => void;
};

const getLeaderboardRankClasses = (rank: number) => {
  if (rank === 1) return 'bg-primary text-ink border-primary';
  if (rank === 2) return 'bg-slate-300 text-ink border-slate-300';
  if (rank === 3) return 'bg-amber-600 text-ink border-amber-600';
  return 'border-transparent text-muted';
};

const LeaderboardParticipantCell = ({
  athlete,
  rank,
  isExpanded,
  onToggleTeam,
  onOpenProfile
}: LeaderboardParticipantCellProps) => {
  const isTeam = athlete.isTeam;
  const members = getTeamMembersArray(athlete.teamMembers);
  const displayName = isTeam ? athlete.name.split('(')[0].trim() : athlete.name;

  return (
    <div
      className="grid min-h-[5.5rem] grid-cols-[3.25rem_1fr] items-center px-3 sm:grid-cols-[3.875rem_1fr] sm:px-4"
      role="button"
      tabIndex={0}
      onClick={onOpenProfile}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpenProfile();
        }
      }}
      aria-label={`Abrir perfil de ${displayName}`}
    >
      <div className="flex justify-center">
        <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full border font-number text-xs font-black ${getLeaderboardRankClasses(rank)}`}>
          {rank > 0 ? rank : '–'}
        </span>
      </div>
      <div className="min-w-0 py-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-xs font-black uppercase tracking-[0.045em] text-white sm:text-sm">
            {displayName}
          </span>
          {isTeam && members.length > 0 && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onToggleTeam();
              }}
              className="inline-flex shrink-0 items-center text-muted-soft transition-colors hover:text-primary"
              aria-label={isExpanded ? 'Ocultar integrantes' : 'Mostrar integrantes'}
              aria-expanded={isExpanded}
            >
              {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          )}
          {!isTeam && athlete.instagram && (
            <a
              href={`https://instagram.com/${athlete.instagram.trim().replace(/^@/, '')}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex shrink-0 text-primary transition-colors hover:text-primary-hover"
              title={`Ver Instagram de ${athlete.name}`}
              onClick={(event) => event.stopPropagation()}
            >
              <InstagramIcon className="h-3.5 w-3.5" />
              <span className="sr-only">Instagram</span>
            </a>
          )}
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-2">
          <span className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted-soft">{athlete.box || 'Box não informado'}</span>
          {athlete.country && (
            <span className="shrink-0 border-l border-card-border/70 pl-2 text-[9px] font-bold uppercase tracking-wider text-muted">{athlete.country}</span>
          )}
        </div>
        {isTeam && isExpanded && members.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-[9px] font-medium text-muted animate-fadeIn">
            {members.map((member, index) => (
              <span key={`${member.name}-${index}`} className="inline-flex items-center gap-1">
                {member.name}
                {member.instagram && (
                  <a
                    href={`https://instagram.com/${member.instagram.trim().replace(/^@/, '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:text-primary-hover"
                    onClick={(event) => event.stopPropagation()}
                    aria-label={`Instagram de ${member.name}`}
                  >
                    <InstagramIcon className="h-2.5 w-2.5" />
                  </a>
                )}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const LeaderboardParticipantHeader = ({
  searchQuery,
  onSearchChange
}: {
  searchQuery: string;
  onSearchChange: (value: string) => void;
}) => (
  <div className="min-w-[17rem] px-3 pb-3 pt-5 sm:min-w-[21rem] sm:px-4">
    <span className="text-xs font-black uppercase tracking-[0.08em] text-white">Participante</span>
    <div className="relative mt-3">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-soft" aria-hidden="true" />
      <input
        type="search"
        placeholder="Buscar atleta ou box"
        value={searchQuery}
        onChange={(event) => onSearchChange(event.target.value)}
        className="h-10 w-full rounded-full border border-muted-soft bg-transparent pl-10 pr-9 text-sm text-white placeholder:text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        aria-label="Buscar atleta ou box"
      />
      {searchQuery && (
        <button
          type="button"
          onClick={() => onSearchChange('')}
          className="absolute right-2.5 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center text-muted transition-colors hover:text-white"
          aria-label="Limpar busca"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  </div>
);

export function Leaderboard({ event }: LeaderboardProps) {
  const { getLeaderboard, loadPublicEventData, publicEventDataStatus } = useApp();
  const isMobile = useMediaQuery('(max-width: 640px)');
  const [selectedCategoryId, setSelectedCategoryId] = useState(event.divisions[0]?.id || '');
  const [searchQuery, setSearchQuery] = useState('');
  const [ageGroupFilter, setAgeGroupFilter] = useState('');
  const [expandedTeams, setExpandedTeams] = useState<Record<string, boolean>>({});
  const [selectedAthleteForProfile, setSelectedAthleteForProfile] = useState<Athlete | null>(null);
  const [selectedTeamForProfile, setSelectedTeamForProfile] = useState<Athlete | null>(null);

  const toggleTeamExpanded = (athleteId: string) => {
    setExpandedTeams(prev => ({
      ...prev,
      [athleteId]: !prev[athleteId]
    }));
  };

  const activeCategoryId = event.divisions.some((division) => division.id === selectedCategoryId)
    ? selectedCategoryId
    : event.divisions[0]?.id || '';

  const activeCategory = event.divisions.find(d => d.id === activeCategoryId);

  const divisionWorkouts = useMemo(() => {
    return event.workouts.filter(w => !w.divisionId || w.divisionId === activeCategoryId);
  }, [event.workouts, activeCategoryId]);

  useEffect(() => {
    void loadPublicEventData(event.id).catch((error) => {
      console.error('[Leaderboard] Erro ao carregar dados públicos do evento:', error);
    });
  }, [event.id, loadPublicEventData]);

  const publicDataStatus = publicEventDataStatus[event.id];

  const leaderboardData = useMemo(
    () => activeCategoryId ? getLeaderboard(event.id, activeCategoryId) : [],
    [activeCategoryId, event.id, getLeaderboard]
  );

  const filteredLeaderboard = useMemo(() => {
    let data = leaderboardData;
    const normalizedQuery = searchQuery.trim().toLowerCase();

    // Filtro por faixa etária se habilitado
    if (event.eventType === 'fitness_racing' && activeCategory?.useAgeGroups && ageGroupFilter) {
      data = data.filter(item => getAgeGroupFromDate(item.athlete.birthDate, activeCategory.ageGroups) === ageGroupFilter);
    }

    // Busca textual por nome ou box/equipe
    if (normalizedQuery) {
      data = data.filter((item) =>
        item.athlete.name.toLowerCase().includes(normalizedQuery) ||
        item.athlete.box.toLowerCase().includes(normalizedQuery)
      );
    }

    return data;
  }, [leaderboardData, searchQuery, ageGroupFilter, event.eventType, activeCategory]);

  // Líder do Fitness Racing para cálculo de diferença
  const leaderTime = useMemo(() => {
    if (event.eventType !== 'fitness_racing') return 0;
    const validTimes = filteredLeaderboard.filter(item => item.totalPoints < 999999);
    return validTimes[0]?.totalPoints || 0;
  }, [filteredLeaderboard, event.eventType]);

  return (
    <div className="space-y-4">
      {/* Filtros de categoria */}
      <div className="border-b border-card-border pb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          {/* CATEGORIAS: Dropdown em mobile, Botões em desktop */}
          {isMobile ? (
            <div className="w-full flex flex-col gap-1.5">
              <label htmlFor={`divisions-${event.id}`} className="text-xs font-bold text-muted uppercase tracking-wider">
                Categoria
              </label>
              <select
                id={`divisions-${event.id}`}
                value={selectedCategoryId}
                onChange={(e) => {
                  setSelectedCategoryId(e.target.value);
                  setAgeGroupFilter('');
                }}
                className="h-10 w-full rounded-md border border-card-border bg-dark-gray px-3 text-sm font-bold text-white uppercase tracking-wider focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                {event.divisions.map((division) => (
                  <option key={division.id} value={division.id}>
                    {division.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="flex w-full gap-1 overflow-x-auto border-b border-card-border pb-1 scrollbar-none lg:w-auto lg:border-b-0 lg:pb-0">
              {event.divisions.map((division) => (
                <button
                  key={division.id}
                  type="button"
                  onClick={() => {
                    setSelectedCategoryId(division.id);
                    setAgeGroupFilter('');
                  }}
                  className={`min-h-9 flex-1 lg:flex-initial text-center rounded-md border px-4 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors whitespace-nowrap ${
                    activeCategoryId === division.id
                      ? 'border-primary bg-primary text-ink'
                      : 'border-transparent text-muted hover:border-card-border hover:bg-dark-gray hover:text-white'
                  }`}
                >
                  {division.name}
                </button>
              ))}
            </div>
          )}

          {/* Filtro de Faixa Etária específico para Fitness Racing */}
          {event.eventType === 'fitness_racing' && activeCategory?.useAgeGroups && (
            <div className="flex flex-col gap-1.5 w-full sm:w-auto sm:flex-row sm:items-end sm:gap-2 lg:flex-grow lg:justify-end">
              <label htmlFor={`leaderboard-age-${event.id}`} className="text-xs font-bold uppercase tracking-wider text-muted">
                Idade
              </label>
              <select
                id={`leaderboard-age-${event.id}`}
                value={ageGroupFilter}
                onChange={(e) => setAgeGroupFilter(e.target.value)}
                className="h-10 w-full sm:w-auto rounded-md border border-card-border bg-dark-gray px-3 text-sm font-bold uppercase tracking-wider text-white focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="">Todas</option>
                {(activeCategory?.ageGroups || ['16-24', '25-29', '30-34', '35-39', '40-44', '45-49', '50-54', '55-59', '60+']).map(ag => (
                  <option key={ag} value={ag}>{ag} anos</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {publicDataStatus === 'loading' && (
        <div className="rounded-lg border border-card-border bg-card px-4 py-3 text-xs font-medium text-muted" role="status">
          Carregando atletas e resultados deste evento...
        </div>
      )}

      {publicDataStatus === 'error' && (
        <div className="flex items-center justify-between gap-4 rounded-lg border border-red-500/30 bg-red-950/20 px-4 py-3 text-xs text-red-200" role="alert">
          <span>Não foi possível carregar os resultados deste evento.</span>
          <button
            type="button"
            onClick={() => void loadPublicEventData(event.id).catch((error) => console.error('[Leaderboard] Retry falhou:', error))}
            className="shrink-0 rounded border border-primary/50 px-3 py-2 font-bold uppercase tracking-wide text-primary hover:bg-primary hover:text-ink"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {/* Matriz de resultados: o participante permanece visível enquanto as provas são comparadas. */}
      {filteredLeaderboard.length > 0 ? (
        <section className="overflow-hidden rounded-xl border border-card-border bg-background shadow-2xl shadow-black/20">
          <div className="flex items-center gap-2 border-b border-card-border bg-dark-gray px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted sm:hidden">
            <ArrowLeftRight className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
            Deslize para comparar as provas
          </div>
          <div className="overflow-x-auto">
            {event.eventType === 'fitness_racing' ? (
              <table className="w-full min-w-[50rem] border-separate border-spacing-0 text-left font-number">
                <thead className="bg-dark-gray">
                  <tr>
                    <th rowSpan={2} className="sticky left-0 z-30 border-b border-r border-card-border bg-dark-gray p-0 align-top shadow-[8px_0_18px_rgba(0,0,0,0.18)]">
                      <LeaderboardParticipantHeader searchQuery={searchQuery} onSearchChange={setSearchQuery} />
                    </th>
                    {activeCategory?.useAgeGroups && (
                      <th rowSpan={2} className="min-w-28 border-b border-r border-card-border px-4 text-center text-xs font-black uppercase tracking-[0.08em] text-white">Faixa etária</th>
                    )}
                    <th className="min-w-44 border-b border-r border-card-border px-5 pt-5 text-center align-top text-sm font-black uppercase tracking-[0.06em] text-white">Tempo total</th>
                    <th className="min-w-36 border-b border-card-border px-5 pt-5 text-center align-top text-sm font-black uppercase tracking-[0.06em] text-white">Diferença</th>
                  </tr>
                  <tr>
                    <th className="border-r border-card-border px-5 pb-4 pt-3 text-center text-[10px] font-bold uppercase tracking-wider text-muted">Resultado</th>
                    <th className="px-5 pb-4 pt-3 text-center text-[10px] font-bold uppercase tracking-wider text-muted">Para o líder</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLeaderboard.map((row, index) => {
                    const hasTime = row.totalPoints < 999999;
                    const diffSecs = hasTime ? row.totalPoints - leaderTime : 0;
                    return (
                      <tr key={row.athlete.id} className="group bg-background transition-colors hover:bg-elevated/30">
                        <td className="sticky left-0 z-20 border-b border-r border-card-border bg-background p-0 shadow-[8px_0_18px_rgba(0,0,0,0.18)] transition-colors group-hover:bg-elevated/30">
                          <LeaderboardParticipantCell
                            athlete={row.athlete}
                            rank={row.rank}
                            isExpanded={Boolean(expandedTeams[row.athlete.id])}
                            onToggleTeam={() => toggleTeamExpanded(row.athlete.id)}
                            onOpenProfile={() => row.athlete.isTeam ? setSelectedTeamForProfile(row.athlete) : setSelectedAthleteForProfile(row.athlete)}
                          />
                        </td>
                        {activeCategory?.useAgeGroups && (
                          <td className="border-b border-r border-card-border px-4 text-center text-xs font-semibold text-muted">
                            {getAgeGroupFromDate(row.athlete.birthDate, activeCategory.ageGroups)} anos
                          </td>
                        )}
                        <td className="border-b border-r border-card-border bg-primary/[0.035] px-5 text-center text-lg font-black text-white">
                          {hasTime ? secondsToTimeStr(row.totalPoints) : '–'}
                        </td>
                        <td className="border-b border-card-border px-5 text-center text-sm font-black text-primary">
                          {hasTime && diffSecs > 0 ? `+${secondsToTimeStr(diffSecs)}` : hasTime && index === 0 ? 'Líder' : '–'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <table className="w-full min-w-[70rem] border-separate border-spacing-0 text-left font-number">
                <thead className="bg-dark-gray">
                  <tr>
                    <th rowSpan={2} className="sticky left-0 z-30 border-b border-r border-card-border bg-dark-gray p-0 align-top shadow-[8px_0_18px_rgba(0,0,0,0.18)]">
                      <LeaderboardParticipantHeader searchQuery={searchQuery} onSearchChange={setSearchQuery} />
                    </th>
                    <th className="min-w-28 border-b border-r border-card-border px-4 pt-5 text-center align-top text-sm font-black uppercase tracking-[0.06em] text-white">Total</th>
                    {divisionWorkouts.map((workout) => (
                      <th key={workout.id} className="min-w-44 border-b border-r border-card-border px-4 pt-5 align-top last:border-r-0">
                        <div className="flex items-center justify-center gap-1.5 text-center text-sm font-black uppercase tracking-[0.06em] text-white">
                          <span className="max-w-36 truncate" title={workout.name}>{workout.name}</span>
                          <Info className="h-4 w-4 shrink-0 text-muted" aria-label={workout.timeCap ? `Time cap: ${workout.timeCap}` : `Detalhes de ${workout.name}`} />
                        </div>
                      </th>
                    ))}
                  </tr>
                  <tr>
                    <th className="border-b border-r border-card-border px-4 pb-4 pt-3 text-center text-[10px] font-bold uppercase tracking-wider text-muted">Pontos</th>
                    {divisionWorkouts.map((workout) => (
                      <th key={`${workout.id}-labels`} className="border-b border-r border-card-border px-3 pb-4 pt-3 last:border-r-0">
                        <div className="grid grid-cols-3 text-center text-[10px] font-bold uppercase tracking-wider text-muted">
                          <span>Pontos</span><span>Rank</span><span>Resultado</span>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredLeaderboard.map((row) => (
                    <tr key={row.athlete.id} className="group bg-background transition-colors hover:bg-elevated/30">
                      <td className="sticky left-0 z-20 border-b border-r border-card-border bg-background p-0 shadow-[8px_0_18px_rgba(0,0,0,0.18)] transition-colors group-hover:bg-elevated/30">
                        <LeaderboardParticipantCell
                          athlete={row.athlete}
                          rank={row.rank}
                          isExpanded={Boolean(expandedTeams[row.athlete.id])}
                          onToggleTeam={() => toggleTeamExpanded(row.athlete.id)}
                          onOpenProfile={() => row.athlete.isTeam ? setSelectedTeamForProfile(row.athlete) : setSelectedAthleteForProfile(row.athlete)}
                        />
                      </td>
                      <td className="border-b border-r border-card-border bg-primary/[0.035] px-4 text-center text-xl font-black text-primary">{row.totalPoints}</td>
                      {divisionWorkouts.map((workout) => {
                        const score = row.scores[workout.id];
                        return (
                          <td key={workout.id} className="border-b border-r border-card-border p-0 text-center last:border-r-0">
                            {score && score.result !== '-' ? (
                              <div className="grid min-h-[5.5rem] grid-cols-3 items-center px-3 text-sm font-black text-white">
                                <span>{score.points ?? 0}</span>
                                <span className="text-muted">{score.rank ? `${score.rank}º` : '–'}</span>
                                <span className="truncate px-1 text-xs text-muted" title={score.result}>{score.result}</span>
                              </div>
                            ) : (
                              <div className="flex min-h-[5.5rem] items-center justify-center text-sm font-bold text-muted-soft">–</div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="flex flex-col gap-1 border-t border-card-border bg-dark-gray/60 px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted sm:flex-row sm:items-center sm:justify-between">
            <span>Classificação atualizada com os resultados publicados</span>
            <span className="text-muted-soft">{filteredLeaderboard.length} {filteredLeaderboard.length === 1 ? 'competidor' : 'competidores'}</span>
          </div>
        </section>
      ) : (
        <div className="space-y-3 rounded-xl border border-card-border bg-card py-16 text-center">
          <ShieldAlert className="mx-auto h-10 w-10 text-muted" aria-hidden="true" />
          <h4 className="text-sm font-bold uppercase tracking-wider text-white">Sem dados de leaderboard</h4>
          <p className="text-xs text-muted">Ainda não há resultados disponíveis para os critérios de busca.</p>
        </div>
      )}

      {/* Estilos das Animações dos Drawers */}
      <style jsx global>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .animate-slideInRight {
          animation: slideInRight 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        .animate-fadeIn {
          animation: fadeIn 0.2s ease-out forwards;
        }
      `}</style>

      {/* Drawer do Atleta Individual */}
      {selectedAthleteForProfile && (
        <div className="fixed inset-0 z-50 overflow-hidden" aria-labelledby="slide-over-title" role="dialog" aria-modal="true">
          <div className="absolute inset-0 overflow-hidden">
            {/* Overlay */}
            <div 
              className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300 animate-fadeIn" 
              onClick={() => setSelectedAthleteForProfile(null)}
            />

            <div className="pointer-events-none fixed inset-y-0 right-0 flex max-w-full pl-10">
              <div className="pointer-events-auto w-screen max-w-md transform transition duration-300 ease-in-out border-l border-card-border bg-card animate-slideInRight">
                <div className="flex h-full flex-col overflow-y-auto py-6 shadow-2xl text-white">
                  {/* Header */}
                  <div className="px-6 flex items-start justify-between border-b border-card-border pb-4">
                    <div className="space-y-1">
                      <span className="inline-flex rounded-full bg-primary/20 border border-primary/30 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-primary">
                        Atleta Individual
                      </span>
                      <h2 className="text-xl font-bold text-white uppercase tracking-wide" id="slide-over-title">
                        {selectedAthleteForProfile.name}
                      </h2>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedAthleteForProfile(null)}
                      className="rounded-md text-muted hover:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      <span className="sr-only">Fechar painel</span>
                      <X className="h-6 w-6" aria-hidden="true" />
                    </button>
                  </div>

                  {/* Body */}
                  <div className="flex-1 px-6 py-6 space-y-6">
                    {/* Perfil Header */}
                    <div className="flex items-center gap-4 bg-dark-gray/30 border border-card-border/50 rounded-xl p-4">
                      {selectedAthleteForProfile.photoUrl ? (
                        <img 
                          src={selectedAthleteForProfile.photoUrl} 
                          alt={selectedAthleteForProfile.name} 
                          className="h-16 w-16 rounded-full object-cover border-2 border-primary shadow-lg" 
                        />
                      ) : (
                        <div className="h-16 w-16 rounded-full bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center border-2 border-primary/20 text-primary font-black text-xl uppercase shadow-inner">
                          {selectedAthleteForProfile.name.slice(0, 2)}
                        </div>
                      )}
                      <div className="space-y-1">
                        <p className="text-xs text-muted font-medium flex items-center gap-1">
                          <User className="h-3 w-3" /> {activeCategory?.name || 'Categoria'}
                        </p>
                        {selectedAthleteForProfile.instagram && (
                          <a
                            href={`https://instagram.com/${selectedAthleteForProfile.instagram.replace(/^@/, '')}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary-hover hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <InstagramIcon className="h-3.5 w-3.5" />
                            @{selectedAthleteForProfile.instagram.replace(/^@/, '')}
                          </a>
                        )}
                        <p className="text-xs text-muted-soft">
                          {selectedAthleteForProfile.city ? `${selectedAthleteForProfile.city} / ${selectedAthleteForProfile.state || ''}` : 'Localização não informada'}
                        </p>
                      </div>
                    </div>

                    {/* Detalhes de Registro */}
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div className="rounded-xl border border-card-border/50 bg-dark-gray/20 p-3.5 space-y-1">
                        <span className="text-[10px] font-bold text-muted uppercase tracking-wider block">Box / Academia</span>
                        <span className="font-bold text-white uppercase text-xs block truncate">{selectedAthleteForProfile.box || 'Nenhum'}</span>
                      </div>
                      
                      <div className="rounded-xl border border-card-border/50 bg-dark-gray/20 p-3.5 space-y-1">
                        <span className="text-[10px] font-bold text-muted uppercase tracking-wider block">Nacionalidade</span>
                        <span className="font-bold text-white uppercase text-xs block">{selectedAthleteForProfile.country || 'BR'}</span>
                      </div>

                      {event.eventType === 'fitness_racing' ? (
                      <div className="col-span-2 rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-1">
                        <span className="text-[10px] font-bold text-muted uppercase tracking-wider block">Tempo Oficial Total</span>
                        <div className="flex items-baseline gap-2">
                          <span className="font-mono text-2xl font-black text-primary">
                            {(() => {
                              const totalWorkout = event.workouts.find(w => w.divisionId === selectedAthleteForProfile.divisionId && w.code === 'TOTAL');
                              const score = leaderboardData.find(row => row.athlete.id === selectedAthleteForProfile.id)?.scores[totalWorkout?.id || ''];
                              return score && score.value < 999999 ? score.result : '-';
                            })()}
                          </span>
                          <span className="text-[10px] font-semibold text-muted font-sans">no percurso completo</span>
                        </div>
                      </div>
                      ) : (() => {
                        const row = leaderboardData.find(r => r.athlete.id === selectedAthleteForProfile.id);
                        return <OverallPlacementCard rank={row?.rank} totalPoints={row?.totalPoints} />;
                      })()}
                    </div>

                    {/* Functional Fitness: Pontuação por Prova | Fitness Racing: Análise de splits */}
                    {event.eventType !== 'fitness_racing' ? (
                      <div className="border-t border-card-border/50 pt-5 space-y-4">
                        <h3 className="text-xs font-black uppercase tracking-widest text-primary flex items-center gap-1.5">
                          <BarChart3 className="h-4 w-4" /> Pontuação por Prova
                        </h3>
                        {(() => {
                          const row = leaderboardData.find(r => r.athlete.id === selectedAthleteForProfile.id);
                          return <ScorePerWorkoutList workouts={divisionWorkouts} scores={row?.scores || {}} />;
                        })()}
                      </div>
                    ) : (
                    <div className="border-t border-card-border/50 pt-5 space-y-4">
                      <h3 className="text-xs font-black uppercase tracking-widest text-primary flex items-center gap-1.5">
                        <TrendingUp className="h-4 w-4" /> Análise de Performance
                      </h3>

                      {(() => {
                        const totalWorkout = event.workouts.find(w => w.divisionId === selectedAthleteForProfile.divisionId && w.code === 'TOTAL');
                        const score = leaderboardData.find(row => row.athlete.id === selectedAthleteForProfile.id)?.scores[totalWorkout?.id || ''];
                        const division = event.divisions.find(d => d.id === selectedAthleteForProfile.divisionId);
                        const stages = division?.courseLayout || [];

                        if (!score || !score.splits || Object.keys(score.splits).length === 0) {
                          return (
                            <div className="rounded-xl border border-dashed border-card-border p-6 text-center">
                              <p className="text-xs text-muted">Nenhum split de tempo lançado para este competidor.</p>
                            </div>
                          );
                        }

                        const splitsArray = stages.map(stg => {
                          const timeStr = score.splits?.[stg.id] || '';
                          const secs = timeToSeconds(timeStr);
                          return { stage: stg, timeStr, secs };
                        }).filter(s => s.secs > 0);

                        if (splitsArray.length === 0) {
                          return (
                            <div className="rounded-xl border border-dashed border-card-border p-6 text-center">
                              <p className="text-xs text-muted">Nenhum split de tempo lançado para este competidor.</p>
                            </div>
                          );
                        }

                        const sortedByTime = [...splitsArray].sort((a, b) => a.secs - b.secs);
                        const stations = splitsArray.filter(s => s.stage.type === 'station');
                        const runs = splitsArray.filter(s => s.stage.type === 'run');

                        const bestSplit = sortedByTime[0];
                        const worstSplit = sortedByTime[sortedByTime.length - 1];

                        const bestStation = stations.length > 0 ? [...stations].sort((a, b) => a.secs - b.secs)[0] : null;
                        const worstStation = stations.length > 0 ? [...stations].sort((a, b) => b.secs - a.secs)[0] : null;

                        const totalRunSecs = runs.reduce((acc, curr) => acc + curr.secs, 0);
                        const totalStationSecs = stations.reduce((acc, curr) => acc + curr.secs, 0);
                        const avgRunSecs = runs.length > 0 ? Math.round(totalRunSecs / runs.length) : 0;

                        return (
                          <div className="space-y-4 animate-fadeIn">
                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <div className="rounded-lg bg-dark-gray/30 border border-card-border/60 p-2.5">
                                <p className="text-[9px] uppercase font-bold text-muted flex items-center gap-1">
                                  <Flame className="h-3 w-3 text-emerald-400" /> Melhor Split
                                </p>
                                <p className="font-bold text-emerald-400 mt-1 truncate" title={`${bestSplit.stage.name} (${bestSplit.timeStr})`}>
                                  {bestSplit.stage.name} <span className="font-mono font-medium text-[10px] text-white ml-0.5">({bestSplit.timeStr})</span>
                                </p>
                              </div>

                              <div className="rounded-lg bg-dark-gray/30 border border-card-border/60 p-2.5">
                                <p className="text-[9px] uppercase font-bold text-muted flex items-center gap-1">
                                  <Flame className="h-3 w-3 text-red-400" /> Pior Split
                                </p>
                                <p className="font-bold text-red-400 mt-1 truncate" title={`${worstSplit.stage.name} (${worstSplit.timeStr})`}>
                                  {worstSplit.stage.name} <span className="font-mono font-medium text-[10px] text-white ml-0.5">({worstSplit.timeStr})</span>
                                </p>
                              </div>

                              {bestStation && (
                                <div className="rounded-lg bg-dark-gray/30 border border-card-border/60 p-2.5">
                                  <p className="text-[9px] uppercase font-bold text-muted flex items-center gap-1">
                                    <Zap className="h-3 w-3 text-yellow-400" /> Estação Forte
                                  </p>
                                  <p className="font-bold text-white mt-1 truncate" title={`${bestStation.stage.name} (${bestStation.timeStr})`}>
                                    {bestStation.stage.name} <span className="font-mono font-medium text-[10px] text-muted-soft ml-0.5">({bestStation.timeStr})</span>
                                  </p>
                                </div>
                              )}

                              {worstStation && (
                                <div className="rounded-lg bg-dark-gray/30 border border-card-border/60 p-2.5">
                                  <p className="text-[9px] uppercase font-bold text-muted flex items-center gap-1">
                                    <Zap className="h-3 w-3 text-amber-600" /> Estação Lenta
                                  </p>
                                  <p className="font-bold text-white mt-1 truncate" title={`${worstStation.stage.name} (${worstStation.timeStr})`}>
                                    {worstStation.stage.name} <span className="font-mono font-medium text-[10px] text-muted-soft ml-0.5">({worstStation.timeStr})</span>
                                  </p>
                                </div>
                              )}

                              <div className="rounded-lg bg-dark-gray/30 border border-card-border/60 p-2.5">
                                <p className="text-[9px] uppercase font-bold text-muted">Corrida Total</p>
                                <p className="font-mono font-bold text-white mt-1">{secondsToTimeStr(totalRunSecs)}</p>
                              </div>

                              <div className="rounded-lg bg-dark-gray/30 border border-card-border/60 p-2.5">
                                <p className="text-[9px] uppercase font-bold text-muted">Estações Total</p>
                                <p className="font-mono font-bold text-white mt-1">{secondsToTimeStr(totalStationSecs)}</p>
                              </div>

                              {runs.length > 0 && (
                                <div className="rounded-lg bg-dark-gray/30 border border-card-border/60 p-2.5 col-span-2">
                                  <p className="text-[9px] uppercase font-bold text-muted">Pace Médio de Corrida</p>
                                  <p className="font-mono font-bold text-primary mt-1">{secondsToTimeStr(avgRunSecs)} / km</p>
                                </div>
                              )}
                            </div>

                            {/* Splits timeline */}
                            <div className="border-t border-card-border/30 pt-4 space-y-2">
                              <p className="text-[10px] uppercase font-bold text-muted tracking-wider">Parciais por Etapa (Timeline)</p>
                              <div className="max-h-[220px] overflow-y-auto pr-1 space-y-1.5 scrollbar-thin">
                                {stages.map(stg => {
                                  const timeStr = score.splits?.[stg.id] || '-';
                                  return (
                                    <div key={stg.id} className="flex justify-between items-center text-xs py-1 border-b border-card-border/20 last:border-b-0">
                                      <span className="text-muted-soft flex items-center gap-1.5">
                                        <span className={`h-1.5 w-1.5 rounded-full ${stg.type === 'run' ? 'bg-primary' : 'bg-yellow-500'}`} />
                                        {stg.name}
                                      </span>
                                      <span className="font-mono font-bold text-white">{timeStr}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Drawer de Equipe / Duplas */}
      {selectedTeamForProfile && (
        <div className="fixed inset-0 z-50 overflow-hidden" aria-labelledby="slide-over-title" role="dialog" aria-modal="true">
          <div className="absolute inset-0 overflow-hidden">
            {/* Overlay */}
            <div 
              className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300 animate-fadeIn" 
              onClick={() => setSelectedTeamForProfile(null)}
            />

            <div className="pointer-events-none fixed inset-y-0 right-0 flex max-w-full pl-10">
              <div className="pointer-events-auto w-screen max-w-md transform transition duration-300 ease-in-out border-l border-card-border bg-card animate-slideInRight">
                <div className="flex h-full flex-col overflow-y-auto py-6 shadow-2xl text-white">
                  {/* Header */}
                  <div className="px-6 flex items-start justify-between border-b border-card-border pb-4">
                    <div className="space-y-1">
                      <h2 className="text-xl font-bold text-white uppercase tracking-wide" id="slide-over-title">
                        {getTeamDisplayName(selectedTeamForProfile)}
                      </h2>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedTeamForProfile(null)}
                      className="rounded-md text-muted hover:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      <span className="sr-only">Fechar painel</span>
                      <X className="h-6 w-6" aria-hidden="true" />
                    </button>
                  </div>

                  {/* Body */}
                  <div className="flex-1 px-6 py-6 space-y-6">
                    {/* Informações da Equipe */}
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div className="rounded-xl border border-card-border/50 bg-dark-gray/20 p-3.5 space-y-1">
                        <span className="text-[10px] font-bold text-muted uppercase tracking-wider block">Box / Academia</span>
                        <span className="font-bold text-white uppercase text-xs block truncate">{selectedTeamForProfile.box || 'Nenhum'}</span>
                      </div>
                      
                      <div className="rounded-xl border border-card-border/50 bg-dark-gray/20 p-3.5 space-y-1">
                        <span className="text-[10px] font-bold text-muted uppercase tracking-wider block">Localização</span>
                        <span className="font-bold text-white uppercase text-xs block truncate">
                          {selectedTeamForProfile.city ? `${selectedTeamForProfile.city} / ${selectedTeamForProfile.state || ''}` : 'Não informado'}
                        </span>
                      </div>

                      <div className="col-span-2 rounded-xl border border-card-border/50 bg-dark-gray/20 p-3.5 space-y-1">
                        <span className="text-[10px] font-bold text-muted uppercase tracking-wider block">Instagram da Equipe</span>
                        {selectedTeamForProfile.instagram ? (
                          <a
                            href={`https://instagram.com/${selectedTeamForProfile.instagram.replace(/^@/, '')}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 font-bold text-primary hover:text-primary-hover hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <InstagramIcon className="h-3.5 w-3.5" />
                            @{selectedTeamForProfile.instagram.replace(/^@/, '')}
                          </a>
                        ) : (
                          <span className="text-muted">Não informado</span>
                        )}
                      </div>

                      {event.eventType === 'fitness_racing' ? (
                      <div className="col-span-2 rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-1">
                        <span className="text-[10px] font-bold text-muted uppercase tracking-wider block">Tempo Oficial Total</span>
                        <div className="flex items-baseline gap-2">
                          <span className="font-mono text-2xl font-black text-primary">
                            {(() => {
                              const totalWorkout = event.workouts.find(w => w.divisionId === selectedTeamForProfile.divisionId && w.code === 'TOTAL');
                              const score = leaderboardData.find(row => row.athlete.id === selectedTeamForProfile.id)?.scores[totalWorkout?.id || ''];
                              return score && score.value < 999999 ? score.result : '-';
                            })()}
                          </span>
                          <span className="text-[10px] font-semibold text-muted font-sans">no percurso completo</span>
                        </div>
                      </div>
                      ) : (() => {
                        const row = leaderboardData.find(r => r.athlete.id === selectedTeamForProfile.id);
                        return <OverallPlacementCard rank={row?.rank} totalPoints={row?.totalPoints} />;
                      })()}
                    </div>

                    {/* Integrantes da Equipe */}
                    <div className="space-y-2">
                      <p className="text-[10px] uppercase font-bold text-primary tracking-wider">Integrantes da Equipe</p>
                      {selectedTeamForProfile.teamMembers && selectedTeamForProfile.teamMembers.length > 0 ? (
                        <div className="grid grid-cols-1 gap-2">
                          {selectedTeamForProfile.teamMembers.map((m: { name: string; instagram: string }, idx: number) => (
                            <div key={idx} className="flex items-center justify-between p-3 rounded-lg bg-dark-gray/30 border border-card-border/60 text-xs">
                              <span className="font-semibold text-white uppercase">{m.name}</span>
                              {m.instagram ? (
                                <a
                                  href={`https://instagram.com/${m.instagram.replace(/^@/, '')}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-0.5 text-primary hover:text-primary-hover hover:underline text-[10px]"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <InstagramIcon className="h-3 w-3" />
                                  @{m.instagram.replace(/^@/, '')}
                                </a>
                              ) : (
                                <span className="text-muted text-[10px]">Sem Instagram</span>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted">Nenhum integrante cadastrado nesta equipe.</p>
                      )}
                    </div>

                    {/* Functional Fitness: Pontuação por Prova | Fitness Racing: Análise de splits */}
                    {event.eventType !== 'fitness_racing' ? (
                      <div className="border-t border-card-border/50 pt-5 space-y-4">
                        <h3 className="text-xs font-black uppercase tracking-widest text-primary flex items-center gap-1.5">
                          <BarChart3 className="h-4 w-4" /> Pontuação por Prova
                        </h3>
                        {(() => {
                          const row = leaderboardData.find(r => r.athlete.id === selectedTeamForProfile.id);
                          return <ScorePerWorkoutList workouts={divisionWorkouts} scores={row?.scores || {}} />;
                        })()}
                      </div>
                    ) : (
                    <div className="border-t border-card-border/50 pt-5 space-y-4">
                      <h3 className="text-xs font-black uppercase tracking-widest text-primary flex items-center gap-1.5">
                        <TrendingUp className="h-4 w-4" /> Análise de Performance
                      </h3>

                      {(() => {
                        const totalWorkout = event.workouts.find(w => w.divisionId === selectedTeamForProfile.divisionId && w.code === 'TOTAL');
                        const score = leaderboardData.find(row => row.athlete.id === selectedTeamForProfile.id)?.scores[totalWorkout?.id || ''];
                        const division = event.divisions.find(d => d.id === selectedTeamForProfile.divisionId);
                        const stages = division?.courseLayout || [];

                        if (!score || !score.splits || Object.keys(score.splits).length === 0) {
                          return (
                            <div className="rounded-xl border border-dashed border-card-border p-6 text-center">
                              <p className="text-xs text-muted">Nenhum split de tempo lançado para esta equipe.</p>
                            </div>
                          );
                        }

                        const splitsArray = stages.map(stg => {
                          const timeStr = score.splits?.[stg.id] || '';
                          const secs = timeToSeconds(timeStr);
                          return { stage: stg, timeStr, secs };
                        }).filter(s => s.secs > 0);

                        if (splitsArray.length === 0) {
                          return (
                            <div className="rounded-xl border border-dashed border-card-border p-6 text-center">
                              <p className="text-xs text-muted">Nenhum split de tempo lançado para esta equipe.</p>
                            </div>
                          );
                        }

                        const sortedByTime = [...splitsArray].sort((a, b) => a.secs - b.secs);
                        const stations = splitsArray.filter(s => s.stage.type === 'station');
                        const runs = splitsArray.filter(s => s.stage.type === 'run');

                        const bestSplit = sortedByTime[0];
                        const worstSplit = sortedByTime[sortedByTime.length - 1];

                        const bestStation = stations.length > 0 ? [...stations].sort((a, b) => a.secs - b.secs)[0] : null;
                        const worstStation = stations.length > 0 ? [...stations].sort((a, b) => b.secs - a.secs)[0] : null;

                        const totalRunSecs = runs.reduce((acc, curr) => acc + curr.secs, 0);
                        const totalStationSecs = stations.reduce((acc, curr) => acc + curr.secs, 0);
                        const avgRunSecs = runs.length > 0 ? Math.round(totalRunSecs / runs.length) : 0;

                        return (
                          <div className="space-y-4 animate-fadeIn">
                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <div className="rounded-lg bg-dark-gray/30 border border-card-border/60 p-2.5">
                                <p className="text-[9px] uppercase font-bold text-muted flex items-center gap-1">
                                  <Flame className="h-3 w-3 text-emerald-400" /> Melhor Split
                                </p>
                                <p className="font-bold text-emerald-400 mt-1 truncate" title={`${bestSplit.stage.name} (${bestSplit.timeStr})`}>
                                  {bestSplit.stage.name} <span className="font-mono font-medium text-[10px] text-white ml-0.5">({bestSplit.timeStr})</span>
                                </p>
                              </div>

                              <div className="rounded-lg bg-dark-gray/30 border border-card-border/60 p-2.5">
                                <p className="text-[9px] uppercase font-bold text-muted flex items-center gap-1">
                                  <Flame className="h-3 w-3 text-red-400" /> Pior Split
                                </p>
                                <p className="font-bold text-red-400 mt-1 truncate" title={`${worstSplit.stage.name} (${worstSplit.timeStr})`}>
                                  {worstSplit.stage.name} <span className="font-mono font-medium text-[10px] text-white ml-0.5">({worstSplit.timeStr})</span>
                                </p>
                              </div>

                              {bestStation && (
                                <div className="rounded-lg bg-dark-gray/30 border border-card-border/60 p-2.5">
                                  <p className="text-[9px] uppercase font-bold text-muted flex items-center gap-1">
                                    <Zap className="h-3 w-3 text-yellow-400" /> Estação Forte
                                  </p>
                                  <p className="font-bold text-white mt-1 truncate" title={`${bestStation.stage.name} (${bestStation.timeStr})`}>
                                    {bestStation.stage.name} <span className="font-mono font-medium text-[10px] text-muted-soft ml-0.5">({bestStation.timeStr})</span>
                                  </p>
                                </div>
                              )}

                              {worstStation && (
                                <div className="rounded-lg bg-dark-gray/30 border border-card-border/60 p-2.5">
                                  <p className="text-[9px] uppercase font-bold text-muted flex items-center gap-1">
                                    <Zap className="h-3 w-3 text-amber-600" /> Estação Lenta
                                  </p>
                                  <p className="font-bold text-white mt-1 truncate" title={`${worstStation.stage.name} (${worstStation.timeStr})`}>
                                    {worstStation.stage.name} <span className="font-mono font-medium text-[10px] text-muted-soft ml-0.5">({worstStation.timeStr})</span>
                                  </p>
                                </div>
                              )}

                              <div className="rounded-lg bg-dark-gray/30 border border-card-border/60 p-2.5">
                                <p className="text-[9px] uppercase font-bold text-muted">Corrida Total</p>
                                <p className="font-mono font-bold text-white mt-1">{secondsToTimeStr(totalRunSecs)}</p>
                              </div>

                              <div className="rounded-lg bg-dark-gray/30 border border-card-border/60 p-2.5">
                                <p className="text-[9px] uppercase font-bold text-muted">Estações Total</p>
                                <p className="font-mono font-bold text-white mt-1">{secondsToTimeStr(totalStationSecs)}</p>
                              </div>

                              {runs.length > 0 && (
                                <div className="rounded-lg bg-dark-gray/30 border border-card-border/60 p-2.5 col-span-2">
                                  <p className="text-[9px] uppercase font-bold text-muted">Pace Médio de Corrida</p>
                                  <p className="font-mono font-bold text-primary mt-1">{secondsToTimeStr(avgRunSecs)} / km</p>
                                </div>
                              )}
                            </div>

                            {/* Splits timeline */}
                            <div className="border-t border-card-border/30 pt-4 space-y-2">
                              <p className="text-[10px] uppercase font-bold text-muted tracking-wider">Parciais por Etapa (Timeline)</p>
                              <div className="max-h-[220px] overflow-y-auto pr-1 space-y-1.5 scrollbar-thin">
                                {stages.map(stg => {
                                  const timeStr = score.splits?.[stg.id] || '-';
                                  return (
                                    <div key={stg.id} className="flex justify-between items-center text-xs py-1 border-b border-card-border/20 last:border-b-0">
                                      <span className="text-muted-soft flex items-center gap-1.5">
                                        <span className={`h-1.5 w-1.5 rounded-full ${stg.type === 'run' ? 'bg-primary' : 'bg-yellow-500'}`} />
                                        {stg.name}
                                      </span>
                                      <span className="font-mono font-bold text-white">{timeStr}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
