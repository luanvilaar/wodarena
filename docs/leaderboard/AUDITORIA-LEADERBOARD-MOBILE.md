# 🔍 Auditoria: Rotas `/leaderboard` para Mobile

**Data:** 2026-06-10  
**Versão:** 1.0  
**Escopo:** Análise de responsividade, acessibilidade, performance e usabilidade mobile

---

## 📊 Resumo Executivo

| Categoria | Status | Severidade |
|-----------|--------|-----------|
| **Responsividade Mobile** | ⚠️ CRÍTICO | 🔴 ALTA |
| **Acessibilidade** | ⚠️ MODERADO | 🟡 MÉDIA |
| **Performance** | ✅ BOM | 🟢 BAIXA |
| **UX/Usabilidade** | ⚠️ CRÍTICO | 🔴 ALTA |
| **Segurança** | ✅ BOM | 🟢 BAIXA |

---

## 🔴 CRÍTICO: Problemas Identificados

### 1. **Overflow Horizontal em Tabelas (Severidade: CRÍTICA)**

**Problema:**
```typescript
// Linha 177 & 340 - Tabelas com min-w fixo
<table className="min-w-[760px] w-full border-collapse text-left">
<table className="min-w-[840px] w-full border-collapse text-left">
```

- Em dispositivos mobile (< 375px), tabelas transbordam
- Scroll horizontal é confuso e quebra fluxo de leitura
- User precisa fazer pan constante para ver dados

**Impacto:** Experiência mobile praticamente inutilizável em phones pequenos (iPhone SE, Galaxy A12)

**Solução Recomendada:**
```typescript
// Use design responsivo com cards em mobile
const isMobile = useMediaQuery('(max-width: 640px)');

{isMobile ? (
  // Render como card stack
  <div className="space-y-2">
    {filteredLeaderboard.map(row => (
      <MobileLeaderboardCard row={row} />
    ))}
  </div>
) : (
  // Render como tabela
  <table className="min-w-[760px]">...</table>
)}
```

---

### 2. **Drawers/Modals Inutilizáveis em Mobile (Severidade: CRÍTICA)**

**Problema:**
```typescript
// Linha 561, 797
<div className="pointer-events-none fixed inset-y-0 right-0 flex max-w-full pl-10">
  <div className="pointer-events-auto w-screen max-w-md ..."
```

- `max-w-md` (28rem/448px) = 100% da tela em iPhones pequenos
- Drawer ocupa toda viewport, sem feedback visual
- Scroll interno não funciona bem em mobile com thumb
- Feature de expandir equipes fica escondida/inacessível

**Impacto:** Usuários não conseguem fechar drawers, ler informações completas ou navegar

**Solução Recomendada:**
```typescript
// Adapte altura e largura para mobile
const drawerWidth = isMobile 
  ? 'w-full' 
  : 'w-screen max-w-md';

const drawerMaxHeight = isMobile
  ? 'max-h-[90vh]'  // Deixe 10vh para botão de fechar
  : 'h-full';

<div className={`${drawerWidth} ${drawerMaxHeight} ...`}>
```

---

### 3. **Tabelas Muito Comprimidas (Severidade: ALTA)**

**Problema:**
```typescript
// Linhas de tabela com min-h-[56px] espaçadas inadequadamente
<div className="grid grid-cols-[56px_1fr] items-center h-full min-h-[56px]">
```

- Texto de names é font-size xs (12px) — muito pequeno para ler com thumb
- Links do Instagram ficam difíceis de tocar (hit area < 44px)
- Badges de país/box saem da tela em mobile

**Impacto:** Erros de toque frequentes, leitor de tela confuso

**Solução Recomendada:**
```typescript
// Mobile-first sizing
const textSize = isMobile ? 'text-sm' : 'text-xs';
const minTouchTarget = isMobile ? 'min-h-12' : 'min-h-[56px]';
const minTouchWidth = 'min-w-[44px]'; // WCAG 2.1 AA standard
```

---

### 4. **Filtros de Categoria Inutilizáveis em Mobile (Severidade: ALTA)**

**Problema:**
```typescript
// Linhas 128-146
<div className="flex gap-1 rounded-md border border-card-border bg-background p-1 overflow-x-auto scrollbar-none w-full lg:w-auto">
  {event.divisions.map((division) => (
    <button className="min-h-9 flex-1 lg:flex-initial text-center rounded-sm px-4 py-1.5 text-xs ...">
```

- `flex-1` (iguais width) se houver 4+ divisões = botões muito comprimidos
- `overflow-x-auto` com `scrollbar-none` = usuários não veem scroll
- `text-xs` muito pequeno para tocar com precisão
- Sem visual feedback de "scrollar mais"

