# Quem paga a taxa WODArena: decisões aprovadas

Diagnóstico e proposta aprovados pelo usuário em 2026-10-27, com as seis decisões na opção recomendada (A). A maquete é [taxa-servico-aprovado.html](taxa-servico-aprovado.html), a cópia da página como foi aprovada (diagnóstico, simulador, maquete da aba Pagamentos e do resumo do pedido, plano). As Stories 1.82 a 1.85 citam esta pasta nos critérios de aceite.

O visual da maquete é o do app (tokens de `src/app/globals.css`): o cartão no tema escuro do painel do gestor e o resumo do pedido na superfície clara do `RegisterModal`. A implementação não cria estilo novo.

## O pedido

Hoje a taxa da plataforma (10%) é somada ao valor da inscrição e aparece ao atleta como "Taxa de serviço (10%)". O gestor passa a escolher, na aba Pagamentos, entre **repassar ao atleta** (como hoje) ou **absorver no valor da inscrição** (o atleta paga só o preço anunciado e a taxa sai do que o gestor recebe). A WODArena recebe os mesmos 10% nos dois casos, pelo mesmo `application_fee` / `marketplace_fee` / `application_fee_amount`. Tarifas do gateway de referência: Mercado Pago 4,89% no crédito e 0,99% no PIX (sobre o valor cobrado do atleta).

## Decisões aprovadas

1. **D1 · Onde fica a escolha:** por gestor, na aba Pagamentos, valendo para todos os eventos dele.
2. **D2 · Quando vale:** nos pagamentos criados depois de salvar. A regra é lida no servidor ao gerar cartão, PIX ou link, e gravada na inscrição (`registrations.service_fee_payer`). Inscrição paga nunca muda.
3. **D3 · Stripe (EUR/GBP):** segue a mesma escolha. Sem escolha salva, o padrão da Stripe é **absorver** (como a Stripe sempre cobrou), para nenhum preço mudar sem aviso; o do Mercado Pago é **repassar**.
4. **D4 · Atleta com a taxa absorvida:** o resumo do pedido não mostra nada sobre taxa; inscrição e total iguais.
5. **D5 · Dono da plataforma:** coluna "Quem paga a taxa" na lista de gestores do `/owner`, só leitura.
6. **D6 · Reembolso:** os Termos ficam como estão; a redação com a taxa absorvida é decisão de negócio/jurídico, fora desta entrega.

## Regras

| Quem paga | Atleta paga | Gestor recebe | WODArena retém |
|---|---|---|---|
| Atleta (padrão MP) | inscrição + 10% | inscrição integral | 10% da inscrição |
| Gestor (padrão Stripe) | inscrição | inscrição − 10% | 10% da inscrição |

- A conferência de pagamento (`paymentIntegrity.ts`) espera inscrição + taxa só quando o atleta paga. Sem escolha gravada na inscrição, vale o padrão do gateway: MP soma, Stripe não.
- O painel financeiro do gestor (`managerFinance.ts`) e o saldo do gestor no `/owner` seguem a mesma regra.
- Sem escolha salva em `manager_payment_settings`, nada muda para nenhum gestor.

## Achados da leitura que a entrega trata

- A1: a conferência reprovaria vendas com taxa absorvida (Story 1.82).
- A2: o painel do gestor superestimaria o recebido (Story 1.82).
- A3: o resumo do pedido nos eventos Stripe mostrava a taxa somada, mas a Stripe cobrava só a inscrição (Story 1.83).
- A4: a inscrição passa a guardar quem pagou a taxa (Story 1.82).
- A5 (**em aberto**): confirmar em um pagamento real, em `fee_details`, se a tarifa do Mercado Pago incide sobre o total cobrado do atleta. O simulador da maquete assume que sim.
- A6: Termos (decisão D6).

## Fora de escopo

Percentual da taxa por gestor ou por evento; escolha por evento (D1-C); texto dos Termos; reembolso proporcional.
