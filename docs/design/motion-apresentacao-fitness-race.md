# Motion de apresentação: súmula digital e telão ao vivo do Fitness Race

Vídeo vertical (9:16), de 55 s, montado no After Effects, para apresentar a nova função do WODArena nos eventos Fitness Race: a **súmula digital** na mão do judge, a **largada do organizador** e o **telão ao vivo com o ranking da prova**.

Este arquivo traz o roteiro cena a cena, a linguagem visual com os valores do app, os tempos em quadros e o código: um script que monta o projeto no After Effects e uma biblioteca de expressões para os movimentos que se repetem.

**Referências visuais no repositório** (abra no navegador, são autocontidas):

- Telão, ranking da prova: [`telao-fitness-race/ranking-unico-aprovado.html`](telao-fitness-race/ranking-unico-aprovado.html) e as capturas da tela real em [`telao-fitness-race/conferencia-1.118/`](telao-fitness-race/conferencia-1.118/).
- Telão, luzes, bandeirada e roxo: [`telao-fitness-race/telao-fitness-race-aprovado.html`](telao-fitness-race/telao-fitness-race-aprovado.html).
- Súmula do judge: [`fitness-race-sumula/telas/dois-cartoes.html`](fitness-race-sumula/telas/dois-cartoes.html) e [`fitness-race-sumula/telas/wall-ball.html`](fitness-race-sumula/telas/wall-ball.html).
- Logo: `src/app/icon.svg` e `docs/design/assets/Ativo-1.svg`.

Os nomes e tempos de atletas são fictícios (os da maquete aprovada). Para mostrar atleta real, peça autorização antes.

---

## 1. Ficha técnica

| Item | Valor |
|------|-------|
| Composição | 1080 × 1920, pixel quadrado, **30 qps** |
| Duração | **55 s** (1650 quadros) |
| Trilha | **120 BPM**: um tempo = 0,5 s = 15 quadros. Todos os cortes caem em tempo inteiro |
| Cor | sRGB, 16 bits por canal no projeto (degradês e brilho das lâmpadas sem faixas) |
| Desfoque de movimento | ligado só nas camadas que se deslocam (linhas da torre, cartões, ponto amarelo); obturador 180° |
| Motor de expressões | Configurações do projeto > Expressões > **JavaScript** |
| Master | ProRes 422 HQ, 1080 × 1920, 30 qps |
| Entrega Reels | H.264 pelo Media Encoder, 1080 × 1920, 30 qps, VBR 2 passos, 16 a 20 Mbps, áudio AAC 320 kbps |

**Áreas seguras do Reels** (o app cobre essas faixas com a interface):

- topo: 0 a 250 px, sem texto;
- rodapé: 1500 a 1920 px (420 px), sem texto nem número importante;
- direita: os 140 px da borda, de 250 a 1500 px, livres (coluna de ícones).

Todo texto que precisa ser lido fica entre **x 90 e 940** e **y 250 e 1500**. O script da seção 8 cria essas três faixas como camadas-guia (não aparecem no render).

---

## 2. Linguagem visual

O vídeo junta dois mundos que o produto já tem e não mistura: o **telão** (escuro, gráfico de transmissão de Fórmula 1, amarelo de destaque) e a **súmula da quadra** (tema claro de alto contraste, feito para ler no sol). A passagem de um para o outro é a história: o que o judge marca no claro aparece no escuro do telão.

### Cores (valores do app)

| Nome | Hex | Onde usar | Origem no código |
|------|-----|-----------|------------------|
| Fundo do telão | `#090B0E` | cenas do telão | `RaceBroadcast.module.css` (`.tv`) |
| Fundo do app | `#0B0E11` | painel do organizador | `globals.css` (`--background`) |
| Cartão escuro | `#14171C` / `#1E2329` | cartões do telão, chips de posição | `.card`, `--card` |
| Linha | `#2B3139` | divisórias, bordas | `--card-border` |
| Texto claro | `#EAECEF` | texto no escuro | `--foreground` |
| Texto apagado | `#929AA5` | box, legendas de apoio | `--muted` |
| **Amarelo WODArena** | `#FCD535` | líder, "contando", tempo a bater, logo | `--primary` |
| Amarelo no claro | `#9A7200` | destaque sobre a súmula branca | `--primary-on-light` |
| Verde | `#0ECB81` | subiu de posição, chegada, tempo final | `--trading-up` |
| Vermelho | `#F6465D` | desceu, penalidade, DNF, selo AO VIVO | `--trading-down` |
| **Roxo** | `#B47CFF` | só "melhor da categoria na estação" | `--purple` do telão |
| Lâmpada acesa | `#FF2D2D` | luzes de largada | `--lamp` |
| Fundo da quadra | `#FFFFFF` + texto `#0B0E11` | súmula do judge | tema claro da quadra |

Regras: o roxo é reservado ao melhor tempo da estação, igual à Fórmula 1; não use roxo em mais nada. O amarelo marca uma coisa por quadro: o líder, ou o "contando", ou o tempo a bater.

### Tipografia

Instale as versões estáticas do Google Fonts (o script usa os nomes PostScript abaixo).

| Papel | Fonte | Tamanho em 1080 × 1920 |
|-------|-------|------------------------|
| Título de cena | Inter ExtraBold (`Inter-ExtraBold`) | 84 a 96 px, entrelinha 1,05 |
| Legenda (texto na tela) | Inter Bold (`Inter-Bold`) | 52 a 56 px, no máximo 2 linhas de 26 caracteres |
| Rótulos em caixa alta | Inter ExtraBold, rastreio +120 | 26 a 30 px |
| Números (relógios, diferenças, reps) | IBM Plex Sans SemiBold (`IBMPlexSans-SemiBold`) | 64 a 200 px |

Relógios que mudam a cada segundo ficam **alinhados pela direita**, para os dígitos não empurrarem o texto. Se o painel Caractere oferecer algarismos tabulares (menu OpenType), ligue.

### Formas que são do produto

