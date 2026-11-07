# Painel do Proprietário (/owner): decisões aprovadas

Proposta entregue em 2026-11-06 e aprovada pelo Luan em 2026-11-07, com a opção **A** em todas as decisões (D1 a D6). A página como foi aprovada está em [painel-proprietario-aprovado.html](painel-proprietario-aprovado.html): números que não batem, os 22 achados (A1–A6, B1–B6, C1–C10), a proposta, a maquete navegável, as decisões e o plano. O relatório "Cadastros fora do /owner" (corte de 1.000 linhas, Story 1.119, decisões E1–E4 = A) está em [cadastros-owner-relatorio.html](cadastros-owner-relatorio.html). As Stories 1.120 a 1.126 citam esta pasta nos critérios de aceite.

## Decisões

| # | Assunto | Escolha |
|---|---------|---------|
| D1 | Estrutura | **Cinco seções:** Visão geral, Gestores, Eventos, Comercial e Configurações. O ranking entra no detalhe do evento; banner e taxa vão para Configurações. |
| D2 | Moldura | **Moldura própria**, sem o menu e o rodapé do site público. Barra lateral no computador, faixa de seções no celular, seção aberta no endereço (`/owner?secao=gestores`). |
| D3 | De onde vêm os números | **Rota própria do proprietário** (`GET /api/owner/overview`): soma no servidor, com leitura paginada e as regras de `managerFinance.ts`. |
| D4 | Período | **Filtro de período:** mês atual, 30 dias, ano e tudo, pela data da inscrição (`created_at`), com a comparação ao período anterior. |
| D5 | Leads comerciais | **Status editável** (Novo, Contatado, Qualificado, Descartado) na linha, por rota só do proprietário. Sem migration. |
| D6 | Login do /owner | **Nova tela, variante Proprietário**, reusando a tela aprovada (`AdminLoginScreen`, Story 1.92), sem "Root" nem "Senha Mestra". O `login()` com `ownerOnly` não muda. |
| E2 | Cadastros novos | **Busca no topo + cartão "Cadastros recentes"** na Visão geral, mantendo as cinco seções. |
| E3 | Data de cadastro | **Migration `users.created_at`**, com as datas antigas tiradas do horário do id. Aplicada no banco só a pedido do Luan. |

## Regras que valem para todas as stories

- **Uma regra de cálculo:** todo valor em dinheiro sai de `src/lib/managerFinance.ts`, o mesmo módulo do painel do gestor. Para o mesmo evento, proprietário e gestor veem o mesmo pago, a mesma taxa e o mesmo recebido.
- **Dinheiro separado por moeda:** BRL, EUR e GBP nunca somam juntos; cada valor é formatado com `formatMoney` na moeda do evento.
- **Pendente** é só `payment_pending` e `payment_in_review`, como no painel do gestor. Recusadas e canceladas não entram.
- **Situação do evento** pelo ciclo de vida do site (`getEventStatus`, Story 1.71), em português.
- **Ação crítica pede confirmação** com o efeito numa frase (desligar a taxa, validade no passado).
- **Banco único é produção:** a única migration do plano é a de `users.created_at` (E3), aplicada só a pedido.

## Plano

| Story | O quê | Achados |
|-------|-------|---------|
| 1.120 | Números certos no painel atual | A1–A5, B1, B2, C1–C5, C9, C10 |
| 1.121 | Ações críticas com confirmação | B3–B5 |
| 1.122 | Rota de números do proprietário (`/api/owner/overview`) e `users.created_at` | A6, E3 |
| 1.123 | Moldura, navegação e login | C6–C8, D1, D2, D6 |
| 1.124 | Visão geral nova, com período, fila de atenção e cadastros recentes | D4, E2 |
| 1.125 | Gestores e Eventos (tabelas com filtro e busca, painel lateral, detalhe do evento com ranking) | — |
| 1.126 | Comercial e Configurações | B6, D5 |
