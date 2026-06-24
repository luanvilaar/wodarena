# Plano de Análise e Correção — Integração Mercado Pago via OAuth

Este documento apresenta o diagnóstico detalhado das falhas ocorridas na integração via OAuth com o Mercado Pago no projeto **WODArena**, faz um paralelo técnico entre o fluxo atual do projeto e o modelo de integração recomendado, propõe soluções corretivas com seus riscos e impactos, e apresenta a recomendação da melhor abordagem.

---

## 1. Descrição Detalhada do Erro e Causa Raiz

Ao tentar conectar a conta do Mercado Pago de um gestor utilizando o fluxo automático (OAuth), ocorre uma falha de autorização após o redirecionamento de retorno da plataforma do Mercado Pago, gerando mensagens de erro como `oauth_forbidden` ou `critical_error`.

### A Causa Raiz
No fluxo atual do WODArena, o Mercado Pago está configurado para redirecionar o navegador do usuário diretamente para uma rota GET de API backend (`/api/mercadopago/oauth/callback`). 
* **O Bloqueio de Cookies (SameSite):** Os navegadores modernos implementam políticas rígidas de segurança para cookies de sessão (`woda_session`). Quando uma requisição GET de navegação é disparada a partir de um domínio externo (Mercado Pago) para o domínio da nossa API (`wodarena.com.br`), os navegadores de terceiros omitem ou bloqueiam os cookies de sessão devido a políticas de SameSite (Lax/Strict).
* **Falha de Autenticação:** A API do WODArena executa a função `requireSession(request, ['manager', 'owner'])` para garantir que apenas o gestor dono da conta processe a integração. Sem o cookie de sessão, o backend não reconhece o usuário autenticado e aborta a operação retornando erro `oauth_forbidden` (403).
* **Segurança Vulnerável no Estado (CSRF):** Atualmente, o parâmetro `state` enviado ao Mercado Pago é o ID estático do próprio usuário (`user_id`). Isso expõe o sistema a ataques CSRF de repetição (replay attacks) e não segue as diretivas de segurança baseadas em tokens temporários de uso único.

---

## 2. Paralelo Técnico: Integração Atual vs. Modelo Recomendado

| Característica | Fluxo Atual no WODArena | Modelo Recomendado ([mercado-pago-oauth-spec.md](/Users/luanvilaar/Desktop/Projetos/wodarena/docs/mercado-pago-oauth-spec.md)) | O que deve ser ajustado no WODArena |
| :--- | :--- | :--- | :--- |
| **Ponto de Retorno (Redirect URI)** | Rota direta da API Backend:<br/>`GET /api/mercadopago/oauth/callback` | Rota do Frontend da Plataforma:<br/>`/admin?tab=payments` | Alterar a `MERCADOPAGO_REDIRECT_URI` para apontar para o frontend administratório. |
| **Método do Callback** | HTTP `GET` direto na API pelo navegador. | HTTP `POST` assíncrono local disparado pelo Frontend (`fetch`). | Mudar o callback da API para aceitar requisições `POST` de mesma origem. |
| **Envio de Sessão** | Bloqueado ou omitido (Requisição Cross-Site do Mercado Pago). | Enviado perfeitamente (Requisição Same-Origin iniciada pelo JS do Admin). | O Frontend faz a chamada para a mesma origem, garantindo que o cookie de sessão transite com segurança. |
| **Controle de CSRF (`state`)** | `user_id` estático do gestor. | UUID aleatório de uso único gerado no início e armazenado em banco. | Criar tabela de controle temporário `mercadopago_oauth_states` para consumo único. |
| **Experiência do Usuário (UX)** | Recarregamento completo da página (perda de estados locais do React). | Fluxo assíncrono fluido, exibindo loader e limpando a URL por roteador. | Adicionar um interceptador de URL no frontend para tratar o callback de forma silenciosa. |

---

## 3. Possíveis Soluções para Correção

### Solução A: State Assinado via JWT Temporário (Sem alterar a Redirect URI)
* **Descrição:** Mantém o redirecionamento direto para a API GET `/api/mercadopago/oauth/callback`. No início do fluxo (`GET /api/admin/mercadopago?action=oauth_url`), o servidor gera um token JWT criptografado e assinado contendo o `user_id` e um timestamp de expiração (ex. 10 minutos) e o envia no parâmetro `state` do OAuth. No callback, a API ignora a validação tradicional de cookie de sessão (`requireSession`) e descriptografa o JWT enviado no parâmetro `state` para verificar a identidade do gestor de forma criptograficamente segura.
* **Prós:** 
  * Não exige a criação de tabelas adicionais no banco de dados.
  * Mantém o endpoint GET e a Redirect URI configurada atualmente no Mercado Pago.
* **Contras:**
  * O navegador continua recarregando totalmente a interface administrativa ao retornar do Mercado Pago.
  * Não previne ataques de replay (reuso do mesmo código de autorização), pois o state assinado não é consumido/deletado de forma idempotente em um banco de dados.
  * Adiciona lógica de criptografia e gerenciamento de chaves secretas para assinatura de tokens adicionais.

