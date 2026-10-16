# Súmula digital: desenhos aprovados

Dois desenhos aprovados pelo usuário em 2026-10-15: o construtor da súmula (etapas E1d, E1e e E1f) e a arbitragem presencial (etapa E3). Os artefatos publicados em claude.ai deixaram de abrir; as cópias desta pasta são a referência.

## Construtor da súmula

Desenho aprovado pelo usuário em 2026-10-15 para o construtor da súmula na aba Provas. Ele substitui o editor da Story 1.45, que foi feito sem um desenho aprovado em tela.

- **Maquete:** [construtor-sumula-aprovado.html](construtor-sumula-aprovado.html). É a revisão 2 da proposta (o artefato publicado não abre mais). Abra o arquivo no navegador; a maquete é interativa.
- **Por que o arquivo fica aqui:** o artefato do desenho anterior (proposta v2 da arbitragem ao vivo, desenho D+E) deixou de abrir. Sem uma cópia no repositório, as Stories 1.44 e 1.45 foram feitas sem o desenho aprovado. Decisão 8 da proposta: a maquete aprovada fica no repositório, e cada story de tela cita esta pasta nos critérios de aceite.

### O que foi aprovado

1. O construtor abre num painel largo por cima da aba Provas, com a montagem à esquerda e a súmula do judge à direita.
2. Cada linha tem três campos: repetições, movimento e carga. O campo de repetições aceita:
   - um número (`50`);
   - uma quantidade por round (`21-15-9`);
   - rounds iguais (`3x10`);
   - a unidade no fim (`500 m`, `30 cal`).

   Isso substitui o "Esquema" e os "Segmentos" da Story 1.45.
3. No For Time, quem não termina recebe a penalidade por repetição que faltou (padrão: 1 s).
4. O desempate pode ser o tempo do último marco concluído (padrão do Open 2026). No AMRAP, o equivalente é o tempo do último round completo.
5. Cada movimento tem a sua unidade: repetições, calorias ou metros.
6. O AMRAP com ladder (repetições crescendo a cada round) fica fora desta rodada.
7. Carga máxima:
   - até 5 movimentos;
   - 1, 2, 3 ou tentativas ilimitadas;
   - janela de tempo opcional;
   - ordem fixa ou livre;
   - score pela soma das melhores cargas ou pela maior carga;
   - desempate pelo tempo da última tentativa, por menos tentativas, ou nenhum.
8. A maquete aprovada fica no repositório.
9. A carga é uma por linha. Quando a carga muda por categoria, cria-se uma prova por categoria (campo "Categoria Vinculada").

### Stories

| Story | Etapa | Escopo |
|-------|-------|--------|
| [1.46](../../stories/1.46.story.md) | E1d | Construtor por linhas, painel largo com a súmula ao lado |
| [1.47](../../stories/1.47.story.md) | E1f | Carga máxima: contrato v2, motor de tentativas e súmula por tentativa |
| [1.48](../../stories/1.48.story.md) | E1e | Unidades por movimento, último marco concluído e último round completo |

## Arbitragem presencial (E3)

- **Proposta:** [arbitragem-presencial-e3-aprovado.html](arbitragem-presencial-e3-aprovado.html). É a cópia da proposta como foi apresentada, por isso ainda diz "aguardando aprovação". As telas dela estão no tema escuro; a decisão 9 trocou a quadra para o tema claro.
- **Aprovação:** o usuário aprovou em 2026-10-15. A decisão 3 foi aprovada com o ajuste abaixo; a 9 era uma pergunta e ficou com o tema claro.

### Decisões

1. O judge é atribuído ao evento inteiro. Na quadra, ele escolhe a bateria e a raia, e o sistema impede duas súmulas abertas para o mesmo atleta na mesma prova.
2. Cada súmula tem o seu relógio: o judge toca "Iniciar" no sinal de largada. O tempo final pode ser corrigido pelo cronômetro oficial.
3. **Ajustada pelo usuário:** "A publicação deve subir na hora, mas o gestor poderá editar resultados caso esses subam por erros cometidos." O envio do judge publica direto no ranking, e o gestor corrige, devolve ou cancela depois, com histórico. A proposta recomendava publicar só depois da revisão.
4. O ranking é recalculado no servidor ao publicar, com a mesma regra do painel (`rankWorkoutScores`). O lançamento manual sem súmula segue como está.
5. O gestor pode devolver (reabre para o judge com o motivo) e corrigir (com justificativa, sem apagar o que o judge lançou).
6. Súmula e lançamento manual convivem. Lançar à mão por cima de uma súmula publicada pede confirmação e fica no histórico.
7. Os toques ficam numa fila no aparelho quando falta conexão e sobem quando ela volta, com o estado sempre à vista.
8. A estrutura da prova trava a partir da primeira súmula aberta. Para mudar, o gestor cancela as súmulas daquela prova (com registro).
9. A súmula na quadra usa o tema claro de alto contraste; o painel continua escuro.

### Stories

| Story | Etapa | Escopo |
|-------|-------|--------|
| [1.49](../../stories/1.49.story.md) | E3a | Judges no evento presencial, área da quadra (eventos e quadro), tema claro |
| [1.50](../../stories/1.50.story.md) | E3b | Tabelas da súmula, abrir e gravar em lote, fila no aparelho, cronômetro oficial, conferir e enviar |
| [1.51](../../stories/1.51.story.md) | E3c | Publicação na hora, ranking no servidor, devolver, corrigir e cancelar, aba "Súmulas e Judges" |
| [1.52](../../stories/1.52.story.md) | E3d | Trava da estrutura com súmula aberta |

A migration `supabase/migrations/20261017120000_scoresheets.sql` (e a da Story 1.43, `20261016120000_workout_structure.sql`) só vale depois de aplicada no Supabase, o que precisa da autorização do usuário.
