# Mobile competitivo (WODArena × HeadScore)

Análise do concorrente headscore.com.br no celular (390 × 844) e propostas para as telas públicas da WODArena. Feita e aprovada em 2026-11-11.

- Artefato da análise completa (comparativo, capturas e medidas): https://claude.ai/artifact/G6igLGccFkJJ1RT98f8i1M
- Maquetes aprovadas (só o desenho proposto): [maquetes-aprovadas.html](maquetes-aprovadas.html)

## Decisões do usuário (2026-11-11)

| Item | O que é | Decisão |
|---|---|---|
| Q1 | Tirar "Sandbox" do card de pagamento e do rodapé | Aprovado |
| Q2 | Til de "GESTÃO" cortado pela animação do título | Aprovado |
| Q3 | Esconder "Sem descrição cadastrada." no card | Aprovado |
| Q4 | Texto da senha do atleta no checkout sem citar /admin | Aprovado |
| Q5 | Plural certo durante a contagem animada do card | Aprovado |
| Q6 | Logo sem repetição no topo do celular | Aprovado |
| P1 | Barra de navegação no rodapé do celular | Aprovado |
| P2 | Home com o atleta primeiro | Aprovado |
| P3 | Busca e filtros em chips, lista agrupada por mês | Aprovado |
| P4 | Card de evento compacto | Aprovado |
| P5 | Página do evento com inscrição fixa no rodapé | Aprovado |
| P6 | Inscrição em 3 etapas em tela cheia | Aprovado |
| P7 | Ranking em lista no celular | **Reprovado: o ranking fica como está** |
| P8 | Confiança e ajuda (rodapé escuro, /ajuda, organizador) | Aprovado |
| P9 | Identidade própria | Aprovado (opção A, a recomendada) |

## Hero da home com vídeo (2026-11-11, Story 1.136)

Depois da 1.132 o usuário pediu que o hero da home mantenha o vídeo e, na versão 2 da proposta, que saiam as linhas que simulam raias e os nomes "Raia 1 a 8".

- Artefato: https://claude.ai/artifact/LMZwu6hNtctrNqtxunABAT
- Cópia da maquete aprovada (versão 2): [hero-com-video/index.html](hero-com-video/index.html). Abaixo do topo, as imagens são capturas da home de 2026-11-11.

| Item | O que é | Decisão |
|---|---|---|
| D1 | A: vídeo como fundo do topo, atrás do título (B era um quadro 16:9 abaixo da frase) | A |
| D2 | Versão leve do vídeo no celular (960 × 540, 2,8 MB) | Aprovado |
| D3 | `/organizadores` continua com o vídeo no topo, sem mudança visual | Aprovado |
| D4 | `/ajuda` também perde as linhas de raia do topo | Aprovado |

Com isso o motivo de raias da P9 sai do topo da home e da ajuda; a letra larga de título continua. Medida que trava a altura: em 390 × 844 o 1º card estava a 593 px e a meta da 1.132 é 600 px.

## Premissas tomadas na implementação

Pontos que a aprovação não respondeu. Valem até o usuário dizer o contrário.

1. **P9 = opção A**: fundo escuro e amarelo de ação mantidos; títulos em letra larga (Archivo, eixo de largura) e motivo de raias numeradas. A opção B (dourado do logo como cor da marca) não entra.
2. **P3 sem geolocalização**: o filtro de lugar é por estado (UF), sem pedir a localização do navegador.
3. **P8 sem dados inventados**: razão social, CNPJ e contato de suporte aparecem só quando configurados por variável de ambiente. A política de reembolso remete ao regulamento de cada evento.
4. **"Últimas vagas" e "Esgotado"**: não entraram. O bootstrap público esconde a contagem de inscrições de propósito (`registrationsCount: null`, travado pelos testes de endurecimento de segurança); precisa de liberação explícita de uma contagem agregada por categoria.

## Adaptações em relação às maquetes

- **Card (1.130):** status e contagem de tempo continuam numa faixa acima do banner, e não por cima dele: o projeto já tinha a regra testada de não cobrir a arte do organizador.
- **Home (1.132/1.133):** o destaque do dono aparece no grupo "Em destaque" em card largo no computador (banner à esquerda), para não deixar uma linha com um card só. Eventos já começados e não encerrados abrem os próximos em "Acontecendo agora".
- **Inscrição (1.134):** o tamanho de camisa continuou como select nativo (os testes da camisa opcional travam a marcação; no celular abre o seletor do sistema). O rascunho fica em `sessionStorage`, não em `localStorage`, por causa de aparelhos compartilhados.
- **Ajuda (1.135):** sem chamados com protocolo (não existe operação de suporte para isso). Razão social, CNPJ e canal de suporte aparecem quando as variáveis de ambiente forem preenchidas.

## Stories

| Story | Itens | Status |
|---|---|---|
| 1.127 | Q1–Q6 | InReview |
| 1.128 | P9 (opção A): fonte de título e motivo de raias | InReview |
| 1.129 | P1 | InReview |
| 1.130 | P4 | InReview |
| 1.131 | P5 | InReview |
| 1.132 | P2 | InReview |
| 1.133 | P3 | InReview |
| 1.134 | P6 | InReview |
| 1.135 | P8 | InReview |
| 1.136 | Hero com vídeo, sem raias (D1–D4) | InReview |

## Medidas de referência (antes)

- 1º card da home a 2.253 px; cards de 577 a 641 px de altura.
- Página do evento: botão a 366 px e o seguinte a 2.142 px, numa página de 3.717 px.
- Checkout de trio: 23 campos (19 obrigatórios), rolagem de 2.984 px dentro do modal.
