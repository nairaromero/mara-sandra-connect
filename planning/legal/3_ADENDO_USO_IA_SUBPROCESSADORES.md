# Adendo de Uso de Inteligência Artificial e Registro de Subprocessadores de IA
### Documento de conformidade — Plataforma “Mara Sandra Connect”

> **Aviso:** documento interno de governança/registro. Preencher **[colchetes]** e revisar
> com profissional especializado. Base legal: **LGPD — Lei nº 13.709/2018** (em especial
> arts. 6º, 7º/11, 20, 33, 37, 46–48).

**Versão:** 1.0 · **Data:** [data] · **Responsável pelo registro:** [nome]

---

## 1. Objetivo

Registrar e disciplinar o tratamento de dados pessoais realizado por meio de **ferramentas
de Inteligência Artificial (IA)** integradas à Plataforma, demonstrando conformidade com a
LGPD e definindo as **configurações obrigatórias** junto aos provedores.

## 2. Descrição do tratamento por IA

A Plataforma oferece recursos de IA de **apoio à decisão humana**:

- **Análise técnica assistida** — geração de minuta de análise previdenciária a partir dos
  dados e documentos do caso (incl. leitura de PDFs/CNIS).
- **Assistente/automação por conversa (MCP)** — leitura e organização de informações do caso
  e elaboração de peças, sempre sob comando e revisão de usuário interno.

O conteúdo enviado pode incluir dados pessoais e, conforme o caso, **dados sensíveis de
saúde** (laudos), limitados ao necessário para a finalidade.

## 3. Provedores de IA (subprocessadores)

| Provedor | Papel | País | Salvaguarda de transferência (art. 33) |
|---|---|---|---|
| **Anthropic, PBC** (Claude) | Suboperador de IA | EUA | Cláusulas contratuais / DPA do provedor |
| **OpenAI** (GPT) | Suboperador de IA | EUA | Cláusulas contratuais / DPA do provedor |

Os provedores atuam **por conta e ordem** dos controladores, sem finalidade própria sobre os
dados, e **não devem** utilizá-los para treinar modelos (ver Cláusula 5).

## 4. Medidas de minimização e segurança já implementadas

- **Minimização/redação de PII:** rotina de **redução de dados identificadores** antes do
  envio à IA (camada de *redact*), enviando o mínimo necessário.
- **BYOK / escopo controlado:** uso de chave própria e escopo restrito das operações da IA.
- **Acesso restrito:** recurso de IA disponível a **usuários internos**; conteúdo interno
  não é exposto a parceiros.
- **Transparência ao usuário:** os limites da IA são declarados no resultado, reforçando que
  é **apoio** e não decisão automatizada.

## 5. Configurações OBRIGATÓRIAS por provedor (checklist)

> Confirmar e manter evidência (print/PDF) em cada conta. Termos dos provedores mudam — revisar
> periodicamente.

**Anthropic (Claude):**
- [ ] Conta sob **Termos Comerciais (Commercial Terms)** — uso de API **não** treina modelos.
- [ ] **DPA / Data Processing Addendum** assinado/aceito.
- [ ] Avaliar/solicitar **Zero Data Retention (ZDR)** quando elegível.
- [ ] **Não** habilitar recursos que reutilizem dados (ex.: programas de feedback).

**OpenAI (GPT):**
- [ ] Uso via **API** (dados de API **não** são usados para treino por padrão).
- [ ] **DPA** assinado/aceito; **Business/Enterprise** se aplicável.
- [ ] Avaliar **Zero Data Retention** para endpoints elegíveis.
- [ ] **Desativar** qualquer opção de “improve the model”/compartilhamento de dados.

**Governança comum:**
- [ ] Segredos/chaves guardados em cofre; **não** expostos no código.
- [ ] **Kill-switch** e **revogação** de acesso por usuário.
- [ ] **Logs** de uso da IA e expiração de tokens.

## 6. Base legal e transparência (arts. 7º/11 e 20)

6.1. O tratamento por IA apoia-se nas mesmas bases da finalidade principal (execução de
contrato, exercício de direitos em processo e, quando exigível, consentimento).

6.2. **Decisão humana.** Não há decisão **unicamente automatizada** com efeito jurídico: a IA
gera minutas/insumos revisados por profissional. Resguarda-se ao titular o direito à
**informação e à revisão** (art. 20).

6.3. **Aviso de privacidade** informa o titular sobre o possível processamento por IA (ver
Política de Privacidade, Seção 8).

## 7. Por que enviar dado à IA configurada não é, por si só, “incidente”

O envio de dados a **suboperador** contratualmente vinculado, com **não-treinamento** e
**minimização**, é **tratamento autorizado** — não “vazamento”. Incidente seria acesso não
autorizado, perda ou exposição indevida. Mantêm-se, ainda assim, as obrigações de segurança
e o plano de resposta a incidentes.

## 8. Registro da decisão da controladora (art. 37)

A habilitação dos recursos de IA foi decidida e autorizada pela controladora:

- **Decidido por:** [nome / cargo] — **Data:** [data].
- **Escopo autorizado:** [ex.: análise técnica e assistente MCP para usuários internos].
- **Reavaliação periódica:** [ex.: semestral].

## 9. Anexo — Registro de subprocessadores de IA

| Item | Anthropic | OpenAI |
|---|---|---|
| Finalidade | Análise/assistente de IA | Análise/assistente de IA |
| Categorias de dados | Dados do caso (incl. sensíveis, minimizados) | Idem |
| País | EUA | EUA |
| Treinamento com os dados | **Não** (Termos Comerciais) | **Não** (uso via API) |
| Retenção | [confirmar — ZDR/limitada] | [confirmar — ZDR/limitada] |
| DPA assinado | [ ] sim — data: ____ | [ ] sim — data: ____ |
| Evidência arquivada em | [link/local] | [link/local] |

---

**Responsável pelo registro:** ____________________  **Encarregado (DPO):** ____________________
