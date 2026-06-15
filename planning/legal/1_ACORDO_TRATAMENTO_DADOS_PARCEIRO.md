# ACORDO DE TRATAMENTO DE DADOS PESSOAIS
### Anexo de Proteção de Dados ao Contrato de Parceria — Plataforma “Mara Sandra Connect”

> **Aviso:** minuta gerada para uso interno. Os campos entre **[colchetes]** devem ser
> preenchidos. Recomenda-se revisão final por profissional especializado em proteção de
> dados antes da assinatura. Referências à **LGPD = Lei nº 13.709/2018**.

---

## Qualificação das Partes

**CONTROLADORA / ESCRITÓRIO:** **Mara Sandra Advocacia**, [razão social completa],
inscrita no CNPJ sob nº **[CNPJ]**, com sede em **[endereço completo]**, doravante
**“ESCRITÓRIO”**, responsável por desenvolver e operar a plataforma **Mara Sandra Connect**
(“Plataforma”).

**PARCEIRO:** **[razão social / nome do parceiro]**, inscrito no **[CNPJ/CPF]** e, quando
advogado, na **OAB/[UF] nº [número]**, com sede/endereço em **[endereço]**, doravante
**“PARCEIRO”**.

ESCRITÓRIO e PARCEIRO, em conjunto, **“Partes”**.

---

## 1. Definições

Adotam-se as definições do art. 5º da LGPD, em especial: **dado pessoal**, **dado pessoal
sensível**, **titular**, **tratamento**, **controlador**, **operador**, **encarregado
(DPO)**, **eliminação**, **transferência internacional** e **incidente de segurança**.

Para os fins deste Acordo:

- **Titular:** o cliente/segurado cujos dados são tratados na condução de demandas
  previdenciárias (e, quando aplicável, seus dependentes/beneficiários).
- **Plataforma:** o sistema **Mara Sandra Connect**, incluindo banco de dados,
  armazenamento de documentos, autenticação e integrações.

## 2. Objeto e Enquadramento dos Papéis

2.1. Este Acordo regula o tratamento de dados pessoais decorrente da parceria para captação
e acompanhamento de demandas previdenciárias por meio da Plataforma.

2.2. **Controladoria conjunta (art. 26 da LGPD).** ESCRITÓRIO e PARCEIRO atuam como
**controladores conjuntos** em relação aos dados dos titulares por eles compartilhados na
Plataforma, na medida em que decidem, em conjunto, finalidades e meios essenciais do
tratamento (condução da demanda previdenciária e seu acompanhamento). As responsabilidades
de cada um estão repartidas na **Cláusula 4**.

2.3. **Operação da Plataforma.** O **ESCRITÓRIO** opera diretamente a Plataforma e contrata
**operadores/subprocessadores** de infraestrutura (Anexo I), que tratam os dados em seu nome,
sob instruções documentadas e sem finalidade própria sobre os dados.

2.4. O ponto de contato dos titulares e o canal de exercício de direitos é o **Encarregado**
indicado na Cláusula 9, sem prejuízo de o titular dirigir-se a qualquer das Partes.

## 3. Natureza, Finalidade e Bases Legais

3.1. **Categorias de dados tratados:**

- **Identificação e contato:** nome, CPF, data de nascimento, telefone, e-mail, endereço.
- **Dados previdenciários:** CNIS, vínculos, remunerações, benefícios, simulações.
- **Credencial de acesso a sistemas governamentais:** senha do **Meu INSS** (armazenada de
  forma **criptografada** — ver Cláusula 6).
- **Documentos do caso:** procurações, comprovantes e, especialmente, **documentos médicos
  (laudos, atestados, exames)** — que constituem **dado pessoal sensível** relativo à saúde.
- **Dados processuais:** processos administrativos e judiciais, andamentos e publicações.

3.2. **Dado sensível (art. 11 da LGPD).** O tratamento de dados de saúde restringe-se ao
**necessário** para a tutela dos interesses do titular em demanda previdenciária e ao
**regular exercício de direitos em processo** (art. 11, II, “a” e “d”).

