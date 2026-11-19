# Sistema de Pedidos

Next.js (App Router) + Drizzle ORM + PostgreSQL (Docker) + Tailwind CSS + Zod.
Desenvolvimento por fases — veja `pedidos.md`.

## Como rodar

```bash
npm install
cp .env.example .env        # já existe localmente; ajuste se necessário
npm run db:up               # sobe o PostgreSQL (porta 5433 no host)
npm run db:migrate          # aplica as migrações no banco de desenvolvimento
npm run db:seed             # cria 1 usuário por perfil (somente desenvolvimento)
npm run db:seed:catalog     # (opcional) categorias, produtos de cosméticos/beleza e pedidos de exemplo
npm run dev                 # http://localhost:3000
```

### Usuários de desenvolvimento (`npm run db:seed`)

| Perfil    | E-mail                    | Senha            | Após o login |
|-----------|---------------------------|------------------|--------------|
| ADMIN     | admin@pedidos.local       | admin12345       | `/admin`     |
| CONSULTOR | consultor@pedidos.local   | consultor12345   | `/`          |
| CLIENTE   | cliente@pedidos.local     | cliente12345     | `/`          |

## Vitrine e tabela de pedido

| Rota | O que faz |
|---|---|
| `/` | Vitrine pública: produtos **ativos** em cartões, com busca, filtro por categoria e paginação (12 por página). Todos — inclusive visitantes sem login — veem "Adicionar ao pedido" em cada cartão |
| `/pedidos/novo` | Tabela interativa para montar o pedido (**não exige login**: visitantes e os 3 perfis podem) |

- **Sem carrinho:** o pedido é montado direto numa tabela com **Referência, Descrição do Produto, Valor Unitário, Quantidade e Valor Total**. Produtos entram pelo campo de busca (referência ou descrição, sem diferenciar acentos) ou pelo botão da vitrine.
- **Cálculo automático** do total de cada linha e do total geral, em centavos inteiros (`src/lib/orders/calculation.ts`). Quantidade válida: inteiro de 1 a 9999; total máximo do pedido: R$ 21.474.836,47 (limite da coluna no banco).
- **Rascunho no banco** (`order_drafts` / `order_draft_items`) para quem está logado: salvo automaticamente (debounce de 600 ms, sem gravações em paralelo), um por usuário, acompanha o usuário entre dispositivos. O **visitante** (sem login) guarda o rascunho no próprio navegador (`localStorage`). Guarda só produto + quantidade — o preço mostrado vem sempre do cadastro atual. Produto desativado sai da tabela com aviso.
- O rascunho **não é um pedido**: não aparece em `orders`. A Fase 5 o converte em pedido final ao finalizar.

## Finalizar pedido, histórico e WhatsApp

| Rota | O que faz |
|---|---|
| `/pedidos/novo` | Além da tabela, o bloco **Dados do pedido** (cliente, telefone e observações) e o botão **Finalizar pedido**. Para o **CONSULTOR** não há bloco de dados: só o botão (veja "Pedido do consultor") |
| `/pedidos` | Histórico. **ADMIN** vê todos os pedidos (com a coluna "Lançado por"); **CONSULTOR** e **CLIENTE** veem só os que lançaram. Busca por cliente ou nº, filtro por situação, paginação |
| `/pedidos/[id]` | Detalhe do pedido + mensagem do WhatsApp (link, atalho para o cliente e botão de copiar) |

- **Finalizar** converte o rascunho em pedido numa única transação: o servidor relê os itens e os **preços vigentes** do cadastro, confere o total que o usuário viu (se o preço mudou, recusa e atualiza a tela), grava o pedido com um **snapshot** de referência, descrição e preço de cada item, e apaga o rascunho. O rascunho fica travado durante a operação, então clique duplo ou duas abas geram no máximo um pedido.
- O histórico **não muda** se o catálogo mudar depois (preço, descrição, produto excluído).
- **Pedido de outra pessoa responde 404** (e não 403), para não revelar que ele existe. A regra de posse é a mesma (`canAccessOrder`) na lista e no detalhe.
- **WhatsApp:** `src/lib/whatsapp.ts` gera a mensagem (`*PEDIDO #N*`, data no fuso de São Paulo, cliente, itens `qtd x unitário = total`, total, observações). O link `wa.me` vai para o número definido em `WHATSAPP_ORDERS_NUMBER` (opcional; sem ele o WhatsApp abre para escolher o contato). Se o cliente tem telefone, há também o atalho "Enviar ao cliente".
- Fora do escopo desta fase: alterar a situação do pedido (pendente → confirmado/cancelado). Todo pedido nasce `PENDENTE`.

