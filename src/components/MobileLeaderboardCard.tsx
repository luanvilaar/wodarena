'use client';
 
import React from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Athlete } from '@/types';
 
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
 
interface MobileLeaderboardCardProps {
  rank: number;
  athlete: Athlete;
  time?: string;
  difference?: string;
  totalPoints?: number;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  onViewDetails?: () => void;
}
 
export function MobileLeaderboardCard({
  rank,
  athlete,
  time,
  difference,
  totalPoints,
  isExpanded,
  onToggleExpand,
  onViewDetails,
}: MobileLeaderboardCardProps) {
  const getRankColor = () => {
    if (rank === 1) return 'bg-yellow-500/20 text-yellow-500 border border-yellow-500/30';
    if (rank === 2) return 'bg-slate-300/20 text-slate-300 border border-slate-300/30';
    if (rank === 3) return 'bg-amber-700/20 text-amber-700 border border-amber-700/30';
    return 'text-muted';
  };
 
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
 
  const teamMembers = getTeamMembersArray(athlete.teamMembers);
  const displayName = athlete.isTeam ? athlete.name.split('(')[0].trim() : athlete.name;
 
  return (
    <div
      className="rounded-lg border border-card-border/50 bg-card p-3 flex justify-between items-center transition-colors hover:bg-elevated/30 cursor-pointer"
      onClick={onViewDetails}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          onViewDetails?.();
        }
      }}
    >
      {/* Lado Esquerdo: Rank, Nome, Box, Membros */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {/* Rank */}
        <span className={`inline-flex items-center justify-center h-7 w-7 rounded-full font-mono font-bold text-xs flex-shrink-0 ${getRankColor()}`}>
          {rank > 0 ? rank : '-'}
        </span>
 
        {/* Competidor Info */}
        <div className="flex flex-col min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-bold text-white uppercase tracking-wide flex items-center gap-1">
              {displayName}
              {athlete.isTeam && teamMembers.length > 0 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleExpand?.();
                  }}
                  className="p-0.5 hover:text-primary transition-colors flex items-center justify-center"
                  aria-label={isExpanded ? "Ocultar membros" : "Ver membros"}
                >
                  {isExpanded ? (
                    <ChevronUp className="h-3.5 w-3.5 text-primary" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5 text-muted-soft" />
                  )}
                </button>
              )}
            </span>
 
            {/* Instagram de Atleta Individual */}
            {!athlete.isTeam && athlete.instagram && (
              <a
                href={`https://instagram.com/${athlete.instagram.trim().replace(/^@/, '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 text-[10px] text-primary hover:text-primary-hover font-semibold transition-colors"
                title={`Ver Instagram de ${athlete.name}`}
                onClick={(e) => e.stopPropagation()}
              >
                <InstagramIcon className="h-3.5 w-3.5" />
              </a>
            )}
 
            {/* País */}
            {athlete.country && (
              <span className="rounded bg-dark-gray border border-card-border/40 px-1.5 py-0.5 text-[8px] font-bold text-muted-soft uppercase font-sans">
                {athlete.country}
              </span>
            )}
          </div>
 
          {/* Box / Academia */}
          <span className="text-[10px] text-muted font-medium mt-0.5 truncate">
            {athlete.box}
          </span>
 
          {/* Membros de Equipe (Inline compacto e animado) */}
          {athlete.isTeam && isExpanded && teamMembers.length > 0 && (
            <span className="text-[9px] text-muted-soft mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5 animate-fadeIn">
              {teamMembers.map((m, mIdx) => (
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
                      <InstagramIcon className="h-2.5 w-2.5 ml-0.5" />
                    </a>
                  )}
                  {mIdx < teamMembers.length - 1 && <span className="text-muted-soft ml-1">&</span>}
                </span>
              ))}
            </span>
          )}
        </div>
      </div>
 
      {/* Lado Direito: Resultados (Tempo / Diferença / Pontos) */}
      <div className="flex flex-col items-end flex-shrink-0 text-right pl-3">
        {/* Fitness Racing (Tempo + Diferença) */}
        {time && (
          <span className="font-mono text-xs font-bold text-white leading-none">
            {time}
          </span>
        )}
        {difference && (
          <span className="font-mono text-[10px] font-bold text-primary mt-1.5 leading-none">
            {difference}
          </span>
        )}
 
        {/* CrossFit (Pontos Totais) */}
        {totalPoints !== undefined && (
          <span className="font-mono text-xs font-bold text-primary leading-none">
            {totalPoints} <span className="text-[8px] font-bold uppercase tracking-wider text-muted font-sans ml-0.5">Pts</span>
          </span>
        )}
      </div>
    </div>
  );
}