### Solução B: Fluxo Híbrido com Validação Segura no Frontend (Recomendada)
* **Descrição:** Adapta a arquitetura para o modelo recomendado:
  1. **Banco de Dados:** Cria a tabela `mercadopago_oauth_states` no banco de dados para rastrear os estados temporários gerados.
  2. **Início do Fluxo:** A API de geração de URL (`GET /api/admin/mercadopago?action=oauth_url`) gera um UUID aleatório para o `state`, persiste no banco de dados associando-o ao `user_id` do gestor, e retorna a URL apontando a `redirect_uri` para o Frontend (`/admin?tab=payments`).
  3. **Interface Admin:** O frontend intercepta `code` e `state` na URL, exibe uma mensagem de processamento e faz uma chamada assíncrona `POST /api/mercadopago/oauth/callback` enviando `{ code, state }`.
  4. **Callback da API:** A API recebe o `POST`, autentica o usuário com `requireSession` (que funciona porque a chamada é Same-Origin e trafega o cookie), busca o `state` na tabela `mercadopago_oauth_states` para validar que pertence ao usuário logado e não expirou, deleta o registro (garantindo uso único) e procede com a troca do token com o Mercado Pago e gravação em `mercadopago_accounts` e `mercadopago_secrets`.
* **Prós:**
  * **Resiliência Total:** Resolve de forma definitiva o problema de bloqueio de cookies SameSite dos navegadores.
  * **Segurança de Alto Nível:** Proteção total contra CSRF com uso único do token `state`.
  * **Excelente UX:** Sem recarregar a página, a barra de endereços é limpa via router nativo, mantendo o estado da aplicação React estável.
* **Contras:**
  * Requer a criação de uma migration simples para a tabela de estados no banco e alteração de UI no admin.

---

## 4. Análise de Riscos e Impactos

| Solução | Segurança (CSRF / Replay) | Estabilidade da UI (UX) | Risco de Regressão | Esforço de Implementação |
| :--- | :--- | :--- | :--- | :--- |
| **Solução A** (GET + JWT) | **Médio** (Assinado, mas vulnerável a reuso/replay do token se capturado antes da expiração) | **Baixo** (Força reload completo do admin do gestor) | **Muito Baixo** (Modifica apenas a API de início e de callback) | **Baixo** (Apenas lógica de criptografia no backend) |
| **Solução B** (Híbrida - Recomendada) | **Muito Alto** (Estado de uso único deletado após consumo, padrão recomendado de OAuth2) | **Excelente** (Interface assíncrona suave, URL limpa sem recarregar a página) | **Baixo** (Modificações isoladas e protegidas pela suite de testes unitários existente) | **Médio** (Migration, ajuste de API para POST e lógica simples de useEffect no Frontend) |

---

## 5. Recomendação da Melhor Abordagem

Recomendamos fortemente a **Solução B**. Ela segue as melhores práticas da especificação do Mercado Pago, resolve estruturalmente o bloqueio de cookies de sessão dos navegadores modernos em conexões cross-site (o que é vital para suportar Safari, iOS e browsers com bloqueio de cookies de terceiros ativo) e fornece um fluxo visual muito mais profissional para os gestores da plataforma WODArena.

---

## 6. Próximos Passos de Implementação (Pós-Aprovação)

Uma vez aprovado este plano pelo usuário:
1. **Banco de Dados (Migration):**
   Criar o arquivo `supabase/migrations/20260624140000_create_mercadopago_oauth_states.sql` contendo:
   ```sql
   CREATE TABLE IF NOT EXISTS public.mercadopago_oauth_states (
       state TEXT PRIMARY KEY,
       user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes')
   );
   ALTER TABLE public.mercadopago_oauth_states ENABLE ROW LEVEL SECURITY;
   ```
2. **Geração de URL:**
   Alterar `src/app/api/admin/mercadopago/route.ts` para gerar o state em UUID, gravar em `mercadopago_oauth_states` e configurar o `redirect_uri` apontando para o frontend `/admin?tab=payments`.
3. **API do Callback:**
   Alterar `src/app/api/mercadopago/oauth/callback/route.ts` para aceitar `POST`, obter `{ code, state }`, autenticar a sessão do usuário via `requireSession`, buscar e deletar o `state` do banco de dados, e efetuar a troca de tokens mantendo a compatibilidade com a suite de testes.
4. **Interface Administrativa (Frontend):**
   Adicionar no `useEffect` de `src/app/admin/page.tsx` a captura do `code` e `state` na barra de endereços para fazer o fetch local via `POST` e atualizar o estado de conectado sem reload de tela.
5. **Validação:**
   Rodar a suite de testes locais `npm test` para assegurar que a alteração de chaves e o controle de segurança continuam passando em 100% dos testes.
