# Plano de Implementacao - Formulario de Interesse Comercial (WODArena)

> **Status:** Documento funcional para leitura, analise e aprovacao.
> **NAO implementar** nada com base neste documento ate aprovacao explicita.
>
> **Data:** 2026-06-20
> **Escopo:** Criar uma captacao de interesse comercial na homepage do WODArena para identificar gestores de eventos interessados em utilizar a plataforma, com foco inicial em organizadores de Functional Fitness e Fitness Race.

---

## 1. Objetivo

Criar um formulario de captacao de leads dentro da homepage do WODArena para identificar gestores de eventos interessados em utilizar a plataforma.

A acao tera carater promocional, destacando que os primeiros gestores cadastrados poderao utilizar a plataforma gratuitamente durante o periodo inicial da campanha.

**Importante:** nenhuma implementacao devera ser iniciada antes da aprovacao deste documento.

---

## 2. Contexto da acao

Na pagina inicial do WODArena sera exibida uma secao de marketing com o objetivo de gerar interesse de organizadores de eventos de Functional Fitness e Fitness Race.

### Mensagem principal

**"Seja um dos primeiros gestores a utilizar o WODArena."**

Os primeiros eventos cadastrados terao acesso gratuito a plataforma durante o periodo promocional.

### Objetivo da campanha

- Gerar novos contatos comerciais.
- Identificar potenciais clientes.
- Construir uma base de gestores interessados.
- Facilitar o contato da equipe comercial do WODArena.
- Registrar esses potenciais clientes no painel de controle do proprietario.

### Recomendacao de UX

Para reduzir friccao e manter continuidade com a home atual, a campanha deve viver como uma secao dedicada dentro da homepage, sem redirecionar o gestor para outra pagina no primeiro momento.

---

## 3. Estrutura da secao comercial

### Conteudo minimo esperado

- Titulo promocional com a mensagem principal da campanha.
- Texto curto explicando o beneficio da adesao antecipada.
- Botao principal com o CTA:

**"Quero utilizar o WODArena"**

- Formulario exibido apos a interacao do usuario.
- Mensagem curta de privacidade e links para os termos da plataforma.

### Texto de apoio recomendado

"Cadastre seu interesse para apresentar seu evento no WODArena e conversar com nossa equipe sobre a fase promocional para os primeiros gestores."

---

## 4. Formulario de interesse

O formulario devera ser preenchido diretamente na homepage.

### Campos obrigatorios

#### Dados do gestor

- Nome do gestor
- Telefone de contato

#### Dados do evento

- Nome do evento
- Cidade
- Estado (UF)

### Dados minimos enviados ao backend

- `managerName`
- `phone`
- `eventName`
- `city`
- `state`
- `leadStatus` = `new`
- `acceptedTerms`
- `acceptedAt`
- `submittedAt`
- `source` = `homepage-commercial-interest`
- `ownerEmailNotificationStatus`
- `ownerEmailNotifiedAt`

---

## 5. Fluxo do usuario

### Etapa 1

O gestor acessa a homepage e visualiza a campanha promocional.

### Etapa 2

O gestor clica no botao:

**"Quero utilizar o WODArena"**

### Etapa 3

O formulario e exibido para preenchimento.

### Etapa 4

O gestor preenche os dados obrigatorios e confirma o aceite de termos e privacidade.

### Etapa 5

Apos o envio dos dados:

1. Os dados sao validados.
2. O aceite e registrado para fins de auditoria.
3. O lead e persistido e vinculado ao painel de controle do proprietario.
4. Um e-mail e enviado automaticamente para o proprietario da plataforma.
5. O status do envio do e-mail fica registrado no mesmo lead.
6. O gestor recebe uma mensagem de confirmacao na tela.

---

## 6. Registro no painel do proprietario

O e-mail nao deve ser o unico destino das informacoes.

Cada formulario enviado deve gerar um registro persistente no painel de controle do proprietario, para que os possiveis clientes fiquem acessiveis mesmo que o e-mail nao seja consultado no momento ou apresente falha de entrega.

### Recomendacao de UX no painel

Criar uma nova aba ou secao dedicada em `/owner`, com nomenclatura objetiva, por exemplo:

- `Leads`
- `Interessados`
- `Leads Comerciais`

### Conteudo minimo da listagem

- Nome do gestor
- Telefone
- Nome do evento
- Cidade
- Estado (UF)
- Data/hora do cadastro
- Origem do lead
- Status do lead
- Status do envio do e-mail ao proprietario
- Data/hora do envio do e-mail

### Estado inicial recomendado

Todo novo lead entra com status:

- `new`

### Status operacionais recomendados para evolucao

- `new`
- `contacted`
- `qualified`
- `discarded`

No MVP, apenas `new` e obrigatorio. Os demais podem entrar como backlog posterior, desde que o plano ja deixe a estrutura preparada.

### Regra funcional obrigatoria

O lead deve aparecer no painel do proprietario **mesmo se o envio de e-mail falhar**.

Nesse caso:

- o cadastro continua salvo;
- o status do e-mail deve ficar como falha;
- a equipe pode consultar manualmente os dados no painel e reprocessar o contato depois.

---

## 7. Estrutura do e-mail recebido

### Assunto

Novo gestor interessado no WODArena

### Conteudo

Nome do Gestor:
[Nome informado]

Telefone:
[Telefone informado]

