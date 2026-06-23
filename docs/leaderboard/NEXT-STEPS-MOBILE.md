# 🎯 Próximos Passos: Renderização Condicional Mobile

**Prioridade:** P0 Crítico  
**Impacto:** Desbloqueia teste de UX mobile  
**Tempo estimado:** 1-2 horas

---

## O Que Será Feito

A tabela será renderizada de forma condicional:
- **Mobile (≤ 640px):** Cards em stack (MobileLeaderboardCard)
- **Desktop (> 640px):** Tabelas originais (mantém compatibilidade 100%)

---

## Padrão de Implementação

### Localização: `src/components/Leaderboard.tsx` - Linhas ~170-530

**Estrutura:**
```typescript
{filteredLeaderboard.length > 0 ? (
  isMobile ? (
    // ========== MOBILE: Card Stack ==========
    <div className="space-y-2 pb-4">
      {filteredLeaderboard.map((row) => {
        // Preparar dados
        return <MobileLeaderboardCard ... />;
      })}
    </div>
  ) : (
    // ========== DESKTOP: Tabela ==========
    <div className="overflow-x-auto rounded-xl border border-card-border bg-card">
      {event.eventType === 'fitness_racing' ? (
        // Tabela fitness racing original
        <table>...</table>
      ) : (
        // Tabela crossfit original
        <table>...</table>
      )}
    </div>
  )
) : (
  // Estado vazio (sem mudanças)
  <div className="space-y-3...">...</div>
)}
```

---

## Passos Exatos

### 1. **Identificar o Bloco Original**

**Linha ~170:** `{/* Tabela de Classificação */}`

```typescript
{filteredLeaderboard.length > 0 ? (
  <div className="overflow-x-auto rounded-xl border border-card-border bg-card">
    {event.eventType === 'fitness_racing' ? (
```

Até **Linha ~525:**
```typescript
      )}
    </div>
  ) : (
    <div className="space-y-3 rounded-xl border border-card-border bg-card py-16 text-center">
```

### 2. **Adicionar Renderização Condicional**

**ANTES:**
```typescript
{filteredLeaderboard.length > 0 ? (
  <div className="overflow-x-auto rounded-xl border border-card-border bg-card">
    {event.eventType === 'fitness_racing' ? (
      // ... tabela fitness racing
    ) : (
      // ... tabela crossfit
    )}
  </div>
) : (
```

**DEPOIS:**
```typescript
{filteredLeaderboard.length > 0 ? (
  isMobile ? (
    // ========== MOBILE ==========
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
    // ========== DESKTOP ==========
    <div className="overflow-x-auto rounded-xl border border-card-border bg-card">
      {event.eventType === 'fitness_racing' ? (
        // ... tabela fitness racing (ORIGINAL, sem mudanças)
      ) : (
        // ... tabela crossfit (ORIGINAL, sem mudanças)
      )}
    </div>
  )
) : (
  // Estado vazio (ORIGINAL, sem mudanças)
```

---

## Dados Necessários para `MobileLeaderboardCard`

```typescript
<MobileLeaderboardCard
  rank={row.rank}                    // número (1, 2, 3, ...)
  athlete={row.athlete}              // objeto Athlete completo
  time={secondsToTimeStr(...)}       // string "1:23:45" ou undefined
  difference={"+00:32"}              // string com diferença ou "-" ou "Líder"
  totalPoints={row.totalPoints}      // número (CrossFit) ou undefined
  isExpanded={expandedTeams[...]}    // boolean
  onToggleExpand={...}               // função
  onViewDetails={...}                // função
/>
```

---

## Testes Manual Após Implementação

### 1. **Desktop (1024px)**
```bash
npm run dev
# Abrir http://localhost:3000
# DevTools: Sem emulação mobile
# ✅ Tabelas devem aparecer normalmente
```

### 2. **Mobile (320px - iPhone SE)**
```bash
# DevTools → Device Emulation → iPhone SE
# ✅ Cards devem aparecer em stack (sem tabelas)
# ✅ Sem overflow horizontal
# ✅ Todos os dados visíveis
```

### 3. **Tablet (600px - iPad)**
```bash
# DevTools → Device Emulation → iPad
# Teste transição entre mobile e desktop
# ✅ Abrir DevTools, redimensionar de 320 → 1024
# ✅ Cards desaparecem, tabelas aparecem suavemente
```

---

## Dados de Teste

**Fitness Racing Card:**
```
Pos: 1
Name: João Silva
Box: Box Crossfit
Time: 1:23:45
Diff: Líder
Country: BR
```

**CrossFit Card:**
```
Pos: 1
Name: Maria Santos
Box: Elite Fitness
Points: 250
Country: BR
```

---

## Checklist de Implementação

- [ ] Adicionar condicional `isMobile ?` após `filteredLeaderboard.length > 0`
- [ ] Implementar bloco MOBILE com cards
- [ ] Mover bloco DESKTOP (original) para `:` (else)
- [ ] Testar TypeScript: `npm run typecheck`
- [ ] Testar compilação: `npm run build`
- [ ] Testar dev: `npm run dev`
- [ ] Testar mobile (DevTools): iPhone SE 320px
- [ ] Testar tablet: iPad 600px
- [ ] Testar desktop: 1024px+ (tabelas originais)
- [ ] Verificar expandir equipes em mobile
- [ ] Verificar clique em card abre drawer
- [ ] Commit com mensagem: `feat(leaderboard): renderização condicional mobile`

---

## Se Algo Der Errado

### TypeScript errors?
```bash
npm run typecheck
# Verificar que MobileLeaderboardCard props match interface
```

### Build fails?
```bash
npm run build
# Verificar imports
# Verificar se isMobile está definido
```

### Cards não aparecem?
```
DevTools → DevTools → Console
Procurar erros de runtime
Verificar se isMobile === true em mobile
```

### Scroll horizontal ainda existe?
```
Verificar className="space-y-2"
MobileLeaderboardCard não deve ter overflow
Cards devem ter full width
```

---

## Recursos

- `src/hooks/useMediaQuery.ts` - Hook mobile detection
- `src/components/MobileLeaderboardCard.tsx` - Componente card
- `src/components/Leaderboard.tsx` - Componente principal (linhas ~170)
- Docs exemplo: `LEADERBOARD-MOBILE-FIX-EXAMPLES.md`

---

**Próximo step após implementação:** Filtros de categorias responsivos (dropdown em mobile)