- **Chip de posição inclinado −12°** (como na torre e na disputa): retângulo 96 × 64 px, cantos 6 px, cor `#1E2329`; no líder, amarelo com número `#181A20`. O número dentro volta a 0° (contrainclinação).
- **Selo AO VIVO**: pílula vermelha inclinada −10°, ponto branco pulsando (1,4 s por ciclo).
- **Selo da onda** ("O1", "O2", "O3"): contorno de 2 px `#3A414B`, texto `#929AA5`, ao lado do nome.
- **Penalidade**: "+15 s" em vermelho com contorno vermelho a 55%, só os segundos (o motivo nunca aparece).
- **Botão "Segure para…"**: o botão enche da esquerda para a direita em 700 ms, linear, com uma camada branca a 25% (no claro, preta a 25%). É assim no app; não troque por anel.

---

## 3. Tese de movimento

O vídeo é uma prova: **largada, leituras, ranking, chegada**. Cada cena é um trecho dela.

- **Momento autoral:** a troca de posição na torre do telão (cena 6). Bruno, da Onda 2, sobe para o 1º lugar acima de Rafael, da Onda 1, que está três estações à frente na pista. É o que o produto tem de novo: ondas diferentes no mesmo ranking, pelo tempo de prova. A troca leva 27 quadros, com seta verde e vermelha, e tudo em volta fica parado.
- **Abertura e fecho:** as cinco luzes acendem e apagam (cena 1) e a bandeirada quadriculada fecha (cena 8). São os mesmos gestos do telão, não efeitos inventados.
- **Continuidade:** o toque do judge no celular vira um ponto amarelo que sobe até o telão (cena 5) e chega como a linha do atleta na torre. Esse ponto amarelo é o único elemento que atravessa do mundo claro para o escuro.
- **Feedback:** cada rep conta com um pulso de 4 quadros no número; os botões "Segure para…" enchem em 21 quadros; as setas verde e vermelha duram 2 s depois da troca.
- **Orçamento:** brilho (Glow) só nas lâmpadas e no ponto amarelo; desfoque de movimento só em posição; nada de partículas, lens flare, câmera tremendo ou textos girando.

### Tempos em quadros (30 qps)

| Movimento | Tempo | Quadros | Curva |
|-----------|-------|---------|-------|
| Cada luz acendendo depois da anterior | 170 ms | 5 | corte seco |
| Luzes acesas antes de apagar juntas | 550 ms | 16 | corte seco |
| "Segure para…" enchendo | 700 ms | 21 | linear |
| Troca de linhas na torre | 900 ms | 27 | curva do app |
| Cartão ou legenda entrando | 600 ms | 18 | curva do app |
| Cartão ou legenda saindo | 300 ms | 9 | curva de saída |
| Pulso do número a cada rep | 120 ms | 4 | linear de volta |
| Onda de toque no botão | 350 ms | 10 a 11 | linear |
| Faixa quadriculada passando | 1,2 s por período | 36 | linear, em laço |
| Seta de subiu/desceu visível | 2 s depois da troca | 60 | some em 9 quadros |

### A curva do app no After Effects

O telão usa `cubic-bezier(0.16, 1, 0.3, 1)` (`--motion-broadcast-ease`): sai rápido e assenta devagar. No Editor de Gráfico, entre duas chaves:

- **chave de saída:** influência **16%**, velocidade **6,25 ×** a média (média = diferença de valor ÷ tempo entre as chaves);
- **chave de chegada:** influência **70%**, velocidade **0**.

Para saídas, use o espelho, `cubic-bezier(0.7, 0, 0.84, 0)`: chave de saída com influência 70% e velocidade 0; chave de chegada com influência 16% e velocidade 6,25 × a média.

Se preferir não ajustar à mão, a expressão E1 (seção 9) aplica a curva exata em qualquer propriedade com chaves lineares.

Não use quique nem elástico: o produto não tem.

---

## 4. Roteiro cena a cena

Legenda = texto na tela (o vídeo roda sem som no Reels; a legenda conta a história sozinha).

### Cena 1: Cinco luzes · 00:00 a 00:04 (quadros 0 a 119)

- **Imagem:** fundo `#090B0E`. No centro, o pórtico de luzes do telão: base `#050607` de 960 × 380 px, cinco unidades com duas lâmpadas cada (diâmetro 130 px), apagadas em `#3A1A1D`.
- **Movimento:** as unidades acendem uma a uma, da esquerda para a direita, a cada 5 quadros a partir do quadro 15 (00:00,5). Ficam acesas 16 quadros e **apagam juntas** no quadro 57 (00:01,9). No mesmo quadro entra **"LARGADA!"** (Inter ExtraBold 150 px), de 125% para 100% em 18 quadros. Em 00:02,5 a palavra sai (9 quadros) e entra a legenda.
- **Legenda (00:02,5 a 00:04):** **O resultado nasce na quadra.**
- **Som:** um bip grave por luz (5) e um bip agudo no apagar; a batida da trilha entra em 00:01,9.

### Cena 2: A largada é do organizador · 00:04 a 00:10 (120 a 299)

- **Imagem:** painel escuro do organizador, seção Ondas, recortado para o vertical: título "Onda 3 · Open Masculino", "10:24 prevista", lista com 5 atletas (nome e box) e, embaixo, o botão amarelo largo **"Segure para largar"**.
- **Movimento:** um dedo (ou um círculo de toque branco a 40%) pousa no botão em 00:05,5. O botão enche da esquerda para a direita em 21 quadros, linear, e o texto vira **"Continue segurando…"**. Ao encher, o botão vira **"Largou"** e um relógio grande (IBM Plex 200 px) começa em **00:00** e corre. As linhas da lista dão um pulso discreto (escala 100 → 102 → 100, 6 quadros, defasagem de 2 quadros entre elas).
- **Legenda (00:04,4 a 00:09,6):** **A largada é do organizador.** / **Segure o botão e o relógio da onda corre.**
- **Som:** clique ao pousar o dedo; um "tic" seco ao encher; o relógio entra com um pulso grave.

### Cena 3: A súmula do judge, dois cartões · 00:10 a 00:16 (300 a 479)