Nome do Evento:
[Nome informado]

Cidade:
[Cidade informada]

Estado:
[Estado informado]

Aceite de Termos e Privacidade:
Sim

Data/Hora do Aceite:
[Data automatica do sistema]

Data/Hora do Cadastro:
[Data automatica do sistema]

---

## 8. Mensagem de confirmacao ao gestor

### Titulo

Solicitacao enviada com sucesso!

### Mensagem

Obrigado pelo seu interesse no WODArena.

Recebemos suas informacoes e, em breve, um de nossos agentes entrara em contato para apresentar a plataforma e esclarecer qualquer duvida.

Fique atento ao seu telefone e aos canais de contato informados no cadastro.

---

## 9. Privacidade e consentimento

Esta secao passa a ser obrigatoria no plano.

### 9.1 Mensagem de privacidade

O formulario deve exibir, proximo ao envio, uma mensagem curta informando a finalidade da coleta.

### Texto recomendado

"Usaremos seus dados para registrar seu interesse no WODArena e permitir que nossa equipe entre em contato sobre a plataforma. Leia nossos Termos de Uso e Politica de Privacidade."

### Destino dos links

- `/termos`
- `/termos#privacidade`

Os links acima ja existem no produto e devem ser reutilizados para manter consistencia juridica e editorial.

### 9.2 Aceite obrigatorio

O envio do formulario so pode acontecer apos um aceite explicito do usuario.

### Texto recomendado do checkbox obrigatorio

"Li e concordo com os Termos de Uso e com a Politica de Privacidade da WODArena, e autorizo o contato da equipe comercial sobre esta solicitacao."

### 9.3 Separacao entre aceite e marketing futuro

Se no futuro houver interesse em enviar campanhas, novidades ou automacoes comerciais recorrentes, isso deve usar um **segundo checkbox opcional**, separado do aceite obrigatorio deste formulario.

O aceite obrigatorio deste fluxo deve cobrir apenas:

- envio da solicitacao;
- tratamento dos dados informados para retorno comercial;
- contato da equipe WODArena sobre o interesse registrado.

### 9.4 Auditoria do consentimento

Para fins de rastreabilidade, o backend deve registrar pelo menos:

- status do aceite (`true`);
- data/hora do aceite;
- origem do envio (`homepage-commercial-interest`);
- referencia textual ou versao do termo/politica vigente no momento do envio.

---

## 10. Requisitos tecnicos

### Frontend

- Formulario responsivo.
- Compativel com desktop e dispositivos moveis.
- Validacao de campos obrigatorios.
- Feedback visual de envio em andamento.
- Feedback claro quando o envio falhar.
- Mensagem de privacidade visivel antes da submissao.
- Checkbox obrigatorio de aceite antes do CTA final.
- Painel do proprietario com area dedicada para visualizar os leads capturados.
- Exibicao do status do lead e do status de envio do e-mail.

### Backend

- Endpoint dedicado para recebimento do formulario.
- Validacao dos dados recebidos.
- Persistencia dos leads em armazenamento consultavel pelo proprietario.
- Registro do aceite de termos e privacidade.
- Disparo automatico de e-mail para o proprietario da plataforma.
- Registro do resultado do envio de e-mail vinculado ao lead.
- Endpoint ou carga de dados para listar esses leads no painel `/owner`.
- Registro de logs para auditoria.

### Seguranca

- Sanitizacao dos campos.
- Protecao contra spam.
- Limitacao basica de envios repetidos.
- Nao aceitar submissao sem o aceite obrigatorio.

### Observabilidade

- Logar sucesso e falha de envio.
- Logar falhas no disparo de e-mail.
- Permitir rastrear quando um lead foi capturado e por qual origem.
- Permitir rastrear se o lead foi registrado no painel e se o e-mail foi realmente disparado.

---

## 11. Recomendacoes de implementacao futura

Itens validos para backlog posterior, sem fazer parte do MVP desta campanha:

- Integracao com CRM.
- Notificacao por WhatsApp.
- Dashboard administrativo para acompanhamento dos interessados.
- Sequencia automatica de e-mails de apresentacao da plataforma.
- Opt-in adicional para comunicacoes comerciais recorrentes.
- Reenvio manual de notificacao por e-mail a partir do painel do proprietario.
- Mudanca manual de status comercial do lead no painel do proprietario.

---

## 12. Criterios de aprovacao do documento

Antes de qualquer implementacao, este plano deve estar aprovado quanto a:

- mensagem comercial da campanha;
- campos obrigatorios do formulario;
- estrategia de persistencia dos leads no painel do proprietario;
- texto da confirmacao ao gestor;
- conteudo do e-mail interno;
- regra de registro do status do e-mail no painel;
- mensagem de privacidade;
- texto do aceite obrigatorio;
- destino dos links de termos e privacidade;
- regra de registro do consentimento.

---

## 13. Referencias atuais do produto

Pontos do produto que ja existem e podem ser reutilizados na futura implementacao:

- Pagina publica de termos: `src/app/termos/page.tsx`
- Secao publica de privacidade: `src/app/termos/page.tsx#privacidade`
- Links institucionais no footer: `src/components/Footer.tsx`
- Padrao atual de checkbox de aceite: `src/components/RegisterModal.tsx`

---

## 14. Status

⏳ Documento em analise.

Nenhuma implementacao devera ser iniciada ate a aprovacao deste plano.
