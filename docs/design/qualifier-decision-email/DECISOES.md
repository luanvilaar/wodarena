# E-mail da análise de resultado (Qualifier) — decisões aprovadas

Aprovado pelo Luan em 2026-11-01. Modelo visual: [modelo-aprovado.html](modelo-aprovado.html) (artefato https://claude.ai/artifact/KRiHM6j7xuMTE24kpoGgzS).

| # | Decisão | Escolha |
|---|---------|---------|
| D1 | Avisar também quando a decisão é "Validado" | Sim, mesmo sem observação |
| D2 | Nome de quem analisou | Não aparece; o e-mail diz "a arbitragem" (judge) ou "a organização" (gestor/owner) |
| D3 | Decisões já tomadas sem aviso (366 no Qualifier SELVA 2027, 187 atletas, leitura de 2026-11-01) | Lote retroativo aprovado pelo Luan em 2026-11-01: um e-mail por decisão, com a decisão atual, só decisões anteriores ao deploy |
| D4 | Idioma | O da inscrição (pt-BR, pt-PT, en-GB), pt-BR quando vazio |
| D5 | Solução | B (aviso em toda decisão, modelo único) + C (área do atleta mostra a decisão) |
| D6 | Assunto do ajuste | "Resultado ajustado" (o modelo dizia "pela arbitragem", errado quando quem ajusta é a organização; corrigido na implementação em 2026-11-01) |

Variantes: Validado, Penalizado (−15%), Rejeitado, Ajustado, Alterado pela organização, Lançado pela organização, Novo envio solicitado.

Estrutura: assunto com a decisão na frente · selo (texto + cor) · quadro "enviado → oficial" · observação (só quando há texto) · próximo passo · botão (ranking quando validado, área do atleta nos demais).