3.3. **Bases legais (arts. 7º e 11):** execução de contrato e procedimentos preliminares a
pedido do titular; cumprimento de obrigação legal/regulatória; exercício regular de direitos
em processo; e, quando exigível, **consentimento** específico e destacado.

3.4. **Finalidade restrita.** Os dados serão usados **exclusivamente** para a prestação dos
serviços advocatícios previdenciários e o acompanhamento do caso na Plataforma, vedado uso
para finalidade diversa, marketing não consentido ou compartilhamento fora do escopo.

## 4. Repartição de Responsabilidades (art. 26)

| Tema | ESCRITÓRIO | PARCEIRO |
|---|---|---|
| Relação e atendimento ao titular captado pelo PARCEIRO | Apoio técnico-jurídico | **Responsável primário** pela coleta lícita e informação ao titular |
| Condução técnica da demanda previdenciária | **Responsável** | Acompanhamento |
| Coleta de consentimento, quando aplicável | Coordenação | **Obtenção e guarda da prova** |
| Resposta a requisições de titulares | Coordenação via Encarregado | Cooperação em até **[5] dias úteis** |
| Comunicação de incidentes | Conforme Cláusula 8 | Conforme Cláusula 8 |

4.1. Cada controlador responde por garantir **base legal** válida para os dados que insere
ou compartilha e pela **veracidade** das informações que fornece.

## 5. Obrigações do PARCEIRO

5.1. Acessar e tratar **somente** os dados dos casos sob sua responsabilidade, vedado tentar
acessar dados de outros parceiros ou casos — controle técnico assegurado por **isolamento
lógico (RLS)** na Plataforma.

5.2. Manter **sigilo** sobre todos os dados, estendendo o dever a prepostos e colaboradores.

5.3. **Não compartilhar credenciais** de acesso; o acesso é nominal e por **link mágico**
(sem senha). Comunicar imediatamente qualquer suspeita de comprometimento de conta.

5.4. **Não extrair, copiar ou reutilizar** documentos e dados para finalidade estranha ao
caso; em especial, dados sensíveis de saúde.

5.5. Atender, no prazo da Cláusula 4, às solicitações de titulares e às orientações do
Encarregado, e cooperar em eventuais auditorias e respostas à ANPD.

5.6. Observar a **minimização**: solicitar e inserir apenas os dados necessários.

## 6. Obrigações do ESCRITÓRIO e Medidas de Segurança (arts. 46–49)

A Plataforma adota, entre outras, as seguintes medidas técnicas e administrativas
**já implementadas**:

- **Hospedagem no Brasil:** banco de dados e documentos hospedados em infraestrutura
  Supabase na região **São Paulo (sa-east-1)**.
- **Isolamento por controlador (RLS):** cada parceiro só acessa os próprios casos;
  conteúdo marcado como interno **não** é acessível ao parceiro, inclusive via API.
- **Armazenamento privado + URLs assinadas:** documentos ficam em *buckets* privados,
  acessíveis apenas por **links temporários** (expiração de 1 a 5 minutos).
- **Criptografia de credencial sensível:** a senha do **Meu INSS** é armazenada
  **criptografada** (pgcrypto), com chave gerida em cofre de segredos, e seu acesso é
  **registrado em log de auditoria**.
- **Trilhas de auditoria:** registro de acessos a documentos e à senha do Meu INSS
  (quem, quando, qual ação) — LGPD art. 37.
- **Autenticação sem senha (link mágico)** e tráfego cifrado (TLS).
- **Integrações com assinatura/validação** (HMAC) e segregação de segredos.

6.1. O ESCRITÓRIO e seus operadores tratarão os dados **somente conforme as finalidades e
instruções** deste Acordo, auxiliando no cumprimento das obrigações da LGPD (segurança,
atendimento a titulares e comunicação de incidentes).

## 7. Operadores e Subprocessadores; Transferência Internacional (art. 33)

7.1. As Partes autorizam o uso dos **operadores/subprocessadores** listados no **Anexo I**,
todos vinculados a obrigações de confidencialidade e segurança compatíveis com este Acordo.

7.2. **Dados no Brasil.** O repositório principal (banco e documentos) permanece **hospedado
no Brasil**.

