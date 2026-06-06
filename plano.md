# Plano de Apresentação: Animação de Carregamento (Loading)

Este documento apresenta a proposta e os passos para a criação de uma animação de carregamento (loading) premium e inteligente para o WODArena, ativada sempre que o sistema estiver buscando ou sincronizando dados do banco de dados (Supabase).

---

## 🎯 Objetivo

Eliminar a percepção de travamento ou telas em branco quando o banco de dados demora para retornar os dados das tabelas de eventos, atletas, pontuações, inscrições e cupons, proporcionando uma transição visual fluida, profissional e integrada à identidade premium do WODArena.

---

## 🛠️ O que será feito

### 1. ⚙️ Gerenciamento de Estado de Carregamento (`isLoading`)
- **Alteração**: Integração no `AppContext.tsx`.
- **Funcionamento**: Um estado `isLoading` será exposto para toda a aplicação. Ele inicia em `true` e muda para `false` apenas quando a rotina `fetchAllData` (que consome múltiplas tabelas do Supabase simultaneamente) é finalizada com sucesso ou erro.

### 2. 🎨 Componente Visual Premium (`LoadingOverlay.tsx`)
- **Visual**: Um overlay moderno cobrindo a tela toda, com fundo escuro (`#0b0e11`), desfoque suave do fundo (`backdrop-blur-md`) e cantos suavizados.
- **Identidade Visual**:
  - Exibição centralizada da marca do WODArena (`Ativo_1.svg`) com animação de pulsação suave.
  - Spinner de alto desempenho desenvolvido puramente em CSS, utilizando a cor ouro/amarela (`#fcd535`) característica do WODArena.
  - Textos de suporte rotativos ou estáticos discretos (ex: *"Sincronizando dados com a arena..."*).

### 3. 🛡️ Protetor de Inicialização (`AppLoadingWrapper.tsx`)
- **Implementação**: Um componente de encapsulamento que intercepta a renderização do layout principal enquanto os dados estão sendo requisitados.
- **Vantagem**: Impede que a tela do usuário pisque ou renderize blocos vazios antes dos dados estarem prontificados na memória da aplicação.

### 4. 🔀 Integração no Layout Global (`layout.tsx`)
- **Injeção**: Acoplamento direto no `RootLayout` da aplicação.
- **Resultado**: Toda a aplicação ganha o recurso instantaneamente, cobrindo o Admin, a Home e as páginas de Eventos de forma unificada.

---

## 🧪 Plano de Validação e Qualidade

- **Validação de Tipagem**: Execução do `npm run typecheck` para garantir consistência estrita com TypeScript.
- **Validação de Build**: Execução do `npm run build` para garantir que o Next.js compile com otimização total.
- **Simulação de Redes Lentas**: Testes manuais simulando conexões lentas (Throttling no DevTools) para validar o comportamento e o tempo de exibição do loading.