**Impacto:** Usuários não conseguem selecionar categorias (especialmente em eventos com muitas divisões)

**Solução Recomendada:**
```typescript
// Mobile: dropdown; Desktop: botões
const filterUI = isMobile ? (
  <select className="h-10 w-full..." value={selectedCategoryId} onChange={...}>
    {event.divisions.map(d => <option>{d.name}</option>)}
  </select>
) : (
  <div className="flex gap-1 overflow-x-auto...">
    {/* Botões originais */}
  </div>
);
```

---

### 5. **Search Input Ocluído em Mobile (Severidade: ALTA)**

**Problema:**
```typescript
// Linhas 184-192
<input
  placeholder="Buscar atleta ou box..."
  className="w-full pl-8 pr-3 py-1.5 bg-background border border-card-border/60 rounded text-xs ..."
/>
```

- Não há label visível (apenas `<label htmlFor>` escondido em lg)
- Input é `text-xs` (12px) — muito pequeno
- Sem espaço para apagar o texto (`placeholder-shown:pr-10`)
- Em iPhones, teclado oculta input quando focado

**Impacto:** Usuários não conseguem fazer search efetivo em mobile

**Solução Recomendada:**
```typescript
<div className="relative w-full">
  <label htmlFor="search" className="block text-[10px] font-bold text-muted mb-1 sm:hidden">
    Buscar
  </label>
  <input
    id="search"
    type="text"
    placeholder="Nome ou box..."
    className="w-full h-10 pl-8 pr-8 text-sm focus:ring-2 focus:ring-primary"
  />
  {searchQuery && (
    <button
      onClick={() => setSearchQuery('')}
      className="absolute right-2 top-1/2 -translate-y-1/2 p-1"
      aria-label="Limpar busca"
    >
      <X className="h-4 w-4" />
    </button>
  )}
</div>
```

---

## 🟡 MODERADO: Problemas de Acessibilidade

### 6. **Falta de Labels e ARIA (Severidade: MÉDIA)**

**Problema:**
```typescript
// Linhas 73-74: Estado local sem feedback acessível
const [expandedTeams, setExpandedTeams] = useState<Record<string, boolean>>({});
const [selectedAthleteForProfile, setSelectedAthleteForProfile] = useState<Athlete | null>(null);

// Linhas 257-259: Botão de expand sem aria-expanded
onClick={isTeam ? () => toggleTeamExpanded(row.athlete.id) : undefined}
// Falta: aria-expanded={isExpanded}
```

- Leitores de tela não entendem que equipes podem expandir
- Modals não têm `role="dialog"` ou `aria-labelledby` corretos
- Sem `aria-live` para mensagens de sucesso/erro

**Solução Recomendada:**
```typescript
<button
  onClick={() => toggleTeamExpanded(row.athlete.id)}
  aria-expanded={isExpanded}
  aria-controls={`team-members-${row.athlete.id}`}
  className="..."
>
  {displayName}
  {isTeam && (
    isExpanded ? <ChevronUp /> : <ChevronDown />
  )}
</button>

{isExpanded && (
  <div id={`team-members-${row.athlete.id}`}>
    {/* Team members */}
  </div>
)}
```

---

### 7. **Insuficiente Contraste em Mobile (Severidade: MÉDIA)**

**Problema:**
```typescript
// Linhas 236-241: Posição com contraste baixo
text-muted  // #9CA3AF em dark mode = ~4.5:1 contra #0F0F12
text-muted-soft  // #6B7280 = ~3.2:1 = FALHA WCAG AA
```

- Em telas brilhosas (outdoor sun), textos `muted-soft` ficam invisíveis
- Especialmente badges de idade/país (linhas 310-311)

**Solução Recomendada:**
```typescript
// Aumente contraste para mobile
const contrastClass = isMobile 
  ? 'text-muted'      // 4.5:1
  : 'text-muted-soft'; // 3.2:1

// Alternativa: adicione background
<span className="bg-dark-gray/50 text-muted-soft rounded px-1">
  {value}
</span>
```

---

### 8. **Teclado Virtual Oculta Conteúdo (Severidade: MÉDIA)**

**Problema:**
```typescript
// Linha 560-562: Drawer começa em `fixed inset-y-0 right-0`
// Quando teclado abre em mobile, conteúdo acima é oculto
// Usuário não pode scrollar para ver botão "Fechar"
```

**Impacto:** Usuarios com teclado móvel aberto não conseguem fechar drawer