7.3. **Transferências internacionais.** Determinados serviços acessórios (envio de e-mail,
armazenamento opcional em Google Drive e, quando habilitado, **processamento por
Inteligência Artificial** — ver documento próprio) implicam tratamento por empresas sediadas
**nos Estados Unidos**. Tais transferências observam o art. 33 da LGPD, mediante **cláusulas
contratuais/garantias adequadas**, **minimização** dos dados enviados e, no caso de IA,
configuração de **não-treinamento/retenção reduzida**.

## 8. Incidentes de Segurança (art. 48)

8.1. A Parte que tomar conhecimento de incidente que possa acarretar risco ou dano relevante
comunicará as demais em **até [24] horas**.

8.2. O ESCRITÓRIO, com apoio do Encarregado, avaliará a necessidade de comunicação
à **ANPD** e aos **titulares** em **prazo razoável**, documentando medidas de mitigação.

## 9. Encarregado (DPO) e Direitos dos Titulares (arts. 18, 41)

9.1. **Encarregado:** **[nome]** — e-mail **[encarregado@dominio]** — telefone **[telefone]**.

9.2. As Partes cooperarão para atender, nos prazos legais, aos direitos de **confirmação,
acesso, correção, anonimização, portabilidade, eliminação, informação sobre compartilhamento
e revogação de consentimento**.

## 10. Retenção e Eliminação (arts. 15–16)

10.1. Os dados serão mantidos pelo período necessário às finalidades e ao cumprimento de
obrigações legais e de eventual prazo de **prescrição/revisional** (sugestão: **trânsito em
julgado + 5 anos**), após o que serão **eliminados** ou **anonimizados**.

10.2. Encerrada a parceria, o PARCEIRO perde o acesso à Plataforma; dados sob controladoria
conjunta seguem a política de retenção acima, ressalvada guarda legal pelo ESCRITÓRIO.

## 11. Auditoria

11.1. Mediante aviso prévio razoável, as Partes podem solicitar evidências do cumprimento
deste Acordo (relatórios de medidas, trilhas de auditoria, lista de subprocessadores).

## 12. Vigência, Rescisão e Disposições Gerais

12.1. Este Acordo vigora enquanto durar o Contrato de Parceria e, quanto às obrigações de
sigilo e segurança, **sobrevive** ao seu término.

12.2. O descumprimento das obrigações de proteção de dados é causa de **rescisão** e enseja
responsabilização nos termos da LGPD e do Contrato.

12.3. Fica eleito o foro da Comarca de **[cidade/UF]** para dirimir controvérsias.

---

### ANEXO I — Operadores e Subprocessadores autorizados

> O **ESCRITÓRIO** opera diretamente a Plataforma. Os terceiros abaixo atuam como
> operadores/subprocessadores de infraestrutura, sob contrato e instruções do ESCRITÓRIO.

| Subprocessador | Função | Localização dos dados |
|---|---|---|
| Supabase | Banco de dados, autenticação e armazenamento | **Brasil (São Paulo)** |
| Cloudflare | Hospedagem do app / CDN / DNS | Global (EUA) |
| Resend | Envio de e-mails transacionais | EUA |
| Google (Google Drive) | Armazenamento/sincronização opcional de documentos | EUA |
| Anthropic (Claude) | Inteligência Artificial (quando habilitada) | EUA |
| OpenAI | Inteligência Artificial (quando habilitada) | EUA |
| n8n (autogerido) | Automações e webhooks | **[confirmar — servidor próprio]** |
| Tramitação Inteligente | Integração de gestão de casos (fonte) | Brasil |
| Legalmail | Monitoramento processual (fonte) | Brasil |

> Fontes públicas oficiais (ex.: **DJEN/Comunica do CNJ**) não são subprocessadores: são
> fontes de dados de acesso público consultadas pelo Escritório.

---

**Local e data:** ____________________, ____ / ____ / ______

| ESCRITÓRIO (Mara Sandra Advocacia) | PARCEIRO |
|---|---|
| ____________________ | ____________________ |
| Nome/CPF: | Nome/CPF: |
