# 📝 Exemplos de Código: Correções Mobile Leaderboard

## 1. Hook `useMediaQuery` (Utility)

Crie em `src/hooks/useMediaQuery.ts`:

```typescript
import { useState, useEffect } from 'react';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia(query);
    setMatches(mediaQuery.matches);

    const handleChange = (e: MediaQueryListEvent) => {
      setMatches(e.matches);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [query]);

  return matches;
}
```

**Uso:**
```typescript
const isMobile = useMediaQuery('(max-width: 640px)');
const isTablet = useMediaQuery('(max-width: 1024px)');
```

---

## 2. Componente `MobileLeaderboardCard`

Crie em `src/components/MobileLeaderboardCard.tsx`:

```typescript
'use client';

import React from 'react';
import { Trophy, Medal } from 'lucide-react';
import { Athlete } from '@/types';

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

  return (
    <div
      className="rounded-lg border border-card-border bg-card p-4 space-y-3"
      onClick={onViewDetails}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          onViewDetails?.();
        }
      }}
    >
      {/* Rank + Name */}
      <div className="flex items-center gap-3">
        <span className={`inline-flex items-center justify-center h-8 w-8 rounded-full font-bold text-sm ${getRankColor()}`}>
          {rank > 0 ? rank : '-'}
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-sm text-white truncate uppercase">
            {athlete.name}
          </h3>
          <p className="text-xs text-muted truncate">
            {athlete.box}
          </p>
        </div>
      </div>

      {/* Grid: Time | Difference | Points */}
      <div className="grid grid-cols-3 gap-2 text-xs">
        {time && (
          <div className="rounded-md bg-dark-gray/30 p-2 border border-card-border/50">
            <span className="block text-[10px] font-bold text-muted mb-1">Tempo</span>
            <span className="font-mono font-bold text-primary">{time}</span>
          </div>
        )}
        {difference && (
          <div className="rounded-md bg-dark-gray/30 p-2 border border-card-border/50">
            <span className="block text-[10px] font-bold text-muted mb-1">Dif.</span>
            <span className="font-mono font-bold text-primary">{difference}</span>
          </div>
        )}
        {totalPoints !== undefined && (
          <div className="rounded-md bg-dark-gray/30 p-2 border border-card-border/50">
            <span className="block text-[10px] font-bold text-muted mb-1">Pts</span>
            <span className="font-mono font-bold text-white">{totalPoints}</span>
          </div>
        )}
      </div>

      {/* Team expansion (if applicable) */}
      {athlete.isTeam && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand?.();
          }}
          aria-expanded={isExpanded}
          className="w-full h-10 text-xs font-bold text-primary bg-primary/10 border border-primary/30 rounded hover:bg-primary/20 transition-colors"
        >
          {isExpanded ? 'Ocultar Membros' : 'Ver Membros'}
        </button>
      )}

      {/* Expanded team members */}
      {isExpanded && athlete.teamMembers && Array.isArray(athlete.teamMembers) && (
        <div className="border-t border-card-border/30 pt-3 space-y-2 animate-fadeIn">
          {(athlete.teamMembers as any[]).map((member, idx) => (
            <div
              key={idx}
              className="text-xs p-2 rounded bg-dark-gray/20 border border-card-border/30"
            >
              <span className="font-semibold text-white">{member.name}</span>
              {member.instagram && (
                <a
                  href={`https://instagram.com/${member.instagram.replace(/^@/, '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-primary text-[10px] mt-0.5"
                >
                  @{member.instagram.replace(/^@/, '')}
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Country badge */}
      {athlete.country && (
        <div className="flex gap-2 text-[10px]">
          <span className="rounded bg-dark-gray border border-card-border/40 px-2 py-1 font-bold text-muted-soft">
            {athlete.country}
          </span>
        </div>
      )}
    </div>
  );
}
```

---

## 3. Filtro de Categorias Responsivo

Atualize em `src/components/Leaderboard.tsx` (linhas ~125-168):

```typescript
// Adicione no topo do componente
const isMobile = useMediaQuery('(max-width: 640px)');