## Pedido do consultor (interno)

O pedido lançado por um **CONSULTOR** é interno: não há cliente nem envio por WhatsApp.

- **Tela:** em `/pedidos/novo` o consultor não vê nome, telefone nem observações; fica só o botão **Finalizar pedido**.
- **Regra no servidor, não só na tela:** `finalizeOrderAction` decide pelo perfil (`collectsCustomerData` em `src/lib/auth/rbac.ts`). Para CONSULTOR, qualquer dado de cliente enviado pela requisição é descartado e o pedido é gravado com `customer_name`, `customer_phone` e `notes` nulos (a coluna `customer_name` aceita nulo desde a migração `0005`). ADMIN, CLIENTE e visitante continuam obrigados a informar o cliente.
- **Histórico e detalhe:** a coluna "Cliente" mostra "—"; a página do pedido não mostra Cliente/Telefone nem a seção "Enviar pelo WhatsApp". A regra é pelo dado: **só pedido com cliente tem mensagem de WhatsApp**. Por isso pedidos antigos de consultor, que já guardam o cliente, continuam com a mensagem.
- Preço, disponibilidade e total continuam sendo recalculados e conferidos no servidor, como em qualquer pedido.

## Pedido de visitante (sem cadastro)

O cliente final **não precisa de conta** para pedir: ele monta o pedido na vitrine (`/`) ou direto em `/pedidos/novo`, informa nome (obrigatório), telefone e observações e finaliza.

- **Botão "Ver pedido":** no topo da vitrine, no lugar de "Montar pedido", e só aparece quando há produto no pedido guardado no navegador; atualiza na hora ao adicionar um produto. Não há mais link abaixo do produto adicionado.
- **Rascunho no navegador** (`src/lib/orders/guest-cart.ts`): sem usuário, não há onde guardá-lo no banco. Sobrevive a recarregar a página, não acompanha o visitante entre dispositivos e é apagado ao finalizar.
- **Ao finalizar** (`finalizeGuestOrderAction` → `createGuestOrder`): o pedido é gravado no banco **sem dono** (`orders.user_id` nulo), com o mesmo snapshot de referência, descrição e preço de cada item. A tela mostra a confirmação com a **mensagem do WhatsApp** pronta (link para a loja, atalho para o cliente e botão de copiar). A página de detalhe do pedido não é pública: a confirmação aparece na própria tela de montagem.
- **O servidor não confia no cliente:** só chegam produto + quantidade + dados do cliente; preço, disponibilidade e total são recalculados a partir do cadastro, e o total que o visitante viu é conferido (se o preço mudou, recusa e atualiza a tela).
- **Quem vê o pedido:** somente o **ADMIN** (em `/pedidos`, "Lançado por: Cliente sem cadastro"). Consultor e cliente logados veem só os que eles mesmos lançaram, e quem está logado segue usando o rascunho do banco.
- **Configure `WHATSAPP_ORDERS_NUMBER`** no `.env`: é o número que recebe a mensagem. Sem ele, o WhatsApp abre para o visitante escolher o contato, o que na prática não entrega o pedido à loja.
- `src/proxy.ts` deixa `/pedidos/novo` pública; as demais rotas de `/pedidos` e `/admin` continuam exigindo login, e as Server Actions de quem está logado seguem conferindo a sessão por conta própria.

## Painel administrativo (ADMIN)

| Rota | O que faz |
|---|---|
| `/admin` | Visão geral (contagens) e **faturamento** (veja "Faturamento no painel") |
| `/admin/categorias` | Lista, cria, edita e exclui categorias |
| `/admin/produtos` | Lista com busca (referência/descrição), filtro por categoria e situação, e paginação; cria, edita e exclui produtos |

- Todo produto exige **Referência** (única, gravada em maiúsculas), **Descrição** e **Preço** (digitado como `12,50` ou `1.234,56`, gravado em centavos).
- Categoria com produtos não pode ser excluída (a tela explica o motivo). Excluir um produto preserva o histórico dos pedidos antigos (os itens guardam referência, descrição e preço).
- Cada Server Action confere a permissão antes de qualquer outra coisa e valida a entrada com Zod; páginas e ações usam `requirePermission(...)`.

## Faturamento no painel

Em `/admin` (só ADMIN), abaixo das contagens, a seção **Faturamento**:

