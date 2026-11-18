# Bandeira do estado no leaderboard

Maquete aprovada em 18/11/2026: [maquete.html](maquete.html) (página única, abre no navegador, com as 27 bandeiras reais e os desenhos de desktop, celular, perfil e casos de borda).

Stories: 1.153 (ativos e regra), 1.154 (campo no cadastro e servidor) e 1.155 (leaderboard e perfil).

## Origem das bandeiras

Repositório `pierrelapalu/icones-bandeiras-br-uf`, pasta `dist/rounded/svg`, commit `ed47411`. Licença CC0 (uso livre). As 27 cópias ficam em `public/flags/br/<uf>.svg`, sem alteração, com `public/flags/NOTICE`.

Os SVGs usam classes de CSS globais (`.cls-1`...). Entram sempre por `<img>`, nunca inline.

## Decisões aprovadas (D1 a D6, opções recomendadas)

| # | Decisão |
|---|---------|
| D1 | Reaproveitar `athletes.state`. O campo passa a se chamar "Estado de nascimento (UF)". Sem coluna nova e sem migration. |
| D2 | O Functional Fitness e o Qualifier passam a pedir o estado, opcional. No Fitness Race segue obrigatório, como era. |
| D3 | Desktop: bandeira de 24 × 16 px antes do nome, com a sigla depois do país ("BR · CE"). Celular: bandeira de 18 × 12 px sob o número da colocação. |
| D4 | Equipe (dupla e trio) não mostra bandeira: o estado salvo é o do primeiro participante. |
| D5 | Ceará, Espírito Santo e Paraíba usam a v1 (a da folha de exemplos do autor). |
| D6 | O estado continua público. Aviso no formulário, frase na política de privacidade (item C) e `PRODUCT.md` atualizado. Sem chave "mostrar minha bandeira". |

## Regras que a maquete mostra

- A faixa da bandeira no desktop (24 px) só existe quando alguém da categoria tem bandeira. Quem não tem fica com a faixa vazia e o nome segue alinhado.
- Sem UF válida: sem bandeira e sem aviso de erro. Vale para "XX", "BR", "C" e texto livre.
- País diferente de BR (atleta ou evento): sem bandeira. PA, MA, AL, SC e MT existem no Brasil e nos EUA.
- Medidas do leaderboard intactas: linhas de 64 px (desktop) e 56 px (celular), colocação em número simples, nenhum `rounded-full` na célula.

## Decisão que a maquete não cobria

Evento fora do Brasil (`country_code` PT ou GB): o campo continua texto livre ("Distrito") e nunca vira bandeira, porque o atleta é gravado com país `BR` em qualquer evento e a sigla de um distrito poderia virar o estado errado.
