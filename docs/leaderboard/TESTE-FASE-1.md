# 🧪 Guia de Teste: Fase 1

**Tempo Estimado:** 10 minutos  
**Objetivo:** Validar que leaderboard público funciona com dados sanitizados  

---

## 📋 Pré-requisitos

- ✅ Implementação concluída (commit f492c9e)
- ✅ Arquivo `.env` configurado
- ✅ Banco de dados Supabase acessível

---

## 🚀 TESTE 1: Compilação TypeScript

```bash
npm run typecheck
```

**Resultado Esperado:**
```
✓ Types generated successfully
```

✅ Se passou, continue para Teste 2

---

## 🚀 TESTE 2: Iniciar Dev Server

```bash
npm run dev
```

**Resultado Esperado:**
```
> next dev

✓ Ready in 1234ms

Local:        http://localhost:3000
Environments: .env
```

✅ Se passou, abra browser no próximo passo

---

## 🚀 TESTE 3: Verificar API Bootstrap (Anônimo)

### Passo 1: Abrir em Navegação Anônima
```
Atalho: Ctrl+Shift+N (Windows) ou Cmd+Shift+N (Mac)
URL: http://localhost:3000
```

### Passo 2: Abrir DevTools
```
F12 → Aba "Network"
```

### Passo 3: Fazer Chamada para Bootstrap
```bash
# No console do DevTools (Aba "Console"):
fetch('/api/app/bootstrap')
  .then(r => r.json())
  .then(d => console.log(d.registrations))
```

### Passo 4: Verificar Response

**Procure por:** `registrations` no Console

**Resultado Esperado:**
```javascript
[
  {
    id: "reg_123",
    athlete_id: "ath_456",
    event_id: "evt_789",
    division_id: "div_000",
    payment_status: "payment_approved"
  },
  {
    id: "reg_124",
    athlete_id: "ath_457",
    event_id: "evt_789",
    division_id: "div_000",
    payment_status: "payment_approved"
  }
  // ... mais registrations
]
```

### Verificação de Segurança

❌ **NÃO DEVE APARECER:**
```javascript
athlete_email         // ❌ "joao@example.com"
athlete_phone         // ❌ "(11) 98765-4321"
payment_id            // ❌ "pay_xxx_yyy"
payment_method        // ❌ "credit_card"
coupon_code           // ❌ "SUMMER20"
total_paid            // ❌ 150.00
```

✅ Se o resultado combina com esperado, continue para Teste 4

---

## 🚀 TESTE 4: Visualizar Leaderboard Anônimo

### Passo 1: Encontrar um Evento
Na navegação anônima (sem login), acesse:
```
http://localhost:3000
```

### Passo 2: Clicar em um Evento
Procure por um evento com divisões/leaderboard.  
Exemplo: "Leaderboard" ou "Rankings"

### Passo 3: Verificar Leaderboard

**Antes da Fase 1:**
```
┌─────────────────────────┐
│   LEADERBOARD VAZIO     │
│   (nenhum dado mostra) │
└─────────────────────────┘
```

**Depois da Fase 1:**
```
┌──────────────────────────────────────┐
│  #  │ Nome          │ Box       │ Pts │
├──────────────────────────────────────┤
│  1  │ João Santos   │ Box Force │ 450 │
│  2  │ Maria Silva   │ Box Prime │ 430 │
│  3  │ Pedro Costa   │ Box Cross │ 410 │
│  ... (mais atletas)                  │
└──────────────────────────────────────┘
```

✅ Se aparecem dados, o teste passou!

---

## 🚀 TESTE 5: Comparar Anônimo vs Logado

### Passo 1: Testar em Navegação Anônima
```
✅ Leaderboard mostra dados
✅ Dados sanitizados (sem email/phone)
```

### Passo 2: Fazer Login
```
Fechar janela anônima
Fazer login normal
```

### Passo 3: Testar Logado
```
✅ Leaderboard mostra dados
✅ Dados completos (como antes)
```

### Passo 4: Verificar Compatibilidade

**Usuário logado DEVE VER:**
- Mesma informação de leaderboard que antes
- Nenhuma mudança no comportamento
- Ranking, pontos, nomes intactos

✅ Se idêntico ao antes, compatibilidade confirmada

---

## 📊 Matriz de Testes

```
Teste                         │ Status  │ Observações
──────────────────────────────┼─────────┼─────────────────
1. TypeScript Compila         │  ✓/✗   │
2. Dev Server Inicia          │  ✓/✗   │
3. API Retorna Dados          │  ✓/✗   │
4. Sem email/phone            │  ✓/✗   │
5. Leaderboard Aparece        │  ✓/✗   │
6. Anônimo Vê Dados           │  ✓/✗   │
7. Logado Vê Dados            │  ✓/✗   │
8. Sem Regressão              │  ✓/✗   │
```

---

## 🐛 Troubleshooting

### Erro: "Leaderboard ainda vazio"

**Causa Possível:** Cache do navegador

**Solução:**
```bash
# Terminal: Parar dev server (Ctrl+C)
# Limpar cache:
rm -rf .next

# Reiniciar dev server:
npm run dev

# No navegador: Ctrl+Shift+R (hard refresh)
```

### Erro: "TypeError: Cannot read property 'map'"

**Causa Possível:** Função sanitizePublicRegistration não definida

**Solução:**
```bash
# Verificar arquivo:
grep -n "sanitizePublicRegistration" src/app/api/app/bootstrap/route.ts

# Deve retornar 2 linhas (definição + uso)
# Se não, arquivo pode estar corrompido, re-ler FASE-1-COMPLETA.md
```

### Erro: "Compile error in TypeScript"

**Solução:**
```bash
npm run typecheck

# Verificar output para mensagem específica
# Se houver erro, pode ser tipo RegistrationRow não definido
```

---

## ✅ Checklist de Testes

- [ ] TypeScript compila sem erros
- [ ] Dev server inicia
- [ ] API /api/app/bootstrap retorna dados
- [ ] Registrations contém apenas campos públicos
- [ ] ❌ athlete_email não aparece
- [ ] ❌ athlete_phone não aparece
- [ ] ❌ payment_id não aparece
- [ ] ✅ Leaderboard anônimo mostra dados
- [ ] ✅ Leaderboard logado mostra dados (como antes)
- [ ] ✅ Nenhuma regressão em funcionalidade

---

## 📈 Sucesso!

Se todos os testes passarem ✅, a Fase 1 está **100% operacional**.

```
┌────────────────────────────────────┐
│  ✅ FASE 1 VALIDADA              │
├────────────────────────────────────┤
│  • Leaderboard público funciona   │
│  • Dados sanitizados corretamente │
│  • Sem breaking changes           │
│  • Pronto para Fase 2             │
└────────────────────────────────────┘
```

---

## 📞 Próximas Ações

1. **Concluir testes acima**
2. **Confirmar que tudo funciona**
3. **Aguardar Fase 2** (tabela desnormalizada) na próxima semana

---

## 💾 Arquivos de Referência

- `FASE-1-COMPLETA.md` - Resumo completo da implementação
- `src/app/api/app/bootstrap/route.ts` - Arquivo modificado
- `PLANO-LEADERBOARD-DADOS-PUBLICOS.md` - Plano técnico completo