- **Regra:** faturamento = soma dos pedidos **pendentes + confirmados**; os **cancelados ficam de fora** (a tabela "Pedidos por situação" mostra os três). Hoje todo pedido nasce pendente e a tela não altera a situação, então contar só os confirmados deixaria o painel zerado.
- **Fuso:** dias e meses seguem o horário de **Brasília**, calculados no SQL (`src/lib/orders/revenue.ts`), independentes do fuso do servidor: um pedido das 23h30 de Brasília conta no dia em que foi feito.
- **Números:** faturamento do **mês** em destaque, com a variação sobre o **mesmo trecho do mês anterior** (1º ao mesmo dia, nunca o mês inteiro); cartões de hoje, últimos 7 dias, total geral e ticket médio.
- **Gráfico diário** (30 dias): colunas com rótulo no pico; o tooltip aparece ao passar o mouse **e** pelo teclado (setas, Home, End), e há a visão **"Ver como tabela"** com todos os valores.
- **Rankings** (30 dias): produtos que mais faturam (por referência, com o nome mais recente) e faturamento por origem (admin, consultor, cliente e visitante).
- **Cor:** uma única cor de série (o verde do app), validada contra o fundo branco (contraste 3,77:1; mínimo 3:1). As cores ficam em variáveis CSS (`.viz-root` em `globals.css`) para o dia em que o app tiver modo escuro.

## Layout para celular

Abaixo de **640px** (o breakpoint `sm` do Tailwind) o layout se adapta; no desktop nada muda.

- **Cabeçalho:** marca e perfil + "Sair" na primeira linha, links abaixo (quebram linha se preciso). O nome do usuário só aparece a partir de `sm`.
- **Margens:** `p-4` no celular e `sm:p-8` a partir de 640px.
- **Tabelas viram cartões empilhados** (lista de pedidos, itens do pedido, montagem do pedido, produtos e categorias do admin): cada linha é um cartão em 2 colunas, com o rótulo de cada campo acima do valor. Para usar numa tabela nova:
  - classe `stack-table` no `<table>` e `data-label="Nome do campo"` em cada `<td>`;
  - `stack-wide` na célula que ocupa a linha toda, `stack-actions` na faixa de ações (Editar, Excluir...), `stack-empty` na mensagem de lista vazia;
  - **`role` explícitos** (`table`, `rowgroup`, `row`, `columnheader`, `cell`, `rowheader`): ao mudar o `display`, alguns navegadores perdem a semântica de tabela.
  - O CSS está no fim de `src/app/globals.css`. O rótulo vem de `data-label` (sem duplicar texto no HTML), e o cabeçalho da tabela fica só escondido de quem enxerga.
- **Filtros** (`form[role="search"]`) ocupam a largura toda; campos com no mínimo 16px (abaixo disso o iOS dá zoom ao focar); "Adicionar ao pedido" tem 40px de altura.
- **Teste:** `tests/e2e/mobile-layout.spec.ts` confere, em 320 e 360px e para visitante, consultor e admin, que nenhuma tela passa da largura da janela, além do cabeçalho, das tabelas e das áreas de toque.

## Autenticação e RBAC

- Sessão em banco: cookie `httpOnly` com token aleatório; só o hash SHA-256 fica na tabela `sessions` (7 dias de validade; logout revoga no banco; desativar o usuário invalida as sessões).
- Senhas com `scrypt` (`node:crypto`).
- Permissões por perfil em `src/lib/auth/rbac.ts`; guards (`requireUser`, `requireRole`, `requirePermission`) em `src/lib/auth/guards.ts` respondem 403 via `forbidden()`.
- `src/proxy.ts` é apenas uma checagem otimista (existe cookie?) — a validação real acontece nos guards.

## Testes

```bash
npm run test:unit           # Vitest + Testing Library (jsdom)
npm run test:integration    # Vitest contra o banco `pedidos_test` (criado e migrado automaticamente)
npm run test:e2e            # Playwright: faz o build, sobe `next start` na porta 3100 e usa o banco `pedidos_e2e_test`
npm test                    # tudo, em sequência
```

Primeira vez com E2E: `npx playwright install chromium`.

## Banco de dados

- `npm run db:generate` gera uma nova migração a partir de `src/db/schema.ts`.
- `npm run db:migrate` aplica as migrações pendentes.
- Integração usa `pedidos_test` e E2E usa `pedidos_e2e_test` (ambos criados e migrados automaticamente); o setup recusa rodar em qualquer banco cujo nome não termine em `_test`.
- Valores monetários são guardados em **centavos** (inteiros).
