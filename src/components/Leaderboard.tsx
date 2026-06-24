'use client';

import React, { useMemo, useState } from 'react';
import { Search, ShieldAlert, ChevronDown, ChevronUp, X, TrendingUp, User, Flame, Zap, BarChart3, Clock } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { MobileLeaderboardCard } from './MobileLeaderboardCard';

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
  if (rank === 1) return 'bg-yellow-500/20 text-yellow-500 border-yellow-500/30';
  if (rank === 2) return 'bg-slate-300/20 text-slate-300 border-slate-300/30';
  if (rank === 3) return 'bg-amber-700/20 text-amber-700 border-amber-700/30';
  return 'bg-dark-gray/60 text-muted-soft border-card-border/50';
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

export function Leaderboard({ event }: LeaderboardProps) {
  const { getLeaderboard } = useApp();
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
      {/* Filtros Superiores */}
      <div className="flex flex-col gap-4 rounded-lg border border-card-border bg-card p-4">
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
                className="h-10 w-full rounded-md border border-card-border bg-background px-3 text-sm font-bold text-white uppercase tracking-wider focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                {event.divisions.map((division) => (
                  <option key={division.id} value={division.id}>
                    {division.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="flex gap-1 rounded-md border border-card-border bg-background p-1 overflow-x-auto scrollbar-none w-full lg:w-auto">
              {event.divisions.map((division) => (
                <button
                  key={division.id}
                  type="button"
                  onClick={() => {
                    setSelectedCategoryId(division.id);
                    setAgeGroupFilter('');
                  }}
                  className={`min-h-9 flex-1 lg:flex-initial text-center rounded-sm px-4 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors whitespace-nowrap ${
                    activeCategoryId === division.id
                      ? 'bg-primary text-ink'
                      : 'text-muted hover:bg-card hover:text-white'
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
                className="h-10 w-full sm:w-auto rounded-md border border-card-border bg-background px-3 text-sm font-bold uppercase tracking-wider text-white focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
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

      {/* Tabela de Classificação */}
      {filteredLeaderboard.length > 0 ? (
        isMobile ? (
          // ========== MOBILE: Card Stack ==========
          <div className="space-y-2 pb-4">
            {filteredLeaderboard.map((row) => {
              const hasTime = row.totalPoints < 999999;
              const diffSecs = hasTime ? row.totalPoints - leaderTime : 0;

              return (
                <MobileLeaderboardCard
                  key={row.athlete.id}
                  rank={row.rank}
                  athlete={row.athlete}
                  time={event.eventType === 'fitness_racing' && hasTime ? secondsToTimeStr(row.totalPoints) : undefined}
                  difference={
                    event.eventType === 'fitness_racing'
                      ? hasTime && diffSecs > 0
                        ? `+${secondsToTimeStr(diffSecs)}`
                        : hasTime && row.rank === 1
                          ? 'Líder'
                          : '-'
                      : undefined
                  }
                  totalPoints={event.eventType !== 'fitness_racing' ? row.totalPoints : undefined}
                  isExpanded={expandedTeams[row.athlete.id]}
                  onToggleExpand={() => toggleTeamExpanded(row.athlete.id)}
                  onViewDetails={() => {
                    if (row.athlete.isTeam) {
                      setSelectedTeamForProfile(row.athlete);
                    } else {
                      setSelectedAthleteForProfile(row.athlete);
                    }
                  }}
                />
              );
            })}
          </div>
        ) : (
          // ========== DESKTOP: Tabela ==========
          <div className="overflow-x-auto rounded-xl border border-card-border bg-card">
            {event.eventType === 'fitness_racing' ? (
              /* =======================================================
                 DESIGN LEADERBOARD FITNESS RACING (TEMPO E DIFERENÇA)
                 ======================================================= */
              <table className="min-w-[760px] w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-card-border bg-background">
                  <th className="w-[340px] p-0">
                    <div className="flex flex-col h-full justify-between">
                      <div className="px-4 py-3 flex flex-col gap-1.5 border-b border-card-border/40">
                        <span className="text-[10px] font-bold text-muted uppercase tracking-wider">Competidor</span>
                        <div className="relative">
                          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-soft pointer-events-none" />
                          <input
                            type="text"
                            placeholder="Nome ou box..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-9 pr-9 py-2 h-10 bg-background border border-card-border/60 rounded text-sm text-white placeholder:text-muted focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
                            aria-label="Buscar atleta ou box"
                          />
                          {searchQuery && (
                            <button
                              type="button"
                              onClick={() => setSearchQuery('')}
                              className="absolute right-2.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted hover:text-white transition-colors flex items-center justify-center p-0"
                              aria-label="Limpar busca"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="grid grid-cols-[56px_1fr] text-[9px] font-bold text-muted uppercase text-left py-1.5 bg-background/50">
                        <div className="text-center border-r border-card-border/20">Pos</div>
                        <div className="pl-4">Nome & Box</div>
                      </div>
                    </div>
                  </th>
                  {activeCategory?.useAgeGroups && (
                    <th className="px-4 py-3 text-center text-[10px] font-bold uppercase tracking-widest text-muted border-l border-card-border/40">
                      Faixa Etária
                    </th>
                  )}
                  <th className="px-4 py-3 text-center text-[10px] font-bold uppercase tracking-widest text-primary border-l border-card-border/40">
                    Tempo Oficial
                  </th>
                  <th className="px-4 py-3 text-right text-[10px] font-bold uppercase tracking-widest text-primary border-l border-card-border/40">
                    Diferença
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredLeaderboard.map((row, idx) => {
                  const hasTime = row.totalPoints < 999999;
                  const diffSecs = hasTime ? row.totalPoints - leaderTime : 0;
                  const finalRank = row.rank;

                  return (
                    <React.Fragment key={row.athlete.id}>
                      <tr 
                        onClick={() => {
                          if (row.athlete.isTeam) {
                            setSelectedTeamForProfile(row.athlete);
                          } else {
                            setSelectedAthleteForProfile(row.athlete);
                          }
                        }}
                        className="border-b border-card-border transition-colors last:border-b-0 hover:bg-elevated/50 cursor-pointer"
                      >
                        <td className="p-0">
                          <div className="grid grid-cols-[56px_1fr] items-center h-full min-h-[56px]">
                            {/* Pos */}
                            <div className="text-center flex justify-center border-r border-card-border/20 font-bold text-white font-mono text-sm">
                              {finalRank > 0 ? (
                                <span className={`inline-flex items-center justify-center h-7 w-7 rounded-full ${
                                  finalRank === 1 ? 'bg-yellow-500/20 text-yellow-500 border border-yellow-500/30' 
                                  : finalRank === 2 ? 'bg-slate-300/20 text-slate-300 border border-slate-300/30' 
                                  : finalRank === 3 ? 'bg-amber-700/20 text-amber-700 border border-amber-700/30' 
                                  : 'text-muted'
                                }`}>
                                  {finalRank}
                                </span>
                              ) : (
                                <span className="text-muted">-</span>
                              )}
                            </div>
                            {/* Nome e Box */}
                            {(() => {
                              const isTeam = row.athlete.isTeam;
                              const isExpanded = expandedTeams[row.athlete.id];
                              const displayName = isTeam ? row.athlete.name.split('(')[0].trim() : row.athlete.name;

                              return (
                                <div 
                                  className={`flex justify-between items-center pl-4 pr-4 py-2 ${isTeam ? 'cursor-pointer select-none hover:bg-elevated/40' : ''}`}
                                  onClick={isTeam ? () => toggleTeamExpanded(row.athlete.id) : undefined}
                                >
                                  <div className="flex flex-col flex-1">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className="text-xs font-bold text-white uppercase tracking-wide flex items-center gap-1">
                                        {displayName}
                                        {isTeam && (
                                          isExpanded ? <ChevronUp className="h-3 w-3 text-muted-soft" /> : <ChevronDown className="h-3 w-3 text-muted-soft" />
                                        )}
                                      </span>
                                      {!isTeam && row.athlete.instagram && (
                                        <a
                                          href={`https://instagram.com/${row.athlete.instagram.trim().replace(/^@/, '')}`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="inline-flex items-center gap-0.5 text-[10px] text-primary hover:text-primary-hover font-semibold transition-colors"
                                          title={`Ver Instagram de ${row.athlete.name}`}
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          <InstagramIcon className="h-3.5 w-3.5" />
                                          <span className="sr-only">Instagram</span>
                                        </a>
                                      )}
                                    </div>
                                    <span className="text-[10px] text-muted font-medium mt-0.5">{row.athlete.box}</span>
                                    {(() => {
                                      const members = getTeamMembersArray(row.athlete.teamMembers);
                                      if (!isTeam || !isExpanded || members.length === 0) return null;
                                      return (
                                        <span className="text-[9px] text-muted-soft mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5 animate-fadeIn">
                                          {members.map((m, mIdx) => (
                                            <span key={mIdx} className="inline-flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                                              <span>{m.name}</span>
                                              {m.instagram && (
                                                <a
                                                  href={`https://instagram.com/${m.instagram.trim().replace(/^@/, '')}`}
                                                  target="_blank"
                                                  rel="noopener noreferrer"
                                                  className="text-primary hover:text-primary-hover font-semibold inline-flex items-center"
                                                  title={`Ver Instagram de ${m.name}`}
                                                >
                                                  <InstagramIcon className="h-3 w-3 ml-0.5" />
                                                </a>
                                              )}
                                              {mIdx < members.length - 1 && <span className="text-muted-soft ml-1">&</span>}
                                            </span>
                                          ))}
                                        </span>
                                      );
                                    })()}
                                  </div>
                                  {row.athlete.country && (
                                    <span className="rounded bg-dark-gray border border-card-border/40 px-2 py-0.5 text-[9px] font-bold text-muted-soft uppercase font-sans">
                                      {row.athlete.country}
                                    </span>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        </td>
                        {activeCategory?.useAgeGroups && (
                          <td className="px-4 py-3 text-center text-xs font-mono font-medium text-muted border-l border-card-border/20">
                            {getAgeGroupFromDate(row.athlete.birthDate, activeCategory.ageGroups)} anos
                          </td>
                        )}
                        <td className="px-4 py-3 text-center text-sm font-bold font-mono text-white border-l border-card-border/20 bg-primary/[0.02]">
                          {hasTime ? secondsToTimeStr(row.totalPoints) : '-'}
                        </td>
                        <td className="px-4 py-3 text-right text-xs font-bold font-mono text-primary border-l border-card-border/20">
                          {hasTime && diffSecs > 0 ? `+${secondsToTimeStr(diffSecs)}` : (hasTime && idx === 0 ? 'Líder' : '-')}
                        </td>
                      </tr>
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          ) : (
            /* =======================================================
               DESIGN LEADERBOARD CROSSFIT (CROSSFIT GAMES STYLE)
               ======================================================= */
            <table className="min-w-[840px] w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-card-border bg-background">
                  {/* Participant Header com busca */}
                  <th className="w-[340px] p-0">
                    <div className="flex flex-col h-full justify-between">
                      <div className="px-4 py-3 flex flex-col gap-1.5 border-b border-card-border/40">
                        <span className="text-[10px] font-bold text-muted uppercase tracking-wider">Participant</span>
                        <div className="relative">
                          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-soft pointer-events-none" />
                          <input
                            type="text"
                            placeholder="Nome ou box..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-9 pr-9 py-2 h-10 bg-background border border-card-border/60 rounded text-sm text-white placeholder:text-muted focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
                            aria-label="Buscar atleta ou box"
                          />
                          {searchQuery && (
                            <button
                              type="button"
                              onClick={() => setSearchQuery('')}
                              className="absolute right-2.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted hover:text-white transition-colors flex items-center justify-center p-0"
                              aria-label="Limpar busca"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="grid grid-cols-[56px_1fr] text-[9px] font-bold text-muted uppercase text-left py-1.5 bg-background/50">
                        <div className="text-center border-r border-card-border/20">Pos</div>
                        <div className="pl-4">Nome & Box</div>
                      </div>
                    </div>
                  </th>
                  
                  {/* Total Header */}
                  <th className="w-24 p-0 border-l border-card-border/40">
                    <div className="flex flex-col h-full justify-between">
                      <div className="px-2 py-3 text-center text-[10px] font-bold text-muted uppercase tracking-wider border-b border-card-border/40 min-h-[46px] flex items-center justify-center">
                        Total
                      </div>
                      <div className="text-[9px] font-bold text-muted uppercase text-center py-1.5 bg-background/50">
                        Points
                      </div>
                    </div>
                  </th>

                  {/* Workouts Headers */}
                  {divisionWorkouts.map((workout) => (
                    <th key={workout.id} className="min-w-[190px] p-0 border-l border-card-border/40">
                      <div className="flex flex-col h-full justify-between">
                        <div className="px-3 py-3 text-center text-[10px] font-black uppercase tracking-wider text-primary border-b border-card-border/40 min-h-[46px] flex flex-col justify-center gap-0.5">
                          <span className="line-clamp-1">{workout.name}</span>
                          <span className="text-[8px] font-medium text-muted normal-case block">
                            {workout.timeCap ? `Cap: ${workout.timeCap}` : 'Carga'}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 text-[8px] font-bold text-muted uppercase text-center py-1.5 bg-background/50">
                          <div>Points</div>
                          <div className="border-l border-card-border/20">Rank</div>
                          <div className="border-l border-card-border/20">Result</div>
                        </div>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredLeaderboard.map((row, idx) => {
                  return (
                    <React.Fragment key={row.athlete.id}>
                      <tr className="border-b border-card-border transition-colors last:border-b-0 hover:bg-elevated/50">
                        {/* Participant Cell */}
                        <td className="p-0">
                          <div className="grid grid-cols-[56px_1fr] items-center h-full min-h-[56px]">
                            {/* Pos */}
                            <div className="text-center flex justify-center border-r border-card-border/20 font-bold text-white font-mono text-sm">
                              <span className={`inline-flex items-center justify-center h-7 w-7 rounded-full ${
                                row.rank === 1 ? 'bg-yellow-500/20 text-yellow-500 border border-yellow-500/30' 
                                : row.rank === 2 ? 'bg-slate-300/20 text-slate-300 border border-slate-300/30' 
                                : row.rank === 3 ? 'bg-amber-700/20 text-amber-700 border border-amber-700/30' 
                                : 'text-muted'
                              }`}>
                                {row.rank}
                              </span>
                            </div>
                            {/* Nome e Box */}
                            {(() => {
                              const isTeam = row.athlete.isTeam;
                              const isExpanded = expandedTeams[row.athlete.id];
                              const displayName = isTeam ? row.athlete.name.split('(')[0].trim() : row.athlete.name;

                              return (
                                <div 
                                  className={`flex justify-between items-center pl-4 pr-4 py-2 ${isTeam ? 'cursor-pointer select-none hover:bg-elevated/40' : ''}`}
                                  onClick={isTeam ? () => toggleTeamExpanded(row.athlete.id) : undefined}
                                >
                                  <div className="flex flex-col flex-1">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className="text-xs font-bold text-white uppercase tracking-wide flex items-center gap-1">
                                        {displayName}
                                        {isTeam && (
                                          isExpanded ? <ChevronUp className="h-3 w-3 text-muted-soft" /> : <ChevronDown className="h-3 w-3 text-muted-soft" />
                                        )}
                                      </span>
                                      {!isTeam && row.athlete.instagram && (
                                        <a
                                          href={`https://instagram.com/${row.athlete.instagram.trim().replace(/^@/, '')}`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="inline-flex items-center gap-0.5 text-[10px] text-primary hover:text-primary-hover font-semibold transition-colors"
                                          title={`Ver Instagram de ${row.athlete.name}`}
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          <InstagramIcon className="h-3.5 w-3.5" />
                                          <span className="sr-only">Instagram</span>
                                        </a>
                                      )}
                                    </div>
                                    <span className="text-[10px] text-muted font-medium mt-0.5">{row.athlete.box}</span>
                                    {(() => {
                                      const members = getTeamMembersArray(row.athlete.teamMembers);
                                      if (!isTeam || !isExpanded || members.length === 0) return null;
                                      return (
                                        <span className="text-[9px] text-muted-soft mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5 animate-fadeIn">
                                          {members.map((m, mIdx) => (
                                            <span key={mIdx} className="inline-flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                                              <span>{m.name}</span>
                                              {m.instagram && (
                                                <a
                                                  href={`https://instagram.com/${m.instagram.trim().replace(/^@/, '')}`}
                                                  target="_blank"
                                                  rel="noopener noreferrer"
                                                  className="text-primary hover:text-primary-hover font-semibold inline-flex items-center"
                                                  title={`Ver Instagram de ${m.name}`}
                                                >
                                                  <InstagramIcon className="h-3 w-3 ml-0.5" />
                                                </a>
                                              )}
                                              {mIdx < members.length - 1 && <span className="text-muted-soft ml-1">&</span>}
                                            </span>
                                          ))}
                                        </span>
                                      );
                                    })()}
                                  </div>
                                  {row.athlete.country && (
                                    <span className="rounded bg-dark-gray border border-card-border/40 px-2 py-0.5 text-[9px] font-bold text-muted-soft uppercase font-sans">
                                      {row.athlete.country}
                                    </span>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        </td>

                        {/* Total Cell */}
                        <td className="p-0 border-l border-card-border/20 bg-primary/[0.02]">
                          <div className="flex items-center justify-center h-full min-h-[56px] text-center">
                            <span className="font-mono text-sm font-bold text-primary">{row.totalPoints}</span>
                          </div>
                        </td>

                        {/* Workouts Cells */}
                        {divisionWorkouts.map((workout) => {
                          const score = row.scores[workout.id];
                          return (
                            <td key={workout.id} className="p-0 border-l border-card-border/20 text-center">
                              {score && score.result !== '-' ? (
                                <div className="grid grid-cols-3 items-center text-xs h-full min-h-[56px]">
                                  {/* Points */}
                                  <div className="font-bold text-white text-xs">{score.points || 0}</div>
                                  {/* Rank */}
                                  <div className="text-muted-soft font-semibold border-l border-card-border/20">{score.rank || 0}º</div>
                                  {/* Result */}
                                  <div className="text-[10px] font-mono text-muted border-l border-card-border/20 truncate px-1" title={score.result}>
                                    {score.result}
                                  </div>
                                </div>
                              ) : (
                                <div className="flex items-center justify-center h-full min-h-[56px] text-muted text-xs">-</div>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        )
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
