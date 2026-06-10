# 📋 Plano Técnico: Separação de Dados - Leaderboard Público vs Privado

**Data:** 2026-06-10  
**Status:** Proposta Técnica  
**Prioridade:** 🔴 CRÍTICA (Segurança)  
**Tempo Estimado:** 6-8 horas  

---

## 🎯 Ideia Principal

**Problema:** O leaderboard precisa mostrar dados para usuários públicos (anônimos), mas não pode expor informações sensíveis de pagamento/inscrição.

**Solução:** Criar um fluxo de dados separado onde:
1. **Dados Privados** (em `registrations`): Email, telefone, status de pagamento, dados de pagamento
2. **Dados Públicos** (em novo endpoint/tabela): Nome do atleta, equipe, Instagram, scores

---

## 📊 Comparação de Dados

```
┌──────────────────────────────────────────────────────────────────┐
│                    DADOS PRIVADOS (registration)                 │
├──────────────────────────────────────────────────────────────────┤
│  ❌ athlete_email       "joao@example.com"                        │
│  ❌ athlete_phone       "(11) 98765-4321"                         │
│  ❌ payment_status      "payment_approved"                        │
│  ❌ payment_id          "pay_xxx_yyy_zzz"                         │
│  ❌ payment_method      "credit_card"                             │
│  ❌ coupon_code         "SUMMER20"                                │
│  ❌ total_paid          "150.00"                                  │
│  ❌ cpf                 "123.456.789-00" (se armazenado)          │
│                                                                    │
│            NÃO DEVE SER PÚBLICO NEM PARA ANÔNIMOS                │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│              DADOS PÚBLICOS (leaderboard_entry)                  │
├──────────────────────────────────────────────────────────────────┤
│  ✅ athlete_id          "ath_123"                                │
│  ✅ athlete_name        "João Santos"                            │
│  ✅ box_name            "Box Força Total"                        │
│  ✅ instagram           "@joao.santos"                           │
│  ✅ country             "BR"                                      │
│  ✅ gender              "male"                                    │
│  ✅ birth_date          "1990-05-15"                             │
│  ✅ is_team             false                                     │
│  ✅ team_members        [...]                                     │
│  ✅ rank                1                                         │
│  ✅ total_points        450                                       │
│  ✅ score_details       { wod1: 100, wod2: 150, ... }            │
│                                                                    │
│             PÚBLICO PARA QUALQUER PESSOA VER                     │
└──────────────────────────────────────────────────────────────────┘
```

---

## 🏗️ Arquitetura Proposta

### **Fluxo Atual (INSEGURO)**
```
Usuário Anônimo
    ↓
Bootstrap API (/api/app/bootstrap)
    ↓
Carrega registrations (com dados sensíveis!)
    ↓
AppContext filtra por payment_approved
    ↓
Leaderboard exibe (expõe email, status de pagamento, etc)
```

### **Fluxo Proposto (SEGURO)**
```
Usuário Anônimo/Logado
    ↓
Bootstrap API (/api/app/bootstrap)
    ↓
Carrega leaderboard_entries (apenas dados públicos!)
    ↓
    ├─ Se Anônimo: Todos os leaderboard_entries com payment_approved
    ├─ Se Logado: Filtra por suas divisões/eventos
    ├─ Se Manager: Filtra por seus eventos
    ├─ Se Owner: Todos
    ↓
AppContext recebe dados já sanitizados
    ↓
Leaderboard exibe com segurança ✅
```

---

## 🔧 4 Opções Técnicas

### **OPÇÃO A: Tabela Desnormalizada `leaderboard_entries` (RECOMENDADA)**

**Melhor para:** Leitura rápida, escala, performance

**O que é:**
- Nova tabela no Supabase: `leaderboard_entries`
- Contém dados desnormalizados de athletes + registrations
- Mantém apenas campos públicos
- Atualizada quando registration é criada/aprovada