- **Imagem:** a passagem para o claro. A tela do celular ocupa o quadro inteiro (sem moldura de aparelho; uma borda fina só nos 9 quadros de entrada). Faixa do topo "Fitness Race · Sled Push". Dois cartões empilhados na mesma estação (o judge confere até 2 atletas): Rafael Tavares, **2/4 trechos**, e Thiago Bezerra, **1/4 trechos**. Cada cartão tem o botão grande **"+1 trecho"**, a barra de progresso e "Na estação 1:42".
- **Movimento:** toques nos botões (onda de toque de 10 quadros): 2/4 → 3/4 → 4/4 no primeiro cartão, com a barra enchendo pela curva do app em 12 quadros; o cartão chega a **"Segure para liberar"**. Em 00:13,6 o segundo cartão recebe uma penalidade: o selo **"+15 s"** vermelho entra em 6 quadros ao lado do nome.
- **Legenda (00:10,3 a 00:15,7):** **O judge confere até 2 atletas na mesma tela.** / **Trechos, voltas e repetições, toque a toque.**
- **Som:** clique seco a cada toque; um "toc" mais grave na penalidade.

### Cena 4: Wall Ball · 00:16 a 00:22 (480 a 659)

- **Imagem:** a tela do Wall Ball, um atleta só: "Diego Martins", chip **"Tempo 1:11:15"** correndo (acelerado, ver E2), o contador gigante (IBM Plex 320 px) **96** com **/100** ao lado, a barra "Reps válidas", o botão enorme **"REP ✓"** com "Toque a cada repetição válida" e, menor, **"NO REP"**.
- **Movimento:** 96 → 97 → 98, cada rep com pulso de 4 quadros e onda de toque. Em 00:17,2 o judge toca **NO REP**: o botão pisca uma vez em vermelho (opacidade 0 → 100 → 0 em 8 quadros), a folha "Motivo do NO REP" sobe e desce num toque (12 quadros) e o número **não** muda. 99 → 100. Com 100, o botão principal vira **"Segure para liberar"**, enche em 21 quadros (00:19,4 a 00:20,1) e a tela mostra **"Tempo na liberação 1:11:31"** e, menor, **"Tempo oficial (servidor)"**.
- **Legenda (00:16,3 a 00:21,6):** **No Wall Ball, um judge por atleta.** / **Liberar fecha o tempo.**
- **Nota pequena (00:20,4 a 00:21,6, 32 px):** Caiu a internet? A tela aberta guarda os toques e envia depois.
- **Som:** cliques ritmados no tempo da trilha (uma rep por tempo); um "buzz" curto no NO REP; um acorde ao liberar.

### Cena 5: Do celular ao telão · 00:22 a 00:25 (660 a 749)

- **Imagem:** o valor "1:11:31" encolhe e vira um **ponto amarelo** (40 px, com brilho). O branco da quadra escurece por baixo dele até `#090B0E` em 12 quadros.
- **Movimento:** o ponto sobe numa curva suave (trajetória em S, 45 quadros, curva do app) até o topo do quadro, onde aparece o contorno de uma TV 16:9 (linha `#2B3139`, 900 px de largura). O ponto entra na TV e a TV se expande até virar o quadro inteiro (cena 6).
- **Legenda (00:22,2 a 00:24,8):** **O servidor calcula e publica.** / **Sem chip, sem planilha.**
- **Som:** "whoosh" curto subindo.

### Cena 6: O ranking da prova · 00:25 a 00:38 (750 a 1139)

A torre do telão é vertical por natureza: no 9:16 ela vira a tela inteira.

- **Imagem:** cabeçalho "FITNESS RACE FORTALEZA" (rótulo) e **"Open Masculino · ranking da prova"** (título 56 px, 2 linhas se precisar). Abaixo, os **relógios das ondas** lado a lado, correndo: **Onda 1 42:00 · Onda 2 30:00 · Onda 3 18:00** (IBM Plex 72 px, rótulo 24 px embaixo). Selo AO VIVO à direita. A torre começa em y = 600: 8 linhas de 112 px (até y ≈ 1500). Cada linha: chip de posição, nome (Inter Bold 46 px) com o selo da onda, box (28 px apagado) e, à direita, a diferença para o 1º (IBM Plex 48 px) com o ponto embaixo (24 px): "+0:44" / "saída Sled Pull".
- **Movimento:**
  1. Em 00:25,0 a torre entra linha a linha (defasagem de 2 quadros, no máximo 16 quadros no total), cada linha subindo 30 px com a curva do app.
  2. **Momento autoral, 00:27,0:** Bruno Sampaio (O2) sobe do 2º para o 1º e Rafael Tavares (O1) desce, em 27 quadros. Seta verde em Bruno, vermelha em Rafael; o fundo da linha de Bruno ganha um degradê verde a 14% que some em 2 s. O chip do 1º vira amarelo no fim da troca. O resto da tela não se mexe.
  3. Em 00:31,5 a câmera aproxima (escala 100% → 118% em 24 quadros, curva do app) na linha de Felipe Castro (O2): a diferença **"+5:25"** em amarelo com **"saída Sled Pull · contando"**, e o número sobe a cada segundo (+5:26, +5:27…).
- **Legendas:** 00:25,4 a 00:31,0 **Todas as ondas no mesmo ranking.** / **Vale o tempo de prova de cada atleta.** · 00:32,0 a 00:37,6 **Passou do tempo do líder sem chegar ao ponto?** / **Já aparece atrás.**
- **Som:** "swish" curto na troca, alinhado ao tempo da trilha; "tic" a cada segundo do contando.

### Cena 7: Os momentos do telão · 00:38 a 00:44 (1140 a 1319)

Três cartões do telão em sequência, 2 s cada, entrando pela parte de baixo (18 quadros) e saindo para cima (9 quadros). Fundo: a torre desfocada (desfoque gaussiano 24, opacidade 35%).

1. **00:38,2 · Faixa da direção de prova:** "10:28:14 · **ENTRA NO RANKING** · Diego Martins (Onda 3) em 1º · entrada Ski Erg", em máquina de escrever (40 caracteres por segundo), rótulo "DIREÇÃO DE PROVA" inclinado.
2. **00:40,2 · Roxo:** cartão com fundo em degradê roxo, "MELHOR DA CATEGORIA · ROXO", "Ski Erg", tempo em roxo (IBM Plex 120 px) e o nome. A linha do atleta na torre ao fundo pisca roxo uma vez (degradê a 16%).
3. **00:42,2 · Novo líder:** cartão com borda amarela, "NOVO LÍDER DA PROVA", "Bruno Sampaio", "Onda 2 · CT Meireles", "Passou Rafael Tavares (Onda 1) na saída Ski Erg", "por **0:13** de tempo de prova".

