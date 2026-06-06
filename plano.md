# Plano: Redesign Premium da Tela de Login WOD Arena

## Objetivo

Redesenhar completamente a tela de login da WOD Arena mantendo a identidade visual atual da plataforma e elevando a percepção de produto para uma entrada oficial de competições esportivas premium.

A tela deve comunicar imediatamente:

- Competição.
- Performance.
- Tecnologia.
- Organização profissional.
- Credibilidade.

O resultado esperado é uma experiência que pareça a entrada da plataforma oficial de eventos esportivos do Brasil, sem aparência de sistema administrativo genérico, academia comum, ERP corporativo ou landing page SaaS.

---

## Referências e Restrições de Design

### Referência principal

Usar a estrutura visual da Binance como inspiração de sistema:

- Header denso e premium.
- Fundo escuro institucional.
- Cards escuros com borda fina.
- Amarelo como cor primária de ação.
- Tipografia forte.
- Estatísticas grandes e confiáveis.
- Pouca decoração.
- Separação por superfícies, não por sombras ou efeitos.

### Adaptação obrigatória para WOD Arena

O visual deve ser esportivo e competitivo, conectado aos universos de:

- Functional Fitness.
- Fitness Race.
- HYROX.
- Corridas.
- Eventos esportivos.
- Arena de competição.
- Rankings e leaderboards ao vivo.

### O que evitar

- Não criar página genérica de academia.
- Não criar visual corporativo de ERP.
- Não usar glassmorphism excessivo.
- Não usar gradientes modernos de startup SaaS.
- Não usar sombras pesadas.
- Não usar ilustrações abstratas que não comuniquem competição.
- Não transformar a tela em landing page explicativa.

---

## Tokens Visuais Obrigatórios

Manter os tokens já documentados em `desinger-novo.md` e no design system do projeto:

- Background principal: `#0B0E11`.
- Cards: `#1E2329`.
- Amarelo WOD Arena: `#FCD535`.
- Texto principal: `#FFFFFF`.
- Texto secundário: `#EAECEF`.
- Texto auxiliar: `#707A8A`.
- Bordas: `#2B3139`.

### Regra de implementação

No código React/Tailwind, priorizar classes e tokens já existentes:

- `bg-background`
- `bg-card`
- `border-card-border`
- `text-primary`
- `text-muted`
- `text-foreground`
- `bg-primary`
- `text-ink`

Evitar hex direto dentro de `src/app/admin/page.tsx`, porque o teste de design system já valida essa restrição.

---

## Escopo da Tela

A tela de login continua na rota:

- `/admin`

Essa rota deve atender:

- Atletas.
- Organizadores/gestores.
- Proprietários/admins.

Após autenticação, o roteamento por perfil continua sendo responsabilidade da lógica atual:

- `athlete`: área do atleta.
- `manager`: painel de gestão.
- `owner`: painel administrativo completo.

---

## Estrutura da Tela

### 1. Header Premium

Manter o header atual da plataforma, mas ajustar para aparência premium inspirada na Binance.

Elementos:

- Logo WOD Arena à esquerda.
- Link `Eventos`.
- Link `Painel Admin`.
- Seletor de idioma, se já existir no header atual.

Regras visuais:

- Altura máxima: `64px`.
- Fundo escuro `bg-background`.
- Borda inferior fina `border-card-border`.
- Sem sombra.
- Sem gradiente.
- Logo com proporção controlada.
- CTA/links com hover discreto em amarelo.

Observação técnica:

- Verificar se o login em `/admin` renderiza o mesmo header da home. Se hoje a tela de login não usa o header global, decidir entre reutilizar o componente existente ou criar uma barra específica consistente com o header atual.

### 2. Hero Full Height

Criar uma tela de altura total com layout dividido:

- Esquerda: 60% da largura no desktop.
- Direita: 40% da largura no desktop.

No mobile:

- Remover a divisão lateral.
- Usar a imagem esportiva como background.
- Centralizar o card de login.
- Manter a identidade premium escura.

### 3. Área Esquerda: Institucional Esportiva

Usar imagem ou vídeo esportivo ocupando todo o fundo da área esquerda.

Temas permitidos:

- Arena de competição.
- Fitness Race.
- Functional Fitness.
- Corrida.
- Sled push.
- Wall balls.
- Atletas cruzando linha de chegada.
- Ranking ao vivo.

Overlay:

- Aplicar camada escura equivalente a `rgba(0,0,0,0.70)`.
- Implementar via classe/token ou pseudo-elemento CSS, evitando hex solto no componente se possível.

Conteúdo:

- Logo WOD Arena pequeno, sem exagero.
- Badge: `PLATAFORMA OFICIAL DE COMPETIÇÕES`.
- Título:

```text
CONECTE.
COMPITA.
CONQUISTE.
```

- Subtítulo:

```text
Gerencie eventos, acompanhe rankings, publique resultados e participe das maiores competições do Functional Fitness e Fitness Race.
```

Regras de tipografia:

