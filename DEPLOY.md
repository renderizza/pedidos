# Deploy: Vercel + Supabase

O app roda na **Vercel** e o banco (PostgreSQL) fica no **Supabase**. O Supabase é usado só como
PostgreSQL: o app fala com ele direto pelo `pg`/Drizzle, **sem** `supabase-js` e **sem** chaves
`anon`/`service_role`. Não cadastre nenhuma variável `NEXT_PUBLIC_SUPABASE_*`.

## Variáveis de ambiente

| Variável | Onde | Obrigatória | O que é |
|---|---|---|---|
| `DATABASE_URL` | Vercel | sim | **Transaction pooler** do Supabase (porta `6543`). É o que o app usa. |
| `WHATSAPP_ORDERS_NUMBER` | Vercel | não | Número que recebe os pedidos (só dígitos, com DDI+DDD). Em branco, o WhatsApp abre para escolher o contato. |
| `DIRECT_URL` | sua máquina | só para migrar | **Session pooler** (porta `5432`), usada apenas por `npm run db:migrate`. Não vai para a Vercel. |
| `DATABASE_SSL_CA` | Vercel | não | Certificado da CA do Supabase, para o app **validar** o servidor (veja [TLS](#tls)). |

Formato das URLs (copie os valores prontos do botão **Connect** do projeto no Supabase):

```
postgresql://postgres.<ref-do-projeto>:<senha>@<host-do-pooler>:6543/postgres   # DATABASE_URL (transaction)
postgresql://postgres.<ref-do-projeto>:<senha>@<host-do-pooler>:5432/postgres   # DIRECT_URL   (session)
```

- O usuário do pooler é `postgres.<ref-do-projeto>` (não só `postgres`).
- Se a senha tiver caracteres especiais, codifique-os na URL (`@` → `%40`, `/` → `%2F`, `#` → `%23`)
  ou troque a senha do banco por uma só com letras e números.
- Por que duas URLs: o pooler em modo transação (6543) é o indicado para o app serverless, mas não para
  alterar o schema. A conexão direta (`db.<ref>.supabase.co`) só tem IPv6 por padrão; o *session pooler*
  funciona em redes só com IPv4.

## Passo a passo

### 1. Criar o projeto no Supabase

1. Crie o projeto e anote a **senha do banco**.
2. Escolha a região mais próxima de quem vai usar o sistema (ex.: São Paulo). A função da Vercel deve ficar
   na mesma região (passo 4).

### 2. Criar as tabelas (migrações)

Na sua máquina, na pasta do projeto (`npm install` já feito):

```bash
DIRECT_URL='<session pooler, porta 5432>' npm run db:migrate
```

Isso cria as 9 tabelas e **liga o RLS** em todas (veja [RLS](#rls)). Pode rodar de novo: só aplica o que falta.

### 3. Criar o primeiro administrador

O `db:seed` não roda em produção (ele cria usuários de teste com senhas conhecidas). Crie o admin real:

```bash
read -rs ADMIN_PASSWORD && export ADMIN_PASSWORD   # digita a senha sem ela aparecer (bash/zsh)
DATABASE_URL='<transaction pooler, porta 6543>' \
ADMIN_NAME='Seu Nome' ADMIN_EMAIL='voce@empresa.com' \
npm run db:create-admin
```

O script mostra em qual banco vai gravar antes de criar. A senha precisa ter de 8 a 128 caracteres. Rodar de
novo com o mesmo e-mail não altera nada. Os demais usuários e o catálogo são cadastrados pelo painel `/admin`.

### 4. Publicar na Vercel

1. Suba o repositório para o GitHub/GitLab/Bitbucket e importe-o em **Add New → Project** na Vercel.
   O framework (Next.js) é detectado sozinho; o `vercel.json` só fixa o `npm ci` como instalação.
2. Em **Settings → Environment Variables**, cadastre `DATABASE_URL` (e, se quiser, `WHATSAPP_ORDERS_NUMBER`)
   para o ambiente **Production**.
3. Em **Settings → Functions**, ajuste a **Function Region** para a região do Supabase.
4. Faça o deploy.

> **Preview deployments:** não marque `DATABASE_URL` para *Preview* com o banco de produção, senão cada branch
> grava nos dados reais. Use outro projeto Supabase para Preview ou deixe a variável só em Production
> (o build não precisa do banco; só as páginas, ao rodar).

### 5. Conferir

- `https://<seu-dominio>/api/health` deve responder `{"status":"ok","database":"up",...}`.
  Se vier `503`, o app não alcança o banco: veja [Problemas comuns](#problemas-comuns).
- Entre em `/login` com o admin criado no passo 3.

## Mudanças no schema depois do primeiro deploy

```bash
npm run db:generate                                   # gera a migração a partir de src/db/schema.ts
git add drizzle && git commit                         # a migração vai junto com o código
DIRECT_URL='<session pooler>' npm run db:migrate      # aplica no Supabase ANTES de publicar o código novo
```

As migrações **não** rodam no build da Vercel de propósito: um deploy de Preview ou um build repetido não deve
alterar o banco de produção sozinho. Prefira mudanças compatíveis com o código antigo (adicionar coluna, não
renomear) para que o intervalo entre migrar e publicar não derrube o app.

## <a id="rls"></a>RLS (segurança das tabelas)

No Supabase, as tabelas do schema `public` ficam expostas por uma API REST (Data API) aos papéis `anon` e
`authenticated`. Como as tabelas aqui guardam e-mails e hashes de senha, **todas** têm RLS ligado e **nenhuma**
política: a API não lê nem grava nada. O app não é afetado, pois conecta com o papel `postgres`, que ignora o RLS.

Ao criar uma tabela nova em `src/db/schema.ts`, termine com `.enableRLS()` (há um comentário no topo do arquivo).
Se um dia você quiser usar `supabase-js` no navegador, será preciso escrever políticas explícitas.

## <a id="tls"></a>TLS

Para hosts remotos o app sempre usa TLS. Por padrão a cadeia do certificado **não é validada** (é o modo que o
Supabase documenta para o `pg`): o tráfego vai criptografado, mas não há proteção contra um servidor falso.
Para validar, baixe o certificado da CA em **Database Settings → SSL Configuration** no Supabase e cole o
conteúdo (PEM) em `DATABASE_SSL_CA` na Vercel. Se a conexão passar a falhar com a variável definida, remova-a.

O `?sslmode=` da URL é lido só para `disable` (sem TLS) e `require` (TLS); o `pg` trataria `require` como
validação completa e recusaria o certificado do Supabase, por isso o TLS é decidido pelo código
(`src/db/connection.ts`). Banco em `localhost` (o Docker local) não usa TLS.

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| `Tenant or user not found` | Usuário sem o sufixo do projeto: no pooler é `postgres.<ref-do-projeto>`. Confira também a região/host copiados do painel. |
| `password authentication failed` | Senha errada, ou com caractere especial sem codificar na URL. |
| Timeout ou `ENETUNREACH` ao migrar | Você usou a conexão direta (`db.<ref>.supabase.co`, só IPv6). Use o *session pooler*. |
| `timeout exceeded when trying to connect` | Projeto pausado (planos gratuitos pausam por inatividade; retome no painel) ou URL/porta errada. O app desiste após 10 s. |
| `self-signed certificate in certificate chain` | Só com `DATABASE_SSL_CA` definida com a CA errada: remova a variável. |
| `/api/health` responde 503 | Veja os logs da função em **Logs** na Vercel: a mensagem do driver diz o motivo. |
| Erro de `DATABASE_URL` ao abrir uma página | A variável não está cadastrada para o ambiente (Production/Preview) daquele deploy. |