- **Legenda (00:38,4 a 00:43,6, no topo da área segura, y ≈ 320):** **Quem entra, quem lidera,** / **quem faz o melhor tempo da estação.**
- **Som:** três acentos, um por cartão, no tempo da trilha.

### Cena 8: Reta final e bandeirada · 00:44 a 00:51 (1320 a 1529)

- **Imagem:** cartão "RETA FINAL · WALL BALLS": "2 · Diego Martins" com o selo O3, o contador **74/100** e a barra amarela; embaixo, **"Passa Rafael Tavares se fechar antes de 1:11:32"** com o tempo em amarelo.
- **Movimento:** 74 → 100 em 2,5 s (o contador acelera no ritmo das reps, pulsos de 4 quadros). Em 00:47,5 a **bandeirada**: uma faixa quadriculada (quadrados de 60 px, branco `#EAECEF` e `#0D1014`) desce do topo e passa em laço; entra o painel da chegada: **"2º"** gigante em amarelo (IBM Plex 380 px), "na categoria até agora", **"Diego Martins"**, "Arena Sul · Open Masculino" e o tempo final contando de 1:11:00 a **1:11:31** em 24 quadros (curva do app), com "Tempo final".
- **Legendas:** 00:44,3 a 00:47,2 **Reta final com o tempo a bater.** · 00:48,6 a 00:50,8 **1 s à frente de quem largou 24 minutos antes.**
- **Som:** cliques acelerando; na bandeirada, um acorde aberto e público ao longe (opcional).

### Cena 9: Fecho · 00:51 a 00:55 (1530 a 1649)

- **Imagem:** fundo `#090B0E`. O logo WODArena (SVG de `src/app/icon.svg`) entra no centro, com o amarelo do líder. Abaixo: **"Súmula digital + Telão ao vivo"** (Inter ExtraBold 72 px), **"Fitness Race no WODArena"** (Inter Bold 44 px, apagado) e **"wodarena.com.br"** (IBM Plex 40 px, amarelo).
- **Movimento:** o ponto amarelo da cena 5 volta, cresce e vira o logo (máscara circular de 0 a 100% em 18 quadros, curva do app). Os textos entram com 4 quadros de defasagem. Nada se mexe no último segundo.
- **Som:** batida final em 00:51,0 e silêncio em 00:54,5.

---

## 5. Textos na tela (lista final)

Use exatamente estes textos (revisados com o produto). Sentença com inicial maiúscula, sem ponto de exclamação, exceto em "LARGADA!", que é o texto do telão.

1. O resultado nasce na quadra.
2. A largada é do organizador. / Segure o botão e o relógio da onda corre.
3. O judge confere até 2 atletas na mesma tela. / Trechos, voltas e repetições, toque a toque.
4. No Wall Ball, um judge por atleta. / Liberar fecha o tempo.
5. Caiu a internet? A tela aberta guarda os toques e envia depois.
6. O servidor calcula e publica. / Sem chip, sem planilha.
7. Todas as ondas no mesmo ranking. / Vale o tempo de prova de cada atleta.
8. Passou do tempo do líder sem chegar ao ponto? / Já aparece atrás.
9. Quem entra, quem lidera, / quem faz o melhor tempo da estação.
10. Reta final com o tempo a bater.
11. 1 s à frente de quem largou 24 minutos antes.
12. Súmula digital + Telão ao vivo / Fitness Race no WODArena / wodarena.com.br

Rótulos que vêm da tela do app e não mudam: "Segure para largar", "Continue segurando…", "Largou", "+1 trecho", "+1 volta", "Na estação", "REP ✓", "Toque a cada repetição válida", "NO REP", "Segure para liberar", "Tempo na liberação", "Tempo oficial (servidor)", "ranking da prova", "Dif. para o 1º", "contando", "ENTRA NO RANKING", "MELHOR DA CATEGORIA · ROXO", "NOVO LÍDER DA PROVA", "RETA FINAL", "Passa … se fechar antes de …", "na categoria até agora", "Tempo final", "AO VIVO".

## 6. O que o vídeo não pode dizer

Tudo no vídeo tem que existir no produto hoje:

- O nome é **Fitness Race**. Não usar "HYROX" nem marcas de terceiros.
- **Sem chip:** o tempo vem da largada do organizador e das leituras dos judges.
- **Não existe desclassificação (DQ)** na súmula: caso grave vira DNF, decidido pelo organizador. Não mostrar botão de DQ (as maquetes antigas ainda têm; ignore).
- **Sem números de uso, clientes ou depoimentos**: o repositório não tem, não invente.
- **Sem previsão:** nada de chegada prevista, ritmo ou probabilidade. O "contando" e o tempo a bater usam só tempos que já aconteceram.
- **Dados do atleta:** só nome e box, como no telão. Nada de e-mail, telefone ou foto.
- **Penalidade** aparece só em segundos ("+15 s"), nunca o motivo.

---

## 7. Estrutura do projeto no After Effects

```
WODArena · Fitness Race 9x16/
├── 00 WODArena Fitness Race 9x16   (comp principal, 55 s, guias de área segura)
└── Cenas/
    ├── 01 Cinco luzes               (4 s, pórtico com as luzes já montadas pelo script)
    ├── 02 Largada do organizador    (6 s)
    ├── 03 Súmula · dois cartões     (6 s)
    ├── 04 Súmula · Wall Ball        (6 s)
    ├── 05 Do celular ao telão       (3 s)
    ├── 06 Ranking da prova          (13 s)
    ├── 07 Momentos                  (6 s)
    ├── 08 Reta final e bandeirada   (7 s)
    └── 09 Fecho                     (4 s)
```

Cada cena tem 0,5 s a mais no fim para a transição: a cena seguinte fica por cima e cobre a sobra. Os marcadores de cada pré-comp (por exemplo `luzes`, `segurar`, `troca`) são os que as expressões da seção 9 leem: mude o marcador de lugar e o movimento acompanha.

Monte as telas (painel, súmula, torre) como camadas vetoriais no After Effects, usando as maquetes HTML e as capturas da pasta `conferencia-1.118/` como referência por baixo (camada-guia). Gravação de tela só como referência: em vetor, os números ficam nítidos no celular e os relógios correm por expressão.

---

