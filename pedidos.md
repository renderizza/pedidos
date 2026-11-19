# Contexto e Objetivo

Você é um desenvolvedor sênior full stack especialista em engenharia de software robusta, TDD e arquitetura limpa. Seu objetivo é criar um **Sistema de Pedidos** completo, do zero, seguindo rigorosamente o desenvolvimento por **Fases Sequenciais**.

Em hipótese alguma avance para a próxima fase sem que a fase atual esteja 100% implementada, com todos os arquivos criados e com seus respectivos **testes de unidade, integração e testes End-to-End (E2E)** passando com sucesso.

---

# Stack Tecnológica Obrigatória

- **Backend / API / Frontend:** Next.js (App Router)
- **Runtime:** Node.js
- **Validação de Dados:** Zod
- **ORM:** Drizzle ORM
- **Banco de Dados:** PostgreSQL (rodando via Docker)
- **Infraestrutura:** Docker e Docker Compose
- **Estilização:** Tailwind CSS
- **Testes:** Jest / Vitest (Unidade e Integração) + Playwright (E2E)

---

# Requisitos Funcionais do Sistema

1. **Página Inicial (E-commerce):** Exibição de produtos disponíveis para os clientes/consultores escolherem.
2. **Cadastro de Produtos:** Cada produto possui obrigatoriamente: Referência, Descrição e Preço.
3. **Níveis de Acesso (RBAC):**
   - `ADMIN`: Acesso total ao gerenciamento (produtos, categorias, todos os pedidos).
   - `CONSULTOR`: Visualiza e gerencia apenas os seus próprios pedidos.
   - `CLIENTE`: Acesso à vitrine e fluxo de pedidos básico.
4. **Interface de Pedidos (Tabela Direta):** Não utilize carrinho de compras tradicional. O pedido é montado diretamente em uma tabela interativa contendo as colunas: Referência, Descrição do Produto, Valor Unitário, Quantidade e Valor Total (calculado automaticamente).
5. **Finalização e Integração WhatsApp:** Ao terminar o pedido, ele deve ser salvo no banco de dados (garantindo histórico) e o sistema deve gerar automaticamente uma mensagem formatada contendo o resumo do pedido para envio via WhatsApp.
6. **Painel Administrativo:** Gerenciador restrito a usuários `ADMIN` para produtos, categorias e visualização de todos os pedidos do sistema.
7. **Visão do Consultor:** Usuários com perfil `CONSULTOR` filtraram e visualizarão exclusivamente o histórico dos seus próprios pedidos.

---

# Diretrizes de Desenvolvimento por Fases

Execute estritamente uma fase por vez. Aguarde a confirmação de que os testes passaram para prosseguir.

## FASE 1: Infraestrutura e Configuração Inicial

- [ ] Configurar `docker-compose.yml` subindo o PostgreSQL.
- [ ] Configurar conexão com o banco utilizando Drizzle ORM e criar as migrações iniciais.
- [ ] Configurar estrutura base do projeto Next.js com Tailwind CSS e bibliotecas de testes.
- [ ] Escrever e rodar testes de integração iniciais para validar a conexão com o banco de dados.

## FASE 2: Modelagem de Dados, Autenticação e RBAC (Zod + Drizzle)

- [ ] Criar esquemas no Drizzle e schemas de validação Zod para: Usuários (com papéis ADMIN, CONSULTOR, CLIENTE), Categorias, Produtos e Pedidos/Itens de Pedido.
- [ ] Implementar sistema básico de autenticação/sessão respeitando os 3 níveis de acesso.
- [ ] Escrever testes unitários para os schemas Zod e testes de integração para as regras de permissão (RBAC).
- [ ] Rodar testes E2E básicos de login por perfil.

## FASE 3: Módulo Administrativo (CRUD de Produtos e Categorias)

- [ ] Desenvolver as telas e rotas de gerenciamento de Categorias e Produtos (restrito a `ADMIN`).
- [ ] Garantir validação estrita com Zod em todas as entradas de dados.
- [ ] Escrever testes de unidade para os componentes, testes de integração para as Server Actions/API routes, e teste E2E simulando o fluxo do admin cadastrando produto e categoria.

## FASE 4: Vitrine e Tabela de Pedidos (Interface de Lançamento)

- [ ] Desenvolver a página inicial (vitrine) listando os produtos cadastrados.
- [ ] Desenvolver a interface em formato de tabela interativa para montagem do pedido (Referência, Descrição, Valor Unitário, Quantidade, Valor Total).
- [ ] Implementar o cálculo automático do valor total por linha e geral.
- [ ] Escrever testes unitários para a lógica de cálculo, integração para persistência e E2E para o fluxo completo de montagem do pedido na tabela.

## FASE 5: Histórico de Pedidos e Integração com WhatsApp

- [ ] Implementar a persistência final do pedido no banco de dados ao finalizar.
- [ ] Criar a lógica de geração automática da mensagem estruturada para o WhatsApp com os dados do pedido.
- [ ] Restringir a visualização de pedidos: `CONSULTOR` enxerga apenas os seus; `ADMIN` enxerga todos.
- [ ] Escrever testes unitários para o formatador da mensagem do WhatsApp, testes de integração para o salvamento do histórico e testes E2E cobrindo a finalização do pedido até a geração do link/mensagem do WhatsApp.

---

# Instruções Finais para o Claude Code

Inicie imediatamente pela **FASE 1**. Crie os arquivos necessários, execute os testes de unidade, integração e E2E correspondentes a esta fase. Só apresente a conclusão da fase quando todos os testes estiverem passando 100%. Não avance para a Fase 2 sem minha confirmação ou até concluir integralmente a Fase 1 com os testes validados.