// Substitua o bloco de filtros (linhas 125-168)
<div className="flex flex-col gap-4 rounded-lg border border-card-border bg-card p-4">
  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
    
    {/* FILTRO DE CATEGORIAS: Desktop vs Mobile */}
    {isMobile ? (
      // Mobile: Dropdown
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
      // Desktop: Botões
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

    {/* FILTRO DE FAIXA ETÁRIA (idêntico, mas com melhorias) */}
    {event.eventType === 'fitness_racing' && activeCategory?.useAgeGroups && (
      <div className="flex items-center gap-2 w-full sm:w-auto lg:flex-grow lg:justify-end">
        <label htmlFor={`leaderboard-age-${event.id}`} className="text-xs font-bold uppercase tracking-wider text-muted">
          Idade
        </label>
        <select
          id={`leaderboard-age-${event.id}`}
          value={ageGroupFilter}
          onChange={(e) => setAgeGroupFilter(e.target.value)}
          className="h-10 flex-1 sm:flex-initial rounded-md border border-card-border bg-background px-3 text-sm font-bold uppercase tracking-wider text-white focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
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
```

---

## 4. Renderização Condicional: Tabela vs Cards

Atualize em `src/components/Leaderboard.tsx` (linhas ~170-175):

```typescript
// Após o bloco de filtros

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
            time={event.eventType === 'fitness_racing' ? secondsToTimeStr(row.totalPoints) : undefined}
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
      {/* Tabelas originais aqui (linhas 173-523) */}
      {event.eventType === 'fitness_racing' ? (
        // Tabela fitness racing...
      ) : (
        // Tabela crossfit...
      )}
    </div>
  )
) : (
  // Estado vazio
  <div className="space-y-3 rounded-xl border border-card-border bg-card py-16 text-center">
    {/* ... */}
  </div>
)}
```

---

## 5. Drawer Responsivo (Mobile-First)

Substitua nos drawers (linhas ~551-785 e 788-1036):

```typescript
{/* Drawer do Atleta Individual - RESPONSIVO */}
{selectedAthleteForProfile && (
  <div 
    className="fixed inset-0 z-50 overflow-hidden" 
    aria-labelledby="athlete-slide-over-title" 
    role="dialog" 
    aria-modal="true"
  >
    <div className="absolute inset-0 overflow-hidden">
      {/* Overlay */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300 animate-fadeIn" 
        onClick={() => setSelectedAthleteForProfile(null)}
      />

      {/* Drawer Container */}
      <div className="pointer-events-none fixed inset-0 flex flex-col sm:inset-y-0 sm:right-0 sm:flex-row sm:max-w-full pl-0 sm:pl-10">
        <div className="pointer-events-auto w-full sm:w-screen sm:max-w-sm h-[90vh] sm:h-full transform transition duration-300 ease-in-out border-l border-card-border bg-card animate-slideInRight flex flex-col">
          
          {/* Header Fixo */}
          <div className="flex-shrink-0 px-4 sm:px-6 flex items-start justify-between border-b border-card-border py-4">
            <div className="space-y-1">
              <span className="inline-flex rounded-full bg-primary/20 border border-primary/30 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-primary">
                Atleta Individual
              </span>
              <h2 
                className="text-lg sm:text-xl font-bold text-white uppercase tracking-wide" 
                id="athlete-slide-over-title"
              >
                {selectedAthleteForProfile.name}
              </h2>
            </div>
            
            {/* Close Button - Always Visible */}
            <button
              type="button"
              onClick={() => setSelectedAthleteForProfile(null)}
              className="flex-shrink-0 rounded-md text-muted hover:text-white focus:outline-none focus:ring-2 focus:ring-primary p-2 h-10 w-10 flex items-center justify-center"
              aria-label="Fechar painel de detalhes"
            >
              <X className="h-6 w-6" aria-hidden="true" />
            </button>
          </div>

          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 space-y-6">
            {/* Perfil Header, Detalhes, Performance, etc. */}
            {/* ... (código original, sem mudanças) */}
          </div>

          {/* Footer Action (Mobile-friendly) */}
          <div className="flex-shrink-0 px-4 sm:px-6 py-4 border-t border-card-border space-y-2">
            <a
              href={`/athlete/${selectedAthleteForProfile.id}`}
              className="block w-full h-10 rounded-md bg-primary text-ink font-bold text-sm text-center flex items-center justify-center hover:bg-primary/90 transition-colors"
            >
              Ver Perfil Completo
            </a>
            <button
              onClick={() => setSelectedAthleteForProfile(null)}
              className="w-full h-10 rounded-md border border-card-border text-muted hover:text-white font-bold text-sm transition-colors"
            >
              Fechar
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
)}
```

---

## 6. Search Input Responsivo

Substitua em ambas as tabelas (linhas ~184-192 e 350-357):

```typescript
{/* Search Input - Responsivo */}
<div className="relative">
  <label 
    htmlFor={`leaderboard-search-${event.id}`}
    className="block text-[10px] font-bold text-muted uppercase tracking-wider mb-1 sm:hidden"
  >
    Buscar atleta ou box
  </label>
  <Search className="absolute left-2.5 top-1/2 sm:top-[26px] h-4 w-4 -translate-y-1/2 text-muted-soft pointer-events-none" />
  <input
    id={`leaderboard-search-${event.id}`}
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
      className="absolute right-2.5 top-1/2 sm:top-[26px] h-5 w-5 -translate-y-1/2 text-muted hover:text-white transition-colors flex items-center justify-center p-0"
      aria-label="Limpar busca"
    >
      <X className="h-4 w-4" />
    </button>
  )}
</div>
```

---

## 7. Teste de Acessibilidade (Exemplo)

Crie em `tests/leaderboard-a11y.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react';
import { Leaderboard } from '@/components/Leaderboard';

describe('Leaderboard A11y', () => {
  const mockEvent = {
    id: 'test',
    name: 'Test Event',
    divisions: [
      { id: '1', name: 'Div A', useAgeGroups: false, ageGroups: [] },
    ],
    workouts: [],
    eventType: 'fitness_racing' as const,
  };

  test('search input has label', () => {
    render(<Leaderboard event={mockEvent} />);
    const searchLabel = screen.queryByText(/Buscar/i);
    expect(searchLabel).toBeInTheDocument();
  });

  test('expand button has aria-expanded', () => {
    render(<Leaderboard event={mockEvent} />);
    const expandButtons = screen.queryAllByRole('button', { expanded: false });
    expandButtons.forEach((btn) => {
      expect(btn).toHaveAttribute('aria-expanded');
    });
  });

  test('modal has role="dialog"', () => {
    render(<Leaderboard event={mockEvent} />);
    const dialog = screen.queryByRole('dialog');
    expect(dialog).toBeInTheDocument();
  });
});
```

---

## 📊 Checklist de Implementação

- [ ] Criar hook `useMediaQuery.ts`
- [ ] Criar componente `MobileLeaderboardCard.tsx`
- [ ] Atualizar filtros de categorias
- [ ] Atualizar search input
- [ ] Adaptar drawers para mobile
- [ ] Teste responsividade em 320-1024px
- [ ] Teste acessibilidade (axe, Lighthouse)
- [ ] Teste performance (LCP, CLS)
- [ ] Deploy e monitorar bounce rate mobile