- Título com peso forte, próximo de `700`.
- Sem sombra em texto.
- Sem efeito decorativo.
- Sem letter spacing negativo.
- Quebra de linha controlada em desktop e mobile.

### 4. Estatísticas

Exibir estatísticas em linha no desktop:

- `500+` Atletas.
- `50+` Eventos.
- `20.000+` Resultados.
- `100+` Rankings.

No mobile:

- Grid `2x2`.
- Números grandes.
- Labels curtos.

Observação produtiva:

- Se houver dados reais disponíveis no contexto da aplicação, preferir métricas derivadas de `events`, `athletes`, `registrations` e rankings.
- Se ainda não houver base suficiente para números reais, usar esses valores como conteúdo institucional temporário, deixando isso explícito na story.

### 5. Benefícios

Adicionar uma lista curta abaixo das estatísticas:

- Inscrições Online.
- Rankings Atualizados.
- Leaderboard em Tempo Real.
- Gestão Completa de Eventos.
- Cronograma de Baterias.
- Resultados Instantâneos.

Regras:

- Usar ícone de check discreto.
- Evitar blocos grandes de texto.
- Manter leitura rápida.
- Em mobile, usar grid de uma ou duas colunas conforme espaço.

---

## Área Direita: Card de Autenticação

Criar um card premium sem glassmorphism.

Visual:

- Fundo: card escuro.
- Borda: `1px solid` no token de borda.
- Radius: `12px`.
- Sem sombra pesada.
- Sem blur.
- Sem transparência exagerada.

### Cabeçalho do card

Título:

```text
Entrar na Arena
```

Subtítulo:

```text
Acesse sua conta para competir ou organizar eventos.
```

### Seletor de perfil

Adicionar seletor antes do formulário:

- `ATLETA`
- `ORGANIZADOR`

Comportamento:

- Estado selecionado com amarelo WOD Arena.
- Estado não selecionado com fundo de card/elevated e borda.
- Deve ser acessível por teclado.
- Usar `aria-pressed` ou tabs semânticas.

Ao selecionar `ATLETA`, mostrar benefícios:

- Minhas inscrições.
- Resultados.
- Rankings.
- Histórico.

Ao selecionar `ORGANIZADOR`, mostrar benefícios:

- Criar eventos.
- Gerenciar categorias.
- Lançar resultados.
- Controle financeiro.

Importante:

- Esse seletor não deve alterar a API de login.
- Ele é uma ajuda contextual e visual.
- O login continua usando o mesmo fluxo e a role real do usuário autenticado.

### Formulário

Campos:

- Email.
- Senha.

Adicionar:

- Checkbox `Manter conectado`.
- Link `Esqueci minha senha`.

Cuidados técnicos:

- Só ativar `Manter conectado` se existir suporte real de sessão persistente. Caso contrário, renderizar como UI planejada e abrir task para implementar persistência.
- Só ativar `Esqueci minha senha` se houver rota/API de recuperação. Caso contrário, manter o link como item de backlog ou direcionar para suporte/fluxo existente.

### CTA principal

Botão full width:

```text
ENTRAR NA ARENA
```

Visual:

- Fundo amarelo `#FCD535` via token/classe.
- Texto escuro.
- Altura mínima de 44px.
- Hover/active em variação amarela já existente.
- Estado disabled claro.

### CTA secundário

Botão outline:

```text
CRIAR CONTA GRATUITA
```

Cuidados técnicos:

- Validar qual fluxo real existe para criar conta.
- Se a criação de conta for apenas pelo formulário de inscrição de evento, o botão deve direcionar para eventos disponíveis ou abrir uma explicação curta.
- Não criar rota nova sem story e contrato funcional.

---

## Bloco Diferencial WOD Arena

Abaixo do formulário, adicionar bloco compacto com duas mensagens:

### Para atletas

```text
Acompanhe inscrições, rankings e resultados.
```

### Para organizadores

```text
Crie eventos, categorias, provas e leaderboards em uma única plataforma.
```

Regras:

- Bloco dentro do card ou logo abaixo dele.
- Visual escuro com borda fina.
- Texto curto.
- Não criar card dentro de card com excesso visual.

---

## Responsividade

### Desktop

- Header com 64px.
- Layout 60/40.
- Imagem esportiva à esquerda.
- Card de login à direita.
- Estatísticas em linha.
- Benefícios em grid compacto.

### Tablet

- Reduzir título.
- Manter split se houver espaço suficiente.
- Ajustar card para largura máxima confortável.

### Mobile

- Imagem vira background da tela.
- Overlay escuro aplicado na tela inteira.
- Card de login centralizado.
- Estatísticas em grid `2x2`.
- Benefícios em lista compacta.
- Header mantém altura controlada e links não podem quebrar de forma desorganizada.

---

## Arquivos Prováveis

Implementação principal:

- `src/app/admin/page.tsx`

Possíveis ajustes:

- `src/components/Navbar.tsx`
- `src/components/BrandLogo.tsx`
- `src/app/globals.css`
- `tests/design-system.test.mjs`
- `docs/stories/`