**Schema:**
```sql
CREATE TABLE leaderboard_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  division_id TEXT NOT NULL REFERENCES divisions(id) ON DELETE CASCADE,
  athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  athlete_name TEXT NOT NULL,
  box_name TEXT NOT NULL,
  instagram TEXT,
  country TEXT DEFAULT 'BR',
  gender TEXT,
  birth_date TEXT,
  is_team BOOLEAN DEFAULT FALSE,
  team_members JSONB,
  payment_approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Índices para performance
  UNIQUE(event_id, division_id, athlete_id),
  INDEX idx_event_division (event_id, division_id),
  INDEX idx_payment_approved (payment_approved_at)
);

-- Atualizar automaticamente quando registration é aprovada
CREATE OR REPLACE FUNCTION sync_leaderboard_entry()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.payment_status = 'payment_approved' AND OLD.payment_status != 'payment_approved' THEN
    -- Inserir ou atualizar leaderboard_entry
    INSERT INTO leaderboard_entries (
      event_id, division_id, athlete_id, athlete_name, box_name, 
      instagram, country, gender, birth_date, is_team, team_members,
      payment_approved_at
    )
    SELECT 
      r.event_id, r.division_id, a.id, a.name, a.box,
      a.instagram, a.country, a.gender, a.birth_date, a.is_team, a.team_members,
      NOW()
    FROM registrations r
    JOIN athletes a ON r.athlete_id = a.id
    WHERE r.id = NEW.id
    ON CONFLICT (event_id, division_id, athlete_id)
    DO UPDATE SET updated_at = NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_leaderboard
AFTER UPDATE ON registrations
FOR EACH ROW
WHEN (NEW.payment_status = 'payment_approved')
EXECUTE FUNCTION sync_leaderboard_entry();
```

**Vantagens:**
- ✅ Performance excelente (sem JOINs complexos)
- ✅ Dados sempre sincronizados (via trigger)
- ✅ Fácil controlar quais campos expor
- ✅ Escala para 100k+ atletas
- ✅ Seguro por design

**Desvantagens:**
- ⚠️ Requer migration SQL
- ⚠️ Duplicação de dados (trade-off com performance)
- ⚠️ Precisa manter sincronização

---

### **OPÇÃO B: SQL View no Supabase (SIMPLES)**

**Melhor para:** Setup rápido, baixa manutenção

**O que é:**
- View SQL que JOIN athletes + registrations
- Retorna apenas campos públicos
- Filtro de payment_approved no SQL

**Schema:**
```sql
CREATE OR REPLACE VIEW v_leaderboard_entries AS
SELECT 
  a.id as athlete_id,
  a.name as athlete_name,
  a.box as box_name,
  a.instagram,
  a.country,
  a.gender,
  a.birth_date,
  a.is_team,
  a.team_members,
  r.event_id,
  r.division_id,
  r.payment_approved_at
FROM athletes a
INNER JOIN registrations r ON a.id = r.athlete_id
WHERE r.payment_status = 'payment_approved';

-- Exposição via Supabase (RLS policy)
ALTER TABLE v_leaderboard_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read leaderboard entries"
ON v_leaderboard_entries FOR SELECT
USING (true);
```

**Vantagens:**
- ✅ Sem tabela extra (sem duplicação)
- ✅ Setup rápido (1 statement SQL)
- ✅ Filtro de payment_approved no banco
- ✅ Seguro por design
- ✅ Sem triggers para manter

**Desvantagens:**
- ⚠️ Performance pode sofrer com 100k+ registros
- ⚠️ Precisa carregar athletes + registrations juntos
- ⚠️ Menos flexível para denormalização futura

---

### **OPÇÃO C: Endpoint Específico `/api/leaderboard/public` (VERSÁTIL)**

**Melhor para:** Controle total, API profissional

**O que é:**
- Novo endpoint HTTP que retorna apenas dados públicos
- Lógica de filtro no TypeScript (não SQL)
- Cache opcional