## 8. Script de montagem (ExtendScript)

Salve como `wodarena-fitness-race-9x16.jsx` e rode em **Arquivo > Scripts > Executar arquivo de script…** (After Effects 2020 ou mais novo). Ele cria as pastas, a comp principal com as guias, as nove pré-comps com fundo, legendas animadas e marcadores, e monta a cena 1 inteira (pórtico, dez lâmpadas e "LARGADA!") com as expressões já aplicadas. Tudo fica num só "Desfazer".

```javascript
// WODArena · Fitness Race · motion 9:16 (55 s, 30 qps). ExtendScript (ES3): sem let, const nem arrow.
(function () {
  var W = 1080, H = 1920, FPS = 30, TOTAL = 55, SOBRA = 0.5;
  var FONTE_TITULO = "Inter-ExtraBold", FONTE_LEGENDA = "Inter-Bold", FONTE_NUMERO = "IBMPlexSans-SemiBold";

  function cor(hex) {
    hex = hex.replace("#", "");
    return [parseInt(hex.substr(0, 2), 16) / 255, parseInt(hex.substr(2, 2), 16) / 255, parseInt(hex.substr(4, 2), 16) / 255];
  }
  function cor4(hex) { var c = cor(hex); c.push(1); return c; }

  // Curva do app, cubic-bezier(0.16, 1, 0.3, 1), em texto para as expressões.
  var BEZ = [
    "function bez(x1, y1, x2, y2, x) {",
    "  function bx(t) { return 3 * x1 * t * (1 - t) * (1 - t) + 3 * x2 * t * t * (1 - t) + t * t * t; }",
    "  function by(t) { return 3 * y1 * t * (1 - t) * (1 - t) + 3 * y2 * t * t * (1 - t) + t * t * t; }",
    "  var lo = 0, hi = 1, t = 0.5;",
    "  for (var i = 0; i < 24; i++) { t = (lo + hi) / 2; if (bx(t) < x) lo = t; else hi = t; }",
    "  return by(t);",
    "}"
  ].join("\n");

  // Legenda: entra em 0,6 s subindo 40 px com a curva do app; sai em 0,3 s.
  var EXP_LEGENDA_POS = BEZ + "\nvar a = clamp((time - inPoint) / 0.6, 0, 1);\nadd(value, [0, 40 * (1 - bez(0.16, 1, 0.3, 1, a))]);";
  var EXP_LEGENDA_OPA = BEZ + "\nvar a = clamp((time - inPoint) / 0.6, 0, 1);\nvar b = clamp((outPoint - time) / 0.3, 0, 1);\n100 * Math.min(bez(0.16, 1, 0.3, 1, a), b);";

  // Lâmpada acesa: a unidade N (número no nome da camada) acende 170 ms depois da anterior,
  // a partir do marcador "luzes", e as cinco apagam juntas 550 ms depois da última.
  var EXP_LUZ = [
    "var n = parseInt(thisLayer.name.match(/\\d+/)[0], 10);",
    "var m = thisComp.marker.key(\"luzes\").time;",
    "var acende = m + 0.17 * n;",
    "var apaga = m + 0.17 * 5 + 0.55;",
    "(time >= acende && time < apaga) ? 100 : 0;"
  ].join("\n");

  var EXP_LARGADA_OPA = "var m = thisComp.marker.key(\"largada\").time;\nvar s = thisComp.marker.key(\"legenda\").time;\ntime < m ? 0 : (time < s ? 100 : linear(time, s, s + 0.3, 100, 0));";
  var EXP_LARGADA_ESC = BEZ + "\nvar m = thisComp.marker.key(\"largada\").time;\nvar k = 125 - 25 * bez(0.16, 1, 0.3, 1, clamp((time - m) / 0.6, 0, 1));\n[k, k];";

  var CENAS = [
    { id: "01", nome: "Cinco luzes", ini: 0, dur: 4, fundo: "#090B0E", tinta: "#EAECEF",
      marcas: [["luzes", 0.5], ["largada", 1.9], ["legenda", 2.5]],
      legendas: [["O resultado nasce na quadra.", 2.5, 4.0]] },
    { id: "02", nome: "Largada do organizador", ini: 4, dur: 6, fundo: "#0B0E11", tinta: "#EAECEF",
      marcas: [["segurar", 1.5], ["largou", 2.2]],
      legendas: [["A largada é do organizador.\rSegure o botão e o relógio da onda corre.", 0.4, 5.6]] },
    { id: "03", nome: "Súmula · dois cartões", ini: 10, dur: 6, fundo: "#FFFFFF", tinta: "#0B0E11",
      marcas: [["toques", 0.8], ["penalidade", 3.6]],
      legendas: [["O judge confere até 2 atletas na mesma tela.\rTrechos, voltas e repetições, toque a toque.", 0.3, 5.7]] },
    { id: "04", nome: "Súmula · Wall Ball", ini: 16, dur: 6, fundo: "#FFFFFF", tinta: "#0B0E11",
      marcas: [["no rep", 1.2], ["segurar", 3.4], ["liberado", 4.1]],
      legendas: [["No Wall Ball, um judge por atleta.\rLiberar fecha o tempo.", 0.3, 5.6]] },
    { id: "05", nome: "Do celular ao telão", ini: 22, dur: 3, fundo: "#090B0E", tinta: "#EAECEF",
      marcas: [["ponto", 0.0], ["tv", 1.5]],
      legendas: [["O servidor calcula e publica.\rSem chip, sem planilha.", 0.2, 2.8]] },
    { id: "06", nome: "Ranking da prova", ini: 25, dur: 13, fundo: "#090B0E", tinta: "#EAECEF",
      marcas: [["torre", 0.0], ["troca", 2.0], ["contando", 6.5]],
      legendas: [["Todas as ondas no mesmo ranking.\rVale o tempo de prova de cada atleta.", 0.4, 6.0],
                 ["Passou do tempo do líder sem chegar ao ponto?\rJá aparece atrás.", 7.0, 12.6]] },
    { id: "07", nome: "Momentos", ini: 38, dur: 6, fundo: "#090B0E", tinta: "#EAECEF",
      marcas: [["entra", 0.2], ["roxo", 2.2], ["lider", 4.2]],
      legendas: [["Quem entra, quem lidera,\rquem faz o melhor tempo da estação.", 0.4, 5.6]] },
    { id: "08", nome: "Reta final e bandeirada", ini: 44, dur: 7, fundo: "#090B0E", tinta: "#EAECEF",
      marcas: [["reta", 0.2], ["bandeira", 3.5]],
      legendas: [["Reta final com o tempo a bater.", 0.3, 3.2],
                 ["1 s à frente de quem largou 24 minutos antes.", 4.6, 6.8]] },
    { id: "09", nome: "Fecho", ini: 51, dur: 4, fundo: "#090B0E", tinta: "#EAECEF",
      marcas: [["logo", 0.3]],
      legendas: [] }
  ];

  function texto(comp, conteudo, tamanho, hex, fonte, x, y, nome) {
    var camada = comp.layers.addText(conteudo);
    camada.name = nome;
    var prop = camada.property("ADBE Text Properties").property("ADBE Text Document");
    var doc = prop.value;
    doc.fontSize = tamanho;
    doc.applyFill = true;
    doc.fillColor = cor(hex);
    doc.applyStroke = false;
    doc.font = fonte;
    doc.justification = ParagraphJustification.CENTER_JUSTIFY;
    prop.setValue(doc);
    camada.property("ADBE Transform Group").property("ADBE Position").setValue([x, y]);
    return camada;
  }

  function forma(comp, nome, tipo, x, y, w, h, raio, hex) {
    var camada = comp.layers.addShape();
    camada.name = nome;
    var grupo = camada.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
    var conteudo = grupo.property("ADBE Vectors Group");
    if (tipo === "elipse") {
      conteudo.addProperty("ADBE Vector Shape - Ellipse").property("ADBE Vector Ellipse Size").setValue([w, h]);
    } else {
      var ret = conteudo.addProperty("ADBE Vector Shape - Rect");
      ret.property("ADBE Vector Rect Size").setValue([w, h]);
      ret.property("ADBE Vector Rect Roundness").setValue(raio);
    }
    conteudo.addProperty("ADBE Vector Graphic - Fill").property("ADBE Vector Fill Color").setValue(cor4(hex));
    camada.property("ADBE Transform Group").property("ADBE Position").setValue([x, y]);
    return camada;
  }

  function guia(comp, nome, x, y, w, h) {
    var camada = comp.layers.addSolid(cor("#F6465D"), nome, w, h, 1, comp.duration);
    camada.guideLayer = true;
    camada.property("ADBE Transform Group").property("ADBE Position").setValue([x, y]);
    camada.property("ADBE Transform Group").property("ADBE Opacity").setValue(25);
    return camada;
  }

  function montarLuzes(comp) {
    forma(comp, "pórtico", "ret", W / 2, 935, 960, 380, 28, "#050607");
    var y = [860, 1010];
    for (var u = 1; u <= 5; u++) {
      var x = 180 * u;
      forma(comp, "unidade " + u, "ret", x, 935, 160, 330, 20, "#0B0D10");
      for (var k = 0; k < 2; k++) {
        forma(comp, "luz " + u + " · apagada", "elipse", x, y[k], 130, 130, 0, "#3A1A1D");
        var acesa = forma(comp, "luz " + u + " · acesa", "elipse", x, y[k], 130, 130, 0, "#FF2D2D");
        acesa.property("ADBE Transform Group").property("ADBE Opacity").expression = EXP_LUZ;
        try { acesa.property("ADBE Effect Parade").addProperty("ADBE Glo2"); } catch (e) { /* sem Glow, segue */ }
      }
    }
    var largada = texto(comp, "LARGADA!", 150, "#EAECEF", FONTE_TITULO, W / 2, 1300, "LARGADA!");
    largada.property("ADBE Transform Group").property("ADBE Opacity").expression = EXP_LARGADA_OPA;
    largada.property("ADBE Transform Group").property("ADBE Scale").expression = EXP_LARGADA_ESC;
  }

  app.beginUndoGroup("WODArena Fitness Race: montar projeto");
  var projeto = app.project || app.newProject();
  var pasta = projeto.items.addFolder("WODArena · Fitness Race 9x16");
  var pastaCenas = projeto.items.addFolder("Cenas");
  pastaCenas.parentFolder = pasta;

  var principal = projeto.items.addComp("00 WODArena Fitness Race 9x16", W, H, 1, TOTAL, FPS);
  principal.parentFolder = pasta;
  principal.bgColor = cor("#090B0E");

  for (var i = 0; i < CENAS.length; i++) {
    var c = CENAS[i];
    var dur = (i === CENAS.length - 1) ? c.dur : c.dur + SOBRA;
    var cena = projeto.items.addComp(c.id + " " + c.nome, W, H, 1, dur, FPS);
    cena.parentFolder = pastaCenas;
    cena.bgColor = cor(c.fundo);
    cena.layers.addSolid(cor(c.fundo), "fundo", W, H, 1, dur);

    for (var m = 0; m < c.marcas.length; m++) {
      cena.markerProperty.setValueAtTime(c.marcas[m][1], new MarkerValue(c.marcas[m][0]));
    }
    if (c.id === "01") montarLuzes(cena);

    for (var l = 0; l < c.legendas.length; l++) {
      var leg = texto(cena, c.legendas[l][0], 54, c.tinta, FONTE_LEGENDA, W / 2, 1380, "legenda " + (l + 1));
      leg.inPoint = c.legendas[l][1];
      leg.outPoint = c.legendas[l][2];
      leg.property("ADBE Transform Group").property("ADBE Position").expression = EXP_LEGENDA_POS;
      leg.property("ADBE Transform Group").property("ADBE Opacity").expression = EXP_LEGENDA_OPA;
    }
    var titulo = texto(cena, "CENA " + c.id + " · " + c.nome.toUpperCase(), 28, "#929AA5", FONTE_TITULO, W / 2, 300, "GUIA · nome da cena");
    titulo.guideLayer = true;

    var camada = principal.layers.add(cena);
    camada.startTime = c.ini;
    principal.markerProperty.setValueAtTime(c.ini, new MarkerValue(c.id + " " + c.nome));
  }

  guia(principal, "GUIA · topo do Reels (sem texto)", W / 2, 125, W, 250);
  guia(principal, "GUIA · rodapé do Reels (sem texto)", W / 2, H - 210, W, 420);
  guia(principal, "GUIA · ícones à direita (sem texto)", W - 70, 250 + 625, 140, 1250);

  principal.openInViewer();
  app.endUndoGroup();
})();
```

