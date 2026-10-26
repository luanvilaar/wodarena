# Cards de evento: estado de venda e cronologia (opção B aprovada)

Diagnóstico e desenho aprovados pelo usuário em 2026-10-26: **opção B**, "data de verdade no banco e três estados com tempo". Referência das Stories 1.71 (dados) e 1.72 (card).

- **Artefato publicado:** https://claude.ai/artifact/FfxiGQoWd1aaynDVxYjqaj (privado).
- **Cópia no repo:** [cards-estado-cronologia-aprovado.html](cards-estado-cronologia-aprovado.html). A seção "Opção B" é o desenho aprovado; as opções A e C ficaram de fora.

## Problemas que o desenho resolve

1. Evento futuro com a venda fechada tinha o mesmo card de um evento que já aconteceu (opacidade 70%, cinza, cadeado), porque `EventCard` juntava `sales_closed` e `event_finished` no mesmo `isFinished`.
2. Evento que já aconteceu continuava em "Inscrições abertas", com o checkout aceitando inscrição, quando a data foi digitada sem ano ("17 e 18 de outubro"): `parseEventDate` devolvia `null` e `hasEventDatePassed` tratava isso como "não passou".

## Decisões

1. O evento passa a ter `start_date` e `end_date` (tipo `date`). O texto livre `date` continua como rótulo de exibição; vazio no painel, é gerado a partir das datas.
2. "Já aconteceu" sai de `end_date`, no fuso do evento (`time_zone`): o evento termina à meia-noite seguinte ao último dia. Sem `end_date` (evento antigo ou banco sem a migration), vale a leitura do texto, como antes.
3. A mesma regra decide a home, o banner de destaque, a página do evento, o painel e a trava de inscrição do checkout.
4. O prazo de inscrição (`registration_deadline`) vencido fecha a inscrição, mas não transforma o evento em "realizado".
5. Três estados no card:
   - **Aberto:** como hoje, com um marcador de tempo no topo ("Em 5 dias", "Amanhã", "Hoje", "Acontecendo agora").
   - **Futuro com inscrições encerradas:** cores normais, borda superior clara, selo neutro "Inscrições encerradas", marcador "Em 19 dias", texto "Evento confirmado. Inscrições online encerradas pelo organizador.", um só botão "Ver programação" na largura toda. Fica em "Próximos eventos", na ordem da data.
   - **Realizado:** selo "Realizado", marcador "Há 8 dias", banner em preto e branco, sem preço, cidade no lugar do endereço, um só botão "Ver resultados". Fica em "Eventos passados".
6. A data no card é escrita sempre no mesmo formato, gerada das datas reais e no idioma da página: "sáb., 31 de out. de 2026" ou "17–18 de out. de 2026".
7. "Esgotado" fica de fora: o sistema não sabe se a venda fechou por lotação.
8. O desempate legado da 1ª prova (`leaderboardStandings.ts`) continua lendo o texto, para não mudar resultado já publicado.