**Implementação:**
```typescript
// src/app/api/leaderboard/public/route.ts

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const eventId = searchParams.get('event_id');
    const divisionId = searchParams.get('division_id');

    if (!eventId || !divisionId) {
      return NextResponse.json(
        { error: 'event_id e division_id são obrigatórios' },
        { status: 400 }
      );
    }

    const supabaseAdmin = createSupabaseAdmin();

    // 1. Carregar apenas registrations aprovadas
    const { data: registrations } = await supabaseAdmin
      .from('registrations')
      .select('athlete_id, event_id, division_id, payment_approved_at')
      .eq('event_id', eventId)
      .eq('division_id', divisionId)
      .eq('payment_status', 'payment_approved');

    // 2. Extrair IDs de atletas
    const athleteIds = registrations?.map(r => r.athlete_id) || [];
    if (athleteIds.length === 0) {
      return NextResponse.json({ entries: [] });
    }

    // 3. Carregar APENAS dados públicos dos atletas
    const { data: athletes } = await supabaseAdmin
      .from('athletes')
      .select(
        'id, name, box, instagram, country, gender, birth_date, is_team, team_members'
      )
      .in('id', athleteIds);

    // 4. Carregar scores
    const { data: scores } = await supabaseAdmin
      .from('scores')
      .select('athlete_id, workout_id, value, points, rank')
      .in('athlete_id', athleteIds);

    // 5. Compilar resposta (apenas dados públicos)
    const entries = (athletes || []).map(athlete => ({
      athlete_id: athlete.id,
      athlete_name: athlete.name,
      box_name: athlete.box,
      instagram: athlete.instagram,
      country: athlete.country,
      gender: athlete.gender,
      birth_date: athlete.birth_date,
      is_team: athlete.is_team,
      team_members: athlete.team_members,
      scores: scores?.filter(s => s.athlete_id === athlete.id) || []
    }));

    return NextResponse.json({
      event_id: eventId,
      division_id: divisionId,
      entries,
      total: entries.length
    });
  } catch (err) {
    console.error('[Leaderboard Public API]', err);
    return NextResponse.json(
      { error: 'Erro ao carregar leaderboard público' },
      { status: 500 }
    );
  }
}
```

**Vantagens:**
- ✅ Controle total da resposta
- ✅ Fácil adicionar cache
- ✅ Logging detalhado
- ✅ Flexível para mudanças
- ✅ Seguro (filtro no servidor, não no cliente)

**Desvantagens:**
- ⚠️ Requer novo endpoint
- ⚠️ Mudança no AppContext (chamar novo endpoint)
- ⚠️ Mais código para manter

---

### **OPÇÃO D: Sanitizar no Bootstrap (MENOR MUDANÇA)**

**Melhor para:** Implementação rápida, mínimas mudanças

**O que é:**
- Modificar bootstrap para retornar registrations sanitizadas
- Remover campos sensíveis no TypeScript
- Expor para todos (anônimos + logados)

**Implementação:**
```typescript
// src/app/api/app/bootstrap/route.ts

const sanitizePublicRegistration = (reg: any) => ({
  id: reg.id,
  athlete_id: reg.athlete_id,
  event_id: reg.event_id,
  division_id: reg.division_id,
  payment_status: reg.payment_status,  // Usar no filtro, não expor ao cliente
  // ❌ NÃO retornar: email, phone, payment_id, coupon_code, etc
});

export async function GET(request: Request) {
  try {
    const supabaseAdmin = createSupabaseAdmin();
    const session = getRequestSession(request);

    const registrationsResult = await supabaseAdmin
      .from('registrations')
      .select('*');  // ← Sempre carregar, sem condition

    // ... resto da lógica

    if (!session) {
      // Usuário anônimo: retornar registrations sanitizadas
      return NextResponse.json({
        currentUser: null,
        users: [],
        athletes: (athletesResult.data || []).map(sanitizePublicAthlete),
        scores: scoresResult.data || [],
        registrations: (registrationsResult.data || []).map(sanitizePublicRegistration),
        // ... resto dos dados
      });
    }

    // ... resto da lógica para usuários logados
  }
}
```

**Vantagens:**
- ✅ Menor mudança (apenas 1 função de sanitização)
- ✅ Implementação rápida (< 1 hora)
- ✅ Sem migration SQL
- ✅ Compatível com código existente

**Desvantagens:**
- ⚠️ Sanitização no TypeScript (menos seguro que no SQL)
- ⚠️ Expõe payment_status ao cliente
- ⚠️ Carrega registrations extras para anônimos

---

## 🎯 Recomendação Final

### **ORDEM DE PRIORIDADE:**

