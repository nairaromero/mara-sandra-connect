# CRM Comercial

Módulo de captação e esteira de vendas do site (tela do comercial / Sebastião).
Baseado no Manual_Comercial_MSV.pdf (Drive).

## Entregue

### Fase 1 (2026-07, PR #64)
- Formulário público de captação na home (abas cliente/parceiro), UTMs, honeypot,
  handoff pro WhatsApp após envio.
- Tabela `leads` com esteira (`novo → triagem → analise → agendar → agendado →
  fechamento → handoff → fechado | sem_direito | perdido`) e RLS: anon só insere.

### Fase 2 (2026-07)
- Tela `/comercial` (só interno): kanban por etapa no desktop, lista com filtro no
  mobile, painel de detalhe com observações internas.
- Sair de "novo" registra `primeiro_contato_em` automaticamente; clicar no botão
  de WhatsApp também.
- Mover pra "agendar" cria tarefa automática pro usuário.
- Mover pra "agendado" abre dialog de data/hora/duração/convidado e cria evento
  restrito na Agenda (`agenda_eventos.restrito_a uuid[]` + RLS: NULL = todos os
  internos veem; com lista, só quem está nela). Lead espelha em `consulta_em` /
  `agenda_evento_id`.
- Handoff: "Converter em cliente" (pede CPF, obrigatório em `clientes`; telefone
  vem do WhatsApp do lead; CPF duplicado vincula ao cliente existente). Lead
  ganha `cliente_id` e vai pra "fechado".
- Histórico de comentários por lead (`lead_comentarios`, RLS interno) no lugar
  do campo único de observações — vira o histórico da negociação até o handoff.
- **Análise com responsável** (fluxo pedido 2026-07-13): mover pra "analise"
  pede a advogada → nasce tarefa pra ela (`metadata.lead_id`); ao concluir a
  tarefa, trigger `trg_lead_analise_concluida` marca `analise_concluida_em` e
  comenta no histórico — o comercial vê "análise concluída" no kanban e decide:
  **dar continuidade** (→ fechamento, com marco "kit previdenciário enviado" em
  `kit_enviado_em`; assinou → handoff) ou **sem direito**.
  Obs: `tarefas.caso_id` virou nullable (front já era null-safe).

## Roadmap (pedidos da Naira)

1. **Agendamento conectado ao cliente via WhatsApp** (pedido 2026-07-13):
   - Ao agendar a consulta na tela do comercial, **enviar confirmação ao cliente
     pelo WhatsApp** (data/hora, link/instruções).
   - Melhor ainda: **o cliente agendar sozinho pelo WhatsApp**, com o bot
     mostrando os **slots livres da agenda** (respeitando eventos restritos) e
     gravando o evento + movendo o lead pra "agendado".
   - Depende da integração WhatsApp (Evolution API — ver
     planning/INTEGRACAO_WHATSAPP.md). Apresentar opções de arquitetura antes
     de decidir (combinado com a Naira).
2. **Webhook de leads pro n8n** (`lead.created`, `lead.etapa_alterada`): o outbox
   atual (`webhook_destinos.parceiro_id NOT NULL`) é amarrado a parceiro; emitir
   evento interno exige destino sem parceiro ou outbox interno separado.
   Proposta pendente.
3. **Alerta de lead parado** (lead em "novo" sem 1º contato > X horas →
   notificação no sino): precisa de job agendado (pg_cron não habilitado no
   projeto ainda — mesma pendência do sync diário `#3b`).
4. **Fase 3 — handoff completo**: criar caso junto com o cliente na conversão e
   navegar direto pra tela do caso; copiar o histórico da negociação pro caso.
5. **Kit previdenciário digital**: enviar o kit pro cliente (WhatsApp/e-mail) e
   acompanhar assinatura (e-sign) — hoje o envio é manual e só o marco é
   registrado (`kit_enviado_em`).