Asset esportivo:

- Verificar se já existe imagem adequada em `public/`.
- Se não existir, adicionar asset aprovado em `public/` com nome descritivo, por exemplo:
  - `public/login-arena-competition.jpg`

Critério do asset:

- Deve mostrar competição real ou visual claramente esportivo.
- Não usar imagem genérica de academia.
- Não usar imagem escura demais que impeça leitura.
- Não depender de hotlink externo.

---

## Plano de Implementação

### Fase 1: Story e alinhamento técnico

Criar story em `docs/stories/` com:

- Contexto.
- Requisitos visuais.
- Critérios de aceite.
- Tasks.
- Dev notes.
- File list.
- Checklist QA.

Critérios mínimos:

- `/admin` continua sendo a rota de login.
- Login de atleta continua funcionando.
- Login de gestor continua funcionando.
- Tela usa identidade WOD Arena/Binance-like esportiva.
- Não há regressão nos testes existentes.

### Fase 2: Asset e estrutura visual

Tarefas:

- Escolher/adicionar imagem esportiva local.
- Criar layout full-height.
- Criar área esquerda institucional.
- Criar card de autenticação à direita.
- Garantir overlay escuro legível.
- Manter header premium com altura máxima de 64px.

### Fase 3: Interação do seletor de perfil

Tarefas:

- Adicionar estado local `selectedLoginProfile`.
- Criar botões `ATLETA` e `ORGANIZADOR`.
- Exibir lista contextual conforme seleção.
- Garantir acessibilidade por teclado e `aria-pressed`.
- Não alterar a autenticação real baseada em role.

### Fase 4: Formulário e CTAs

Tarefas:

- Ajustar labels, placeholders e estados visuais.
- Alterar CTA principal para `ENTRAR NA ARENA`.
- Adicionar checkbox `Manter conectado`, com suporte real ou backlog claro.
- Adicionar link `Esqueci minha senha`, com rota real ou backlog claro.
- Adicionar CTA secundário `CRIAR CONTA GRATUITA`, apontando para fluxo existente ou backlog.

### Fase 5: Responsividade e acabamento

Tarefas:

- Validar desktop, tablet e mobile.
- Garantir que textos não sobreponham.
- Garantir que o card caiba em telas menores.
- Garantir que estatísticas fiquem em `2x2` no mobile.
- Garantir contraste adequado.
- Remover qualquer sombra/gradiente/glassmorphism indevido.

### Fase 6: Testes e qualidade

Rodar:

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`

Também validar manualmente:

- Acessar `http://localhost:3000/admin`.
- Testar login como atleta.
- Testar login como gestor.
- Testar erro de senha inválida.
- Testar responsividade no mobile.
- Conferir se o header não passa de 64px.

---

## Critérios de Aceite

A implementação será considerada concluída quando:

- A rota `/admin` exibir uma tela de login premium com identidade WOD Arena.
- A tela não parecer academia genérica, ERP ou SaaS genérico.
- A área esquerda tiver imagem esportiva com overlay escuro.
- O card de login usar fundo escuro, borda fina e radius de 12px.
- O CTA principal estiver em amarelo WOD Arena.
- O seletor `ATLETA / ORGANIZADOR` funcionar visualmente e sem quebrar a autenticação.
- O login continuar roteando o usuário pelo papel real da conta.
- O mobile tiver experiência própria, sem layout espremido.
- Não houver uso indevido de shadow, gradiente ou glassmorphism.
- Os testes do projeto passarem.

---

## Riscos e Decisões Pendentes

### Recuperação de senha

O prompt pede `Esqueci minha senha`, mas é necessário confirmar se já existe API/rota de recuperação.

Decisão produtiva:

- Se não existir, não implementar recuperação fake.
- Criar item de backlog para API de reset de senha.
- O link pode ficar oculto ou apontar para suporte até a funcionalidade existir.

### Criar conta gratuita

O prompt pede `CRIAR CONTA GRATUITA`, mas hoje a criação de atleta está ligada ao fluxo de inscrição em evento.

Decisão produtiva:

- Se não existir cadastro autônomo, o CTA deve levar para a listagem de eventos.
- Não criar conta sem vínculo com evento sem uma story própria.

### Estatísticas institucionais

Os números `500+`, `50+`, `20.000+`, `100+` podem ser institucionais.

Decisão produtiva:

- Preferir dados reais quando disponíveis.
- Se forem números de marketing, documentar como conteúdo institucional temporário.

### Header

O prompt pede manter o header atual, mas a tela `/admin` pode estar isolada do header global.

Decisão produtiva:

- Reutilizar componente existente se ele não quebrar o fluxo de login.
- Caso contrário, criar header local visualmente compatível.

---

## Resultado Esperado

A nova tela deve fazer o usuário perceber que está entrando em uma plataforma esportiva profissional, com foco em competição, resultados e organização.

O primeiro impacto deve ser:

```text
Esta é a arena oficial onde atletas competem e organizadores operam eventos.
```