**1️⃣ CURTO PRAZO (Hoje - 2 horas):** OPÇÃO D
- Fix rápido do problema imediato
- Permite leaderboard público funcionar
- Prepara para migração futura

**2️⃣ MÉDIO PRAZO (Próxima semana - 4 horas):** OPÇÃO A ou B
- Implementar tabela/view desnormalizada
- Separar completamente dados públicos de privados
- Aumentar segurança

**3️⃣ LONGO PRAZO (Futuro):** OPÇÃO C
- Se escala para 100k+ atletas
- Se necessário cache avançado
- Se precisar API profissional

---

## 📋 Plano de Implementação (OPÇÃO A + D)

### **FASE 1: Quick Fix com OPÇÃO D (2 horas)**

**Arquivo:** `src/app/api/app/bootstrap/route.ts`

```typescript
// Adicionar function (linha 5)
const sanitizePublicRegistration = (reg: Record<string, unknown>) => ({
  id: String(reg.id),
  athlete_id: reg.athlete_id ? String(reg.athlete_id) : null,
  event_id: String(reg.event_id),
  division_id: String(reg.division_id),
  payment_status: String(reg.payment_status)
  // NÃO retornar: email, phone, payment_id, coupon_code, payment_method, total_paid, etc
});

// Mudar linha 46
// ❌ ANTES
session ? supabaseAdmin.from('registrations').select('*') : Promise.resolve({ data: [] })

// ✅ DEPOIS
supabaseAdmin.from('registrations').select('*')

// Mudar linha 99 (para anônimos)
// ❌ ANTES
registrations: registrationsResult.data || []

// ✅ DEPOIS
registrations: !session 
  ? (registrationsResult.data || []).map(sanitizePublicRegistration)
  : registrationsResult.data || []
```

**Resultado:**
- ✅ Leaderboard público funciona
- ✅ Dados sensíveis não são expostos
- ✅ Mantém compatibilidade com código existente

---

### **FASE 2: Implementar OPÇÃO A (4 horas)**

**Migração SQL:** `supabase/migrations/20260610_leaderboard_entries.sql`

```sql
-- Criar tabela
CREATE TABLE leaderboard_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  division_id TEXT NOT NULL REFERENCES divisions(id) ON DELETE CASCADE,
  athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  athlete_name TEXT NOT NULL,
  box_name TEXT NOT NULL,
  instagram TEXT,
  country TEXT DEFAULT 'BR',
  gender TEXT,
  birth_date TEXT,
  is_team BOOLEAN DEFAULT FALSE,
  team_members JSONB,
  payment_approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(event_id, division_id, athlete_id),
  INDEX idx_event_division (event_id, division_id),
  INDEX idx_payment_approved (payment_approved_at)
);

-- Criar trigger
CREATE OR REPLACE FUNCTION sync_leaderboard_entry()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.payment_status = 'payment_approved' 
     AND (OLD.payment_status IS NULL OR OLD.payment_status != 'payment_approved') THEN
    INSERT INTO leaderboard_entries (
      event_id, division_id, athlete_id, athlete_name, box_name, 
      instagram, country, gender, birth_date, is_team, team_members,
      payment_approved_at
    )
    SELECT 
      r.event_id, r.division_id, a.id, a.name, a.box,
      a.instagram, a.country, a.gender, a.birth_date, a.is_team, a.team_members,
      NEW.updated_at
    FROM athletes a
    WHERE a.id = NEW.athlete_id
    ON CONFLICT (event_id, division_id, athlete_id)
    DO UPDATE SET 
      athlete_name = EXCLUDED.athlete_name,
      box_name = EXCLUDED.box_name,
      instagram = EXCLUDED.instagram,
      country = EXCLUDED.country,
      gender = EXCLUDED.gender,
      birth_date = EXCLUDED.birth_date,
      is_team = EXCLUDED.is_team,
      team_members = EXCLUDED.team_members,
      updated_at = NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_leaderboard_on_payment_approved
AFTER UPDATE ON registrations
FOR EACH ROW
EXECUTE FUNCTION sync_leaderboard_entry();

-- Backfill: popular com registrations já aprovadas
INSERT INTO leaderboard_entries (
  event_id, division_id, athlete_id, athlete_name, box_name,
  instagram, country, gender, birth_date, is_team, team_members,
  payment_approved_at
)
SELECT 
  r.event_id, r.division_id, a.id, a.name, a.box,
  a.instagram, a.country, a.gender, a.birth_date, a.is_team, a.team_members,
  r.updated_at
FROM registrations r
JOIN athletes a ON r.athlete_id = a.id
WHERE r.payment_status = 'payment_approved'
ON CONFLICT DO NOTHING;

-- RLS: permitir leitura pública
ALTER TABLE leaderboard_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read leaderboard entries"
ON leaderboard_entries FOR SELECT
USING (true);
```