**Solução Recomendada:**
```typescript
// Detecte teclado e ajuste
const [keyboardHeight, setKeyboardHeight] = useState(0);

useEffect(() => {
  const handleResize = () => {
    const vh = window.innerHeight;
    const maxVh = Math.max(window.innerHeight, window.innerHeight);
    if (vh < maxVh * 0.75) {
      setKeyboardHeight(window.innerHeight * 0.5);
    }
  };
  window.addEventListener('resize', handleResize);
}, []);

<div style={{ marginBottom: `${keyboardHeight}px` }}>
  {/* Content */}
</div>
```

---

## 🟢 BOM: Pontos Positivos

✅ **API segura** — Sem SQL injection, XSS ou credential leaks  
✅ **Context API bem estruturado** — `useApp()` encapsula lógica  
✅ **Animações otimizadas** — `cubic-bezier` boas, sem jank  
✅ **Componentes reutilizáveis** — `secondsToTimeStr`, `getTeamMembersArray` são puros  
✅ **TypeScript** — Tipos corretos, sem `any` desnecessário  

---

## 📋 Checklist de Correções

### Sprint 1 (CRÍTICO)

- [ ] **Tabelas → Cards em mobile**
  - Criar componente `MobileLeaderboardCard`
  - Usar `useMediaQuery` para breakpoint
  - Teste em iPhone SE (320px) e Galaxy A12 (360px)

- [ ] **Drawers → Full-height em mobile**
  - Ajustar `max-w-md` → `w-full` em mobile
  - Adicionar botão "Fechar" fixo no topo
  - Teste scroll com 50+ team members

- [ ] **Filtros de categorias → Dropdown em mobile**
  - Criar dropdown responsivo
  - Manter botões em desktop (lg breakpoint)
  - Teste com 8+ divisões

### Sprint 2 (ACESSIBILIDADE)

- [ ] **Adicionar ARIA labels**
  - `aria-expanded` em botões de expand
  - `role="dialog"` em modals
  - `aria-live` em mensagens

- [ ] **Aumentar hit targets**
  - Mínimo 44x44px (WCAG 2.1 AA)
  - Especialmente links Instagram
  - Botões de fechar

- [ ] **Melhorar contraste**
  - Validar com contrast ratio de 4.5:1 (AA)
  - Testar outdoor sun simulation

---

## 🧪 Testes Recomendados

### Responsividade
```bash
# Teste em tamanhos
320px  (iPhone SE)
375px  (iPhone 13)
390px  (Pixel 6)
600px  (Tablet pequeno)
768px  (iPad mini)
1024px (Desktop)
```

### Acessibilidade
```bash
# Ferramentas
axe DevTools Chrome
Lighthouse (Accessibility tab)
NVDA screen reader (Windows)
VoiceOver (iOS)
```

### Performance Mobile
```bash
# Lighthouse metrics
LCP < 2.5s
FID < 100ms
CLS < 0.1
TTI < 3.5s
```

---

## 🚀 Recomendações Prioritárias

| Prioridade | Ação | Impacto | Esforço |
|-----------|------|--------|--------|
| **P0** | Tabelas → Cards mobile | 🔴 UX criticamente quebrado | 🟡 Médio (6-8h) |
| **P0** | Drawers full-height mobile | 🔴 Modais inutilizáveis | 🟡 Médio (4-6h) |
| **P1** | Filtros → Dropdown mobile | 🟡 Seleção difícil | 🟢 Baixo (2-3h) |
| **P1** | ARIA labels + accessibility | 🟡 Leitores de tela | 🟢 Baixo (3-4h) |
| **P2** | Contraste + keyboard support | 🟡 Edge cases | 🟢 Baixo (2-3h) |

---

## 📈 Métricas de Sucesso

Após implementação:

```
✅ Nenhum overflow horizontal em 320-1024px
✅ Drawers 100% utilizáveis sem scroll externo
✅ 100% de WCAG 2.1 AA compliance
✅ Lighthouse Accessibility score > 90
✅ Touch targets ≥ 44x44px
✅ Time on page -20% (melhor UX)
✅ Mobile bounce rate -15%
```

---

## 📞 Próximos Passos

1. **Validação com time**
   - Apresentar achados críticos
   - Priorizar P0 vs P1

2. **Implementação**
   - Começar com tabelas → cards
   - Depois drawers
   - Iterar com testes móveis

3. **QA/Testes**
   - Teste em device real (não apenas devtools)
   - Teste com leitor de tela
   - Teste com teclado touch lento

---

**Auditoria Completa:** ✅  
**Gerado em:** 2026-06-10  
**Próxima revisão sugerida:** Após Sprint 1
