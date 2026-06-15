# Acordo de Tratamento de Dados Pessoais

**Anexo de Proteção de Dados (LGPD — Lei nº 13.709/2018) · Versão {{VERSAO}}**

## Partes

**ESCRITÓRIO (Controlador):** **{{ESCRITORIO_NOME}}**, CNPJ **{{ESCRITORIO_CNPJ}}**, com sede
em **{{ESCRITORIO_ENDERECO}}**, responsável por desenvolver e operar a plataforma **Mara
Sandra Connect** (“Plataforma”).

**PARCEIRO:** **{{PARCEIRO_NOME}}**, inscrito(a) sob **{{PARCEIRO_DOC}}**, **{{PARCEIRO_OAB}}**,
com endereço em **{{PARCEIRO_ENDERECO}}**.

ESCRITÓRIO e PARCEIRO, em conjunto, “Partes”.

## 1. Objeto e papéis
1.1. Este Acordo regula o tratamento de dados pessoais decorrente da parceria para captação e
acompanhamento de demandas previdenciárias por meio da Plataforma.

1.2. **Controladoria conjunta (art. 26).** ESCRITÓRIO e PARCEIRO atuam como **controladores
conjuntos** dos dados dos titulares por eles compartilhados na Plataforma. O ESCRITÓRIO opera
a Plataforma e contrata operadores/subprocessadores de infraestrutura (Anexo I).

1.3. **Titular** é o cliente/segurado (e seus dependentes/beneficiários, quando houver).

## 2. Dados tratados e bases legais
2.1. Categorias: identificação e contato (nome, CPF, nascimento, telefone, e-mail, endereço);
dados previdenciários (CNIS, vínculos, benefícios); credencial do **Meu INSS** (armazenada
**criptografada**); **documentos médicos** (dado pessoal sensível de saúde); dados processuais.

2.2. **Bases legais (arts. 7º e 11):** execução de contrato e procedimentos a pedido do
titular; cumprimento de obrigação legal; exercício regular de direitos em processo; e, quando
exigível, consentimento. Dados de saúde tratados na forma do art. 11, II.

2.3. **Finalidade restrita:** uso exclusivo para a prestação dos serviços previdenciários e o
acompanhamento do caso, vedado uso diverso.

## 3. Obrigações do PARCEIRO
- acessar e tratar **somente** os dados dos casos sob sua responsabilidade (isolamento técnico
  por RLS assegurado pela Plataforma);
- manter **sigilo** profissional, estendendo o dever a prepostos;
- **não** compartilhar credenciais; comunicar de imediato suspeita de comprometimento;
- **não** extrair ou reutilizar dados/documentos para finalidade estranha ao caso;
- observar a **minimização**; cooperar no atendimento a titulares e à ANPD.

## 4. Obrigações do ESCRITÓRIO e medidas de segurança (arts. 46–49)
A Plataforma adota, entre outras, medidas **já implementadas**: hospedagem do banco e
documentos **no Brasil** (São Paulo); **isolamento por parceiro** (cada um só vê os próprios
casos; conteúdo interno não é acessível ao parceiro nem via API); **armazenamento privado com
links temporários**; **criptografia** da senha do Meu INSS; **trilhas de auditoria** de acesso
a documentos e à senha; **autenticação por link mágico**; e tráfego **cifrado (TLS)**.

## 5. Subprocessadores e transferência internacional (art. 33)
5.1. As Partes autorizam os subprocessadores do **Anexo I**, todos sob obrigações de
segurança e confidencialidade.

5.2. O repositório principal permanece **no Brasil**. Serviços acessórios (e-mail,
armazenamento opcional em Google Drive e processamento por **IA**) podem envolver tratamento
nos **EUA**, com **garantias adequadas** (art. 33), **minimização** e, na IA, configuração de
**não-treinamento/retenção reduzida**.

## 6. Incidentes de segurança (art. 48)
A Parte que tomar conhecimento de incidente relevante comunicará a outra em até **24 horas**.
O ESCRITÓRIO avaliará a comunicação à **ANPD** e aos **titulares**, documentando mitigações.

## 7. Direitos dos titulares e Encarregado (arts. 18 e 41)
As Partes cooperarão para atender, nos prazos legais, aos direitos de confirmação, acesso,
correção, anonimização, portabilidade, eliminação, informação e revogação de consentimento.
**Encarregado (DPO):** {{ENCARREGADO_NOME}} — {{ENCARREGADO_EMAIL}} — {{ENCARREGADO_TEL}}.

## 8. Retenção e eliminação (arts. 15–16)
Os dados são mantidos pelo período necessário às finalidades e às obrigações legais, incluindo
eventual prazo de prescrição/revisional (em regra, **trânsito em julgado + 5 anos**), após o
que são eliminados ou anonimizados.

## 9. Vigência e disposições gerais
Este Acordo vigora enquanto durar a parceria; as obrigações de sigilo e segurança
**sobrevivem** ao término. O descumprimento é causa de rescisão e responsabilização nos termos
da LGPD. Foro da Comarca de **{{FORO}}**.

---

### Anexo I — Subprocessadores
Supabase (banco/auth/armazenamento — **Brasil/São Paulo**); Cloudflare (hospedagem/CDN/DNS —
EUA); Resend (e-mail — EUA); Google/Drive (armazenamento opcional — EUA); Anthropic e OpenAI
(IA, quando habilitada — EUA); n8n (automações). Fontes públicas oficiais (ex.: DJEN/Comunica
do CNJ) não são subprocessadores.

---

_Acordo aceito eletronicamente pelo PARCEIRO no primeiro acesso à Plataforma, com registro de
data, hora, endereço IP e versão. Os dados das Partes acima são preenchidos no aceite._