Se o After Effects avisar que falta uma fonte, ele troca por outra e o script segue: instale as fontes e reabra o projeto.

---

## 9. Biblioteca de expressões

Copie a expressão na propriedade indicada (Alt/Option + clique no cronômetro). Onde a expressão lê um controle ("inicio (s)", "reps"…), adicione em **Efeito > Controles de expressão > Controle de controle deslizante** e renomeie com o nome exato.

### E0. Curva do app (função para colar no começo de outras expressões)

```javascript
// cubic-bezier do WODArena: bez(0.16, 1, 0.3, 1, x) para entradas; bez(0.7, 0, 0.84, 0, x) para saídas.
function bez(x1, y1, x2, y2, x) {
  function bx(t) { return 3 * x1 * t * (1 - t) * (1 - t) + 3 * x2 * t * t * (1 - t) + t * t * t; }
  function by(t) { return 3 * y1 * t * (1 - t) * (1 - t) + 3 * y2 * t * t * (1 - t) + t * t * t; }
  var lo = 0, hi = 1, t = 0.5;
  for (var i = 0; i < 24; i++) { t = (lo + hi) / 2; if (bx(t) < x) lo = t; else hi = t; }
  return by(t);
}
```

### E1. A curva do app entre todas as chaves

Em Posição, Escala, Opacidade, Cor ou num controle deslizante com chaves **lineares**. O tempo entre as chaves é a duração do movimento (27 quadros na torre, 18 nos cartões).

