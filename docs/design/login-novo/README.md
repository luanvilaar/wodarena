# Nova tela de login: decisões aprovadas

Proposta **C** aprovada pelo usuário em 2026-10-30. A maquete é [login-novo-aprovado.html](login-novo-aprovado.html), a cópia da página como foi aprovada (opções A, B e C clicáveis, comparação e pontos de decisão). A referência visual enviada é [referencia-bem-vindo.png](referencia-bem-vindo.png). A Story 1.92 cita esta pasta nos critérios de aceite.

## O pedido

Uma nova área de login a partir da referência "Bem-vindo · Como você deseja acessar?" (painel escuro, ícones quadrados de destaque, títulos condensados em caixa alta). Foram propostas três formas; só frontend.

## Decisão

**C: um login só, a área vem da conta.** E-mail e senha, e o app abre a área da conta. As três áreas da referência (administrativa, judge e atleta) aparecem ao lado, só como informação, sem clique. É como o login já funciona por trás: `login()` devolve a conta e o painel decide a tela pelo papel (gestor e atleta ficam em `/admin`; judge é enviado para `/judge`).

## Como ficou (e o que a maquete não mostrava)

- **Cor de destaque:** o amarelo do app (`--primary`), não o verde-limão da referência. O app inteiro usa o amarelo (`src/app/globals.css`, [desinger-novo.md](../desinger-novo.md)); trocar só o login deixaria a tela diferente do resto. A troca é um token (`primary`) no componente, se for decidido o contrário.
- **Tipografia:** títulos e nomes de área em Anton, como na referência e na maquete. É a única fonte nova e só carrega nesta tela (`src/components/admin/loginFont.ts`).
- **Sai da tela:** o vídeo do hero e a chamada "CONECTE. COMPITA. CONQUISTE." com a lista de benefícios, que não existiam na referência nem na maquete aprovada. O logotipo dentro do painel também não repete: a Navbar já mostra a marca. O arquivo `public/hero-vertical.mp4` continua no projeto (a home usa o mesmo vídeo).
- **Recuperar e redefinir senha** seguem no mesmo painel, com o mesmo bloco de áreas ao lado.
- **Avisos com tom:** o aviso de "link de recuperação enviado" e o de "senha redefinida" passam a aparecer como sucesso (antes apareciam em vermelho, como erro).
- **Botão com estado:** "Entrando…" e bloqueio de duplo clique durante o login.
- **Mostrar/ocultar senha** nos campos de senha.
- **"Lembrar meu e-mail"** no lugar de "Manter conectado" da maquete: o app só grava o e-mail (a sessão dura 12 h de qualquer jeito), então o rótulo agora diz o que a caixa faz e a tela lê o e-mail gravado.

## Fora de escopo

Banco, migrations, API, autenticação (o `login()` e as rotas `/api/auth/*` não mudam), o painel do gestor e do atleta depois do login, a rota `/owner`.
