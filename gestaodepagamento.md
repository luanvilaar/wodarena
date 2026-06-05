Implemente no WodArena a integração Mercado Pago Marketplace via OAuth.

Contexto:
Hoje o sistema já possui integração básica com Mercado Pago usando public key e access token da conta principal da plataforma. Agora precisamos transformar isso em modelo marketplace, onde cada gestor de evento conecta sua própria conta Mercado Pago ao WodArena.

Objetivo:
Permitir que o gestor autorize o WodArena via OAuth, salvar os dados da conta conectada e usar o access_token do gestor para criar pagamentos das inscrições. A plataforma WodArena deverá cobrar automaticamente uma comissão usando marketplace_fee.

Fluxo desejado:

Criar uma página no painel do gestor chamada “Configurações de Pagamento”.
Exibir um botão:
“Conectar Mercado Pago”
Ao clicar, redirecionar o gestor para a URL OAuth do Mercado Pago com:
client_id da aplicação WodArena
redirect_uri configurado no painel Mercado Pago Developers
response_type=code
state com o ID do gestor ou token seguro temporário
Após autorização, o Mercado Pago deve redirecionar para:
/api/mercadopago/oauth/callback
No callback:
receber o parâmetro code
validar o state
trocar o code por access_token e refresh_token
salvar no banco de dados vinculado ao gestor:
mercadopago_user_id
access_token
refresh_token
public_key
expires_at
status: connected
No painel do gestor, mostrar:
Mercado Pago conectado
ID da conta conectada
botão para desconectar
botão para reconectar caso o token expire
Na criação de uma inscrição:
identificar o evento
identificar o gestor dono do evento
buscar o access_token Mercado Pago desse gestor
criar a preferência de pagamento usando esse access_token
adicionar marketplace_fee com a comissão do WodArena

Exemplo:
Inscrição: R$ 150
Comissão WodArena: R$ 10
marketplace_fee: 10

Criar endpoint:
POST /api/events//checkout

Esse endpoint deve:

validar inscrição
buscar dados do evento
buscar Mercado Pago conectado do gestor
criar preference no Mercado Pago
retornar init_point para redirecionar o atleta ao checkout
Criar webhook:
POST /api/mercadopago/webhook

Esse webhook deve:

receber notificações de pagamento
consultar o pagamento no Mercado Pago
atualizar status da inscrição:
pending
approved
rejected
refunded
cancelled
Regras importantes:
Não salvar access_token no frontend.
Toda criação de pagamento deve acontecer no backend.
O access_token usado no pagamento deve ser o do gestor conectado, não o da conta principal do WodArena.
A comissão do WodArena deve ser configurável por evento ou globalmente.
Caso o gestor não tenha Mercado Pago conectado, bloquear a publicação do evento ou impedir pagamento online.

Criar uma implementação limpa, segura e escalável para Next.js/React com backend API, usando variáveis de ambiente:

MERCADOPAGO_CLIENT_ID
MERCADOPAGO_CLIENT_SECRET
MERCADOPAGO_REDIRECT_URI
WODARENA_MARKETPLACE_FEE_DEFAULT

Criar também a estrutura de banco necessária para armazenar as contas conectadas dos gestores.