**Modificar AppContext:** Usar `leaderboard_entries` ao invés de filtrar `registrations`

```typescript
// Em src/context/AppContext.tsx, adicionar carregamento
const leaderboardEntriesResult = await supabaseAdmin
  .from('leaderboard_entries')
  .select('*');

// Depois modificar getLeaderboard para usar leaderboard_entries
const getLeaderboard = (eventId: string, divisionId: string) => {
  const event = events.find(e => e.id === eventId);
  if (!event) return [];

  // Usar leaderboardEntries ao invés de filtrar registrations
  const divisionAthletes = athletes.filter(a => 
    a.divisionId === divisionId && 
    leaderboardEntries.some(le => 
      le.athlete_id === a.id && 
      le.event_id === eventId && 
      le.division_id === divisionId
    )
  );
  
  // ... resto do código
};
```

---

## 🧪 Checklist de Testes

### Fase 1 (OPÇÃO D)
- [ ] Compilação sem erros
- [ ] Bootstrap retorna registrations sanitizadas
- [ ] Usuário anônimo não vê email/phone/payment_id
- [ ] Usuário logado vê dados completos (se necessário)
- [ ] Leaderboard público mostra dados

### Fase 2 (OPÇÃO A)
- [ ] Migration aplicada sem erros
- [ ] `leaderboard_entries` criada com dados
- [ ] Trigger funciona quando registration é aprovada
- [ ] AppContext usa `leaderboard_entries`
- [ ] Leaderboard mostra dados corretos
- [ ] Performance acceptable (< 2s)

---

## 📊 Comparação de Opções

| Aspecto | A: Tabela | B: View | C: Endpoint | D: Sanitizar |
|---------|-----------|---------|-----------|--------------|
| **Tempo Setup** | 4h | 1h | 2h | 30min |
| **Performance** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| **Segurança** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| **Escalabilidade** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| **Manutenção** | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Recomendado?** | ✅ Sim | Se 10k athletes | Se >100k | ✅ Início rápido |

---

## 🚀 Timeline Recomendada

```
DIA 1 (Hoje)
├─ 30min: Implementar OPÇÃO D (sanitização)
├─ 1h: Testes básicos
├─ Commit: "feat: sanitizar dados públicos no leaderboard"
└─ Status: Leaderboard público funciona ✅

DIA 2 (Amanhã)
├─ 4h: Implementar OPÇÃO A (tabela desnormalizada)
├─ 1h: Testes completos
├─ Commit: "feat: adicionar leaderboard_entries table"
└─ Status: Arquitetura segura + performática ✅

DIA 3+
└─ Monitorar performance e considerar OPÇÃO C se necessário
```

---

## 📝 Dados a Expor vs Não Expor

### ✅ PODE EXPOR (Público)
- athlete_name
- box_name (nome da equipe)
- instagram
- country
- gender
- birth_date (ou apenas age group)
- is_team
- team_members (apenas nomes)
- rank
- points/times (scores)
- photo_url (se não sensível)

### ❌ NUNCA EXPOR (Privado)
- athlete_email
- athlete_phone
- payment_status
- payment_id
- payment_method
- payment_date
- coupon_code
- total_paid
- cpf/documentos
- address
- credit card info

---

## ✅ Sign-off

- [ ] Entende o problema (exposição de dados sensíveis)
- [ ] Concorda com separação público/privado
- [ ] Aprova a sequência (OPÇÃO D → OPÇÃO A)
- [ ] Pronto para implementar

---

**Próximo Passo:** Qual opção você prefere começar? Recomendo OPÇÃO D + A (30min hoje + 4h amanhã)