```javascript
// cole E0 aqui
var saida = false; // true para a curva de saída (mais rápida no fim)
var r = value;
if (numKeys > 1) {
  var n = nearestKey(time).index;
  if (key(n).time > time) n--;
  if (n < 1) r = key(1).value;
  else if (n >= numKeys) r = key(numKeys).value;
  else {
    var k1 = key(n), k2 = key(n + 1);
    var p = (time - k1.time) / (k2.time - k1.time);
    var e = saida ? bez(0.7, 0, 0.84, 0, p) : bez(0.16, 1, 0.3, 1, p);
    r = add(k1.value, mul(sub(k2.value, k1.value), e));
  }
}
r;
```

### E2. Relógio da onda (Texto de origem)

Controles na camada de texto: "inicio (s)" (segundos já corridos no primeiro quadro da camada, por exemplo 2520 para 42:00) e "velocidade" (1 = tempo real).

```javascript
var inicio = effect("inicio (s)")("Slider");
var vel = effect("velocidade")("Slider");
var s = Math.max(0, Math.floor(inicio + (time - inPoint) * vel));
var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
function p2(n) { return (n < 10 ? "0" : "") + n; }
h > 0 ? h + ":" + p2(m) + ":" + p2(r) : p2(m) + ":" + p2(r);
```

Para os três relógios da cena 6, use 2520, 1800 e 1080 (Onda 1, 2 e 3 às 10:42), com velocidade 1. No chip "Tempo" do Wall Ball (cena 4), use 4275 (1:11:15) com velocidade 4: o relógio chega a 1:11:31 no quadro da liberação.

### E3. Contador de reps, trechos e voltas (Texto de origem e Escala)

Controle "reps" com **chaves de espera** (Alternar espera), uma por toque, no tempo da trilha.

Texto de origem:

```javascript
Math.round(effect("reps")("Slider")).toString();
```

Escala (pulso de 4 quadros a cada nova chave):

```javascript
var s = effect("reps")("Slider");
var t0 = -1;
for (var i = 1; i <= s.numKeys; i++) if (s.key(i).time <= time) t0 = s.key(i).time;
var a = t0 < 0 ? 1 : clamp((time - t0) / 0.12, 0, 1);
var k = 108 - 8 * a;
[k, k];
```

Onda de toque (camada círculo branco a 40% por cima do botão), na Escala; na Opacidade use `60 * (1 - a)` com o mesmo cálculo de `a` e duração 0,35:

```javascript
var s = thisComp.layer("contador").effect("reps")("Slider");
var t0 = -1;
for (var i = 1; i <= s.numKeys; i++) if (s.key(i).time <= time) t0 = s.key(i).time;
var a = t0 < 0 ? 1 : clamp((time - t0) / 0.35, 0, 1);
var k = 60 + 90 * a;
[k, k];
```

### E4. Luz de largada (Opacidade)

Já vem aplicada pelo script na cena 1. A unidade sai do número no nome da camada ("luz 3 · acesa").

```javascript
var n = parseInt(thisLayer.name.match(/\d+/)[0], 10);
var m = thisComp.marker.key("luzes").time;
var acende = m + 0.17 * n;
var apaga = m + 0.17 * 5 + 0.55;
(time >= acende && time < apaga) ? 100 : 0;
```

### E5. "Segure para…" (Escala do preenchimento e Texto de origem)

O preenchimento é um retângulo do tamanho do botão, branco a 25% (preto a 25% no claro), com o **ponto de ancoragem na borda esquerda**. Escala:

```javascript
var m = thisComp.marker.key("segurar").time;
[linear(time, m, m + 0.7, 0, 100), 100];
```

Texto de origem do botão (troque "largar" por "liberar" na cena 4):

```javascript
var m = thisComp.marker.key("segurar").time;
time < m ? "Segure para largar" : (time < m + 0.7 ? "Continue segurando…" : "Largou");
```

### E6. Torre: troca de posição (Posição da linha e setas)

Cada linha é uma pré-comp com o controle "posição" (1 a 8). Aplique **E1 no próprio controle** e faça a troca com duas chaves a 27 quadros uma da outra (Bruno: 2 → 1; Rafael: 1 → 2).

Posição da linha (topo da torre em y = 600, linhas de 112 px):

```javascript
var topo = 600, alturaLinha = 112;
[value[0], topo + alturaLinha / 2 + (effect("posição")("Slider") - 1) * alturaLinha];
```

Opacidade da seta (camada filha da linha). Na seta de descer, troque `subir` para `false` e use vermelho `#F6465D`:

