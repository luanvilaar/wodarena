'use client';

import React from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
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

  return (
    <div
      className="rounded-lg border border-card-border bg-card p-4 space-y-3 transition-colors hover:bg-elevated/30 cursor-pointer"
      onClick={onViewDetails}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          onViewDetails?.();
        }
      }}
    >
      {/* Rank + Name + Country */}
      <div className="flex items-start gap-3">
        <span className={`inline-flex items-center justify-center h-8 w-8 rounded-full font-bold text-sm flex-shrink-0 ${getRankColor()}`}>
          {rank > 0 ? rank : '-'}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h3 className="font-bold text-sm text-white truncate uppercase">
              {athlete.name}
            </h3>
            {athlete.country && (
              <span className="text-[9px] font-bold text-muted-soft bg-dark-gray/50 rounded px-1.5 py-0.5 flex-shrink-0">
                {athlete.country}
              </span>
            )}
          </div>
          <p className="text-xs text-muted truncate">
            {athlete.box}
          </p>
        </div>
      </div>

      {/* Stats Grid: Time | Difference | Points */}
      <div className="grid grid-cols-3 gap-2 text-xs">
        {time && (
          <div className="rounded-md bg-dark-gray/30 p-2 border border-card-border/50">
            <span className="block text-[9px] font-bold text-muted mb-1 uppercase tracking-wider">Tempo</span>
            <span className="font-mono font-bold text-primary block break-words">{time}</span>
          </div>
        )}
        {difference && (
          <div className="rounded-md bg-dark-gray/30 p-2 border border-card-border/50">
            <span className="block text-[9px] font-bold text-muted mb-1 uppercase tracking-wider">Dif.</span>
            <span className="font-mono font-bold text-primary block break-words">{difference}</span>
          </div>
        )}
        {totalPoints !== undefined && (
          <div className="rounded-md bg-dark-gray/30 p-2 border border-card-border/50">
            <span className="block text-[9px] font-bold text-muted mb-1 uppercase tracking-wider">Pts</span>
            <span className="font-mono font-bold text-white block">{totalPoints}</span>
          </div>
        )}
      </div>

      {/* Instagram Link */}
      {!athlete.isTeam && athlete.instagram && (
        <a
          href={`https://instagram.com/${athlete.instagram.trim().replace(/^@/, '')}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary-hover transition-colors"
          onClick={(e) => e.stopPropagation()}
          title={`Ver Instagram de ${athlete.name}`}
        >
          <InstagramIcon className="h-3.5 w-3.5" />
          <span>@{athlete.instagram.trim().replace(/^@/, '')}</span>
        </a>
      )}

      {/* Team expansion button */}
      {athlete.isTeam && teamMembers.length > 0 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand?.();
          }}
          aria-expanded={isExpanded}
          className="w-full h-10 text-xs font-bold text-primary bg-primary/10 border border-primary/30 rounded hover:bg-primary/20 transition-colors flex items-center justify-center gap-1.5"
        >
          {isExpanded ? (
            <>
              <ChevronUp className="h-4 w-4" />
              <span>Ocultar Membros</span>
            </>
          ) : (
            <>
              <ChevronDown className="h-4 w-4" />
              <span>Ver Membros ({teamMembers.length})</span>
            </>
          )}
        </button>
      )}

      {/* Expanded team members */}
      {isExpanded && teamMembers.length > 0 && (
        <div className="border-t border-card-border/30 pt-3 space-y-2 animate-fadeIn">
          {teamMembers.map((member, idx) => (
            <div
              key={idx}
              className="text-xs p-2.5 rounded bg-dark-gray/20 border border-card-border/30"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-white">{member.name}</span>
                {member.instagram && (
                  <a
                    href={`https://instagram.com/${member.instagram.replace(/^@/, '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:text-primary-hover inline-flex items-center flex-shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <InstagramIcon className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
