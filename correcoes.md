# Plano de Correções - WODArena

Este documento apresenta o diagnóstico e o plano de ação para corrigir os três problemas relatados no sistema do gestor e na visão pública do evento.

---

## 1. Problema de Persistência da Logo e do Banner
### Sintoma
O gestor carrega a logo e o banner no painel de administração, as imagens aparecem no preview, mas não persistem no banco de dados e somem após o refresh ou na visualização pública.
### Causa
* O frontend armazena o usuário autenticado (`currentUser`) localmente no `localStorage`.
* O backend autentica as ações administrativas na API `/api/admin/persistence` através de um cookie seguro (`woda_session` de 12 horas).
* Se o cookie de sessão expirar, o gestor continua navegando no frontend (o bootstrap retorna sucesso para requisições anônimas), mas qualquer tentativa de persistência administrativa retorna `401 Unauthorized`. Como resultado, as imagens carregadas localmente no estado do React são revertidas no recarregamento porque o salvamento falhou silenciosamente ou exibiu erro genérico.
### Solução
* Atualizar a API de bootstrap `/api/app/bootstrap` para retornar no payload o `currentUser` da sessão ativa (ou `null` se expirado).
* Atualizar o `AppContext.tsx` no carregamento inicial para sincronizar o `currentUser` local com o retornado pelo backend. Se a sessão tiver expirado no backend, o frontend limpa o `localStorage` e encerra a sessão local imediatamente.

---

## 2. Erro ao Criar Novas Categorias pelo Gestor
### Sintoma
Ao tentar criar uma nova categoria, o painel exibe a mensagem de erro: *"Não foi possível cadastrar a categoria. Tente novamente."*
### Causa
* Mesma causa do problema anterior: a sessão do gestor expirou no cookie do servidor (`woda_session`), fazendo com que a API administrativa retorne `401 Unauthorized`.
### Solução
* A sincronização automática da sessão descrita no item 1 fará com que o gestor seja deslogado antes de tentar realizar ações que exijam autenticação, oferecendo um comportamento correto e evitando erros genéricos.

---

## 3. Percurso de Fitness Race Invisível na Visão Pública
### Sintoma
Ao configurar e publicar o percurso oficial de Fitness Race no painel de controle, os usuários públicos na página pública do evento só visualizam o card fixo "Percurso Completo", sem os detalhes das estações e etapas.
### Causa
* O arquivo da página pública do evento (`src/app/event/[id]/page.tsx`) na aba de Exercícios (`workouts`) renderiza apenas a listagem genérica de provas do CrossFit (`event.workouts`).
* Não há lógica implementada para exibir o percurso dinâmico estruturado (`courseLayout`) das divisões para eventos do tipo `fitness_racing` quando publicado (`isCoursePublished === true`).
### Solução
* Ajustar a aba de Exercícios em `src/app/event/[id]/page.tsx` para detectar se `event.eventType === 'fitness_racing'`.
* Caso seja, exibir um seletor de categorias com percursos publicados e renderizar a linha do tempo oficial de percurso de forma elegante e premium, listando cada corrida e estação de exercícios correspondente com distâncias, repetições e pesos.
