# Plano — Linha dedicada da "Mara Central" (WhatsApp)

> Decisão a tomar com a Naira. Não implementar nada antes do aval.
> Data: 2026-06-02.

## Por que isso existe

Hoje o "bot" do WhatsApp é o **número pessoal da Naira**. Os testes expuseram 3
problemas, todos com a mesma raiz (número pessoal + provedor gratuito Baileys):

1. **Privacidade/LGPD** — conversas pessoais da Naira foram gravadas no banco
   (limpamos 70 mensagens de 9 contatos). Enquanto o bot for o número dela, isso
   se repete sempre que o webhook estiver ligado.
2. **Estabilidade** — "Waiting for this message" (falha de descriptografia do
   Baileys multi-dispositivo), agravado por WhatsApp Web aberto e por ser um
   número cheio de outras conversas.
3. **Risco de ban** — re-linkar com frequência disparou "Can't link new devices
   right now" do próprio WhatsApp. Baileys é não-oficial; uso intenso num número
   pessoal aumenta o risco de banir o número **pessoal** dela.

**Conclusão:** um **número dedicado** (só do escritório) é necessário de qualquer
forma. A pergunta seguinte é **qual tecnologia** usar nesse número.

---

## A decisão central: duas opções de tecnologia

### Opção A — Chip dedicado + Evolution/Baileys (stack atual)
Um número novo (chip/eSIM dedicado), conectado como a instância `mara` do
Evolution, no lugar do número da Naira.

**Prós**
- **Grátis** (sem custo por mensagem).
- **Zero mudança de código** — é o mesmo Evolution que já roda.
- **Rápido** de ativar (parear o número novo e re-onboardar o parceiro de teste).
- Resolve **100% a privacidade** (número não tem conversas pessoais).
- Reduz bastante a instabilidade (número limpo, sem WhatsApp Web pessoal).

**Contras**
- **Continua sendo Baileys (não-oficial)** — risco de ban **persiste** (agora no
  número do escritório, não no pessoal), sessões ainda podem cair e exigir
  re-pareamento (QR).
- Exige um **chip/dispositivo físico** mantido online (ou um celular dedicado).
- **Botões/listas interativas continuam sem funcionar** (limitação do Baileys).
- Tecnicamente **contra os termos** do WhatsApp.

### Opção B — API Oficial (WhatsApp Business Cloud API, da Meta)
Migrar pro canal oficial. O número (pode ser um dedicado, inclusive fixo) vira
um número da Business Platform.

**Prós**
- **Entrega confiável** — acaba o "Waiting for this message".
- **Sem risco de ban** (é o canal oficial e suportado).
- **Botões e listas funcionam** de verdade (templates interativos).
- Escalável pra muitos parceiros; recursos de negócio (templates, métricas).

**Contras**
- **Pago** — modelo por mensagem/conversa (mensagens iniciadas pelo negócio
  usam **templates aprovados** e são cobradas; respostas dentro da janela de
  24h após o parceiro escrever costumam ser de menor custo/gratuitas). *Confirmar
  a tabela vigente no cadastro — o modelo da Meta muda.*
- **Burocracia de setup**: conta Meta Business, **verificação do negócio**,
  app na Meta, número aprovado, **templates aprovados** pra mensagens proativas
  (ex.: "novo comentário no seu caso").
- **Mais trabalho de código**: trocar o provider de envio/recebimento. *Mitigado*
  pela arquitetura já planejada (isolar o provider; outbox + Edge Function
  continuam iguais — muda só a "última milha" de envio/recebimento).
- A regra das **24h**: fora dessa janela, só dá pra falar com o parceiro via
  **template aprovado** (não texto livre). Isso muda um pouco a UX do menu.

---

## Detalhe técnico importante (vale pras duas opções)

O **LID** (identificador anônimo do remetente) é **relativo ao número do bot**.
Trocar o número do bot **muda os LIDs** que recebemos dos parceiros. Ou seja: o
vínculo semeado do Andre (`76901926351084`) **não vale** no número novo.

✅ **Já estamos preparados pra isso**: o **onboarding por código** (construído
2026-06-02) re-vincula cada parceiro no número novo sem trabalho manual — é só
clicar "Ativar WhatsApp" no painel depois de trocar o número.

---

## Recomendação (em duas etapas)

**Agora (curto prazo): Opção A — chip dedicado.**
- Resolve **já** a privacidade (o problema mais sensível) e melhora a
  estabilidade, com **custo ~zero** e sem reescrever nada.
- Permite continuar testando e até atender os **primeiros parceiros reais**.

**Depois (médio prazo): avaliar a Opção B — API oficial.**
- Quando for escalar pra vários parceiros reais e a confiabilidade virar
  prioridade, migrar pro canal oficial. A arquitetura (outbox + provider isolado)
  torna essa troca **localizada**, não um rewrite.

> Resumindo: **chip dedicado já** pra destravar com segurança; **API oficial**
> como evolução natural quando o volume justificar o custo.

---

## Passos da Opção A (se aprovada)

1. **Conseguir um número dedicado** (decisão da Naira): um **chip novo** (pré-pago
   serve) num celular/aparelho que fique ligado, OU um eSIM, OU um número virtual
   que aceite WhatsApp. *Não usar número pessoal de ninguém.*
2. Instalar o WhatsApp nesse número (ativar a conta).
3. No Evolution: **logout** da instância `mara` (número atual) e **parear** o
   número novo (`msc-wa.mjs logout` + `connect`).
4. Atualizar a constante do número do bot (`EVOLUTION_PHONE` nos scripts) e o
   `usuarios.telefone` se algum cadastro apontar pro número antigo.
5. **Re-onboardar** os parceiros: clicar "Ativar WhatsApp" no painel (gera o
   código no número novo) — o vínculo LID novo é criado automaticamente.
6. Ligar o webhook e testar ponta a ponta.

## Passos da Opção B (se/quando aprovada) — alto nível
1. Criar/usar conta **Meta Business** + verificação do negócio.
2. Adicionar número à **WhatsApp Business Platform** (Cloud API).
3. Criar app na Meta, obter tokens, configurar webhook oficial.
4. **Trocar o provider** de envio/recebimento (isolar numa camada; outbox e
   máquina de estados continuam).
5. Submeter **templates** das mensagens proativas pra aprovação.
6. Testar e migrar.

---

## Decisão que preciso da Naira
1. **Seguimos com a Opção A (chip dedicado) agora?** Se sim, ela providencia o
   número dedicado e eu faço a troca + re-onboarding.
2. **Quer que eu já detalhe/orce a Opção B (API oficial)** pra ter na manga?