```javascript
var p = thisComp.layer("linha · Bruno").effect("posição")("Slider");
var subir = true;
var o = 0;
for (var i = 1; i < p.numKeys; i++) {
  var a = p.key(i), b = p.key(i + 1);
  var mudou = subir ? b.value < a.value : b.value > a.value;
  if (mudou && time >= a.time && time < b.time + 2) o = time > b.time + 1.7 ? linear(time, b.time + 1.7, b.time + 2, 100, 0) : 100;
}
o;
```

Use a mesma expressão na Opacidade do degradê verde do fundo da linha (14%).

### E7. Diferença "contando" (Texto de origem)

O relógio do atleta menos o tempo do 1º no ponto que ele ainda não alcançou. Para Felipe às 10:42: relógio da Onda 2 em 1800 s, base 1475 s (os 24:35 do Bruno na saída do Sled Pull).

```javascript
var inicio = 1800, base = 1475, vel = 1;
var g = Math.max(0, Math.round(inicio + (time - inPoint) * vel - base));
var m = Math.floor(g / 60), s = g % 60;
"+" + m + ":" + (s < 10 ? "0" : "") + s;
```

### E8. Roxo de melhor estação (Cor do preenchimento e Opacidade)

Cor do preenchimento do texto do tempo ou do contorno do cartão, a partir do marcador `roxo`, por 1,8 s:

```javascript
var m = thisComp.marker.key("roxo").time;
(time >= m && time < m + 1.8) ? hexToRgb("#B47CFF") : value;
```

Opacidade do degradê roxo da linha na torre (16%), uma piscada só:

```javascript
var m = thisComp.marker.key("roxo").time;
time < m ? 0 : linear(time, m + 0.6, m + 1.8, 100, 0);
```

### E9. Bandeirada (Ponto de ancoragem do efeito Tabuleiro de xadrez)

Efeito **Gerar > Tabuleiro de xadrez** numa camada sólida de 1080 × 120 px, largura 60, cores `#EAECEF` e `#0D1014`. No **Ponto de ancoragem** do efeito:

```javascript
var periodo = 1.2, passo = 120; // 120 px a cada 1,2 s, em laço, como no telão
[((time - inPoint) / periodo * passo) % passo, value[1]];
```

### E10. Faixa da direção de prova (Texto de origem)

Máquina de escrever a 40 caracteres por segundo:

```javascript
var cps = 40;
value.substr(0, Math.max(0, Math.floor((time - inPoint) * cps)));
```

### E11. Ponto amarelo seguindo a trajetória (Posição)

Desenhe a trajetória como caminho numa camada de forma chamada "trajetória" (grupo "Trilha", caminho "Path 1"). Controle "progresso" (0 a 100) com E1 aplicado, chaves a 45 quadros uma da outra.

```javascript
var camada = thisComp.layer("trajetória");
var caminho = camada.content("Trilha").content("Path 1").path;
var p = clamp(effect("progresso")("Slider") / 100, 0, 1);
camada.toComp(caminho.pointOnPath(p));
```

### E12. Tempo final contando até o resultado (Texto de origem)

Controle "segundos" com E1 aplicado: chave em 4260 (1:11:00) e, 24 quadros depois, em 4291 (1:11:31).

```javascript
var s = Math.round(effect("segundos")("Slider"));
var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
function p2(n) { return (n < 10 ? "0" : "") + n; }
h + ":" + p2(m) + ":" + p2(r);
```

### E13. Entrada em sequência das linhas da torre (Posição e Opacidade)

Na pré-comp da torre, a linha N (número no nome, "linha 1"…"linha 8") entra 2 quadros depois da anterior, subindo 30 px em 18 quadros; o total fica em 16 quadros de defasagem.

```javascript
// cole E0 aqui (Posição)
var n = parseInt(thisLayer.name.match(/\d+/)[0], 10);
var t0 = thisComp.marker.key("torre").time + (n - 1) * (2 * thisComp.frameDuration);
var a = clamp((time - t0) / 0.6, 0, 1);
add(value, [0, 30 * (1 - bez(0.16, 1, 0.3, 1, a))]);
```

Na Opacidade, a mesma conta com `100 * bez(0.16, 1, 0.3, 1, a)`.

---

## 10. Som

- **Trilha:** eletrônica de 120 BPM, sem voz, com a batida entrando no apagar das luzes (00:01,9) e um corte seco em 00:54,5. Licença livre para Reels.
- **Efeitos:** 5 bips graves (luzes) e 1 agudo (apagar); clique ao pousar o dedo e "tic" ao encher os botões "Segure"; clique seco a cada toque de rep, trecho e volta; "buzz" curto no NO REP; "whoosh" na subida do ponto amarelo; "swish" na troca de posição; um acento por cartão na cena 7; acorde aberto na bandeirada; batida final no logo.
- **Mixagem:** trilha em −14 LUFS integrados; efeitos 3 a 6 dB acima da trilha no instante; nada acima de −1 dBTP.

## 11. Acessibilidade

- **Sem piscar rápido:** nada pisca mais de 3 vezes por segundo. As luzes acendem em sequência (não piscam), o NO REP pisca uma vez e o roxo pisca uma vez.
- **Leitura:** cada legenda fica pelo menos 2,5 s; no máximo 2 linhas; Inter Bold de 52 a 56 px; contraste do texto claro sobre `#090B0E` e do escuro sobre o branco acima de 7:1.
- **Sem depender de cor:** subir e descer têm seta, além do verde e do vermelho; o roxo vem com o rótulo "MELHOR DA CATEGORIA".
- **Legenda embutida:** o vídeo funciona sem som. Se usar narração, embuta a legenda dela também.

## 12. Checklist de entrega

- [ ] 55 s, 1080 × 1920, 30 qps; cortes no tempo da trilha (120 BPM)
- [ ] Nenhum texto nas faixas do Reels (camadas-guia ligadas na revisão)
- [ ] Cores e fontes da seção 2; roxo só no melhor da estação
- [ ] Textos exatamente como na seção 5; nada da seção 6 no vídeo
- [ ] Botões "Segure" enchendo em 21 quadros, linear; troca na torre em 27 quadros
- [ ] Relógios e "contando" correndo por expressão, sem pular segundo
- [ ] Revisão no celular, no brilho máximo e no mínimo, antes de publicar
- [ ] Master ProRes e entrega H.264 nas configurações da seção 1
