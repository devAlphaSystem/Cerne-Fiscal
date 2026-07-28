# API

Referência completa da superfície pública de `cerne-fiscal`. Para exemplos
executáveis, veja [EXEMPLOS.md](EXEMPLOS.md); para a linha de comando, veja
[CLI.md](CLI.md).

## Superfície exportada

```ts
import {
  // Extração
  extractNFeAccessKeys,
  extractNFCeAccessKeys,
  // Validação
  validateAccessKey,
  parseAccessKey,
  validateIssuerIdentifier,
  calculateAccessKeyCheckDigit,
  ACCESS_KEY_ISSUE_CODES,
} from "cerne-fiscal";
```

Tudo o mais é interno. `ResolvedOptions`, `RenderRecipe`, `InvalidOptionsError`,
`ExtractionFailure`, `isValidAccessKeyForModel` e os módulos de `document/`,
`pdf/`, `recognition/`, `candidates/` e `scoring/` não fazem parte do contrato
público e podem mudar sem aviso.

Não existe API de lote neste pacote: cada chamada processa um documento.

---

## Extração

### `extractNFeAccessKeys(input, options?)`

```ts
function extractNFeAccessKeys(input: DocumentInput, options?: ExtractOptions): Promise<ExtractionResult<"55">>;
```

### `extractNFCeAccessKeys(input, options?)`

```ts
function extractNFCeAccessKeys(input: DocumentInput, options?: ExtractOptions): Promise<ExtractionResult<"65">>;
```

Uma função por modelo fiscal. `extractNFeAccessKeys` procura **exclusivamente**
chaves de NF-e (modelo 55) e `extractNFCeAccessKeys` **exclusivamente** chaves
de NFC-e (modelo 65). As duas compartilham pipeline e opções, mas cada chamada
processa um único modelo — o tipo fiscal **não** faz parte de `ExtractOptions`.

Em TypeScript os retornos são estreitados para `ExtractionResult<"55">` e
`ExtractionResult<"65">`, então `components.model` e `documentType` já vêm
tipados como `"55"`/`"NFe"` ou `"65"`/`"NFCe"`.

**A promise não é rejeitada por falha de processamento**: erros esperados chegam
em `result.error` com um `ExtractionErrorCode` estável.

`input` aceita:

| Forma                      | Observação                                            |
| -------------------------- | ----------------------------------------------------- |
| `string` com caminho local | Caminho de arquivo resolvido pelo sistema de arquivos |
| `string` com URL           | Somente `http://` e `https://` completos              |
| `ArrayBuffer`              | Bytes em memória                                      |
| `Uint8Array` / `Buffer`    | Bytes em memória (`Buffer` é um `Uint8Array`)         |

O formato é decidido pela assinatura real dos bytes — PDF, JPEG ou PNG.
Extensão do arquivo e `Content-Type` da resposta não influenciam a aceitação.

> O contrato atual extrai e valida **chaves de acesso**. Itens, produtos,
> pagamentos, tributos e demais campos completos de uma nota são uma evolução
> futura e não são inferidos por estas funções.

---

## Opções

### `ExtractOptions`

| Opção                  | Tipo                                 | Padrão              | Faixa aceita               |
| ---------------------- | ------------------------------------ | ------------------- | -------------------------- |
| `performance`          | `"fast" \| "balanced" \| "accurate"` | `"balanced"`        | —                          |
| `passes`               | `number`                             | do perfil           | `1..5`                     |
| `ocr`                  | `"never" \| "fallback" \| "always"`  | do perfil           | —                          |
| `maxPages`             | `number`                             | do perfil           | `1..10000`                 |
| `maxFileSizeBytes`     | `number`                             | `31457280` (30 MiB) | `1..1073741824` (1 GiB)    |
| `maxPixelsPerPage`     | `number`                             | do perfil           | `250000..100000000`        |
| `maxSourceImagePixels` | `number`                             | do perfil           | `250000..200000000`        |
| `timeoutMs`            | `number`                             | do perfil           | `0..3600000` (`0` desliga) |
| `stopAfterFirst`       | `boolean`                            | `false`             | —                          |
| `requestHeaders`       | `Readonly<Record<string,string>>`    | nenhum              | somente com URL            |
| `signal`               | `AbortSignal`                        | nenhum              | —                          |

Valores fora da faixa produzem `error.code === "INVALID_OPTIONS"`. Os limites
são conferidos com `Number.isInteger`, então valores fracionários são recusados.

### Perfis de desempenho

| Perfil     | `passes` | `ocr`      | `maxPages` | `maxPixelsPerPage` | `maxSourceImagePixels` | `timeoutMs` |
| ---------- | -------- | ---------- | ---------- | ------------------ | ---------------------- | ----------- |
| `fast`     | 1        | `never`    | 10         | 8.000.000          | 40.000.000             | 30.000      |
| `balanced` | 2        | `fallback` | 30         | 12.000.000         | 60.000.000             | 120.000     |
| `accurate` | 3        | `fallback` | 50         | 20.000.000         | 100.000.000            | 300.000     |

O perfil define apenas os padrões. Qualquer opção informada explicitamente
prevalece — `{ performance: "fast", ocr: "always" }` é uma combinação válida.

**Diferença prática entre os perfis.** `fast` e `balanced` ignoram o trabalho
visual nas páginas que já produziram uma chave válida em texto. `accurate` ainda
executa as passagens de código de barras configuradas, para fazer uma
verificação cruzada independente. No modo `fallback`, o OCR só roda nas páginas
não resolvidas pelas etapas anteriores; `ocr: "always"` o executa de qualquer
forma.

### `requestHeaders`

Aceito somente quando `input` é uma URL HTTP/HTTPS e somente com valores string.
Nomes são normalizados para minúsculas e validados com `validateHeaderName` /
`validateHeaderValue` do Node.js. São recusados:

- nomes duplicados quando comparados sem diferenciar maiúsculas;
- objetos com protótipo diferente de `Object.prototype` ou `null`;
- os cabeçalhos reservados pelo componente de download:

```text
accept-encoding, connection, content-length, expect, host, if-range,
keep-alive, proxy-connection, range, te, trailer, transfer-encoding, upgrade
```

O pacote não executa fluxos de login nem mantém repositório de cookies. A
aplicação chamadora responde pelas credenciais fornecidas e pelo estado da
sessão. Prefira HTTPS: cabeçalhos enviados a uma URL HTTP inicial não são
protegidos por TLS.

---

## Resultado

```ts
interface ExtractionResult<TModel extends AccessKeyModel = AccessKeyModel> {
  status: "success" | "not_found" | "partial" | "error";
  success: boolean;
  precisionScore: number;
  bestMatch: ExtractedAccessKey<TModel> | null;
  results: ExtractedAccessKey<TModel>[];
  metadata: ExtractionMetadata;
  warnings: string[];
  error: ExtractionErrorInfo | null;
}
```

### Como `status` é decidido

| Condição                                                | `status`      |
| ------------------------------------------------------- | ------------- |
| Houve erro terminal e nenhuma chave foi validada        | `"error"`     |
| Houve erro terminal mas ao menos uma chave foi validada | `"partial"`   |
| A varredura não completou (ex.: corte por `maxPages`)   | `"partial"`   |
| Varredura completa, ao menos uma chave validada         | `"success"`   |
| Varredura completa, nenhuma chave validada              | `"not_found"` |

`success` é independente de `status`: vale `true` sempre que `results` não está
vazio, inclusive em `"partial"`.

`precisionScore` no topo é **conservador** — corresponde à **menor** pontuação
entre os itens de `results`, não à do `bestMatch`. Quando `results` está vazio,
vale `0`.

### `ExtractedAccessKey`

```ts
interface ExtractedAccessKey<TModel extends AccessKeyModel = AccessKeyModel> {
  accessKey: string; // 44 caracteres normalizados
  documentType: AccessKeyDocumentTypeForModel<TModel>; // "NFe" | "NFCe"
  model: TModel; // "55" | "65"
  format: "numeric" | "alphanumeric";
  isValid: true; // literal: só entra em results o que é válido
  precisionScore: number; // 0..1
  pages: number[]; // 1-based; imagens sempre [1]
  sources: ExtractionSource[];
  occurrences: number;
  components: AccessKeyComponents & {
    model: TModel;
    documentType: AccessKeyDocumentTypeForModel<TModel>;
  };
}
```

`isValid` é o literal `true`, não `boolean`: uma chave que não passe
integralmente pela validação nunca entra em `results`.

`ExtractionSource` é
`"pdf-text" | "pdf-text-reconstructed" | "code128" | "qr-code" | "ocr"`.

`occurrences` conta evidências distintas retidas para a chave. Repetições
derivadas da mesma página — filtros, escalas, rotações, leitura invertida,
regiões candidatas — **não** aumentam a contagem nem a confiança.

Todas as chaves permanecem como strings, então zeros à esquerda nunca são
perdidos.

### `ExtractionMetadata`

| Campo                  | Significado                                                            |
| ---------------------- | ---------------------------------------------------------------------- |
| `performance`          | Perfil resolvido                                                       |
| `ocrMode`              | Modo de OCR resolvido                                                  |
| `inputFormat?`         | `"pdf"`, `"jpeg"` ou `"png"`; ausente se a falha antecede a detecção   |
| `passesRequested`      | Passagens visuais configuradas                                         |
| `passesUsed`           | Passagem mais profunda efetivamente alcançada                          |
| `pagesTotal`           | Páginas declaradas pelo documento; sempre `1` em imagem                |
| `pagesProcessed`       | Páginas visitadas na extração de texto nativo                          |
| `pagesRendered`        | Páginas distintas rasterizadas                                         |
| `renderAttempts?`      | Renderizações pedidas, incluindo reaproveitamento de superfície pronta |
| `ocrPages`             | Páginas distintas submetidas ao OCR                                    |
| `fileSizeBytes`        | Bytes da fonte carregada                                               |
| `sourceImageWidth?`    | Largura decodificada original (somente JPEG/PNG)                       |
| `sourceImageHeight?`   | Altura decodificada original (somente JPEG/PNG)                        |
| `maxPixelsPerPage`     | Limite resolvido por página renderizada                                |
| `maxSourceImagePixels` | Limite resolvido da imagem de origem                                   |
| `durationMs`           | Tempo total decorrido                                                  |
| `complete`             | `false` quando houve erro ou truncamento por `maxPages`                |
| `confidenceVersion`    | Literal `"1.0.0"` — versão do contrato de pontuação                    |

Fixe `confidenceVersion` se o seu sistema depende de limiares numéricos: uma
mudança nesse valor sinaliza que as pontuações foram recalibradas.

### `ExtractionErrorInfo`

```ts
interface ExtractionErrorInfo {
  code: ExtractionErrorCode;
  message: string;
}
```

| Código               | Quando ocorre                                           |
| -------------------- | ------------------------------------------------------- |
| `INVALID_INPUT`      | Entrada não é caminho, URL aceita nem bytes válidos     |
| `FILE_NOT_FOUND`     | Caminho local inexistente ou ilegível                   |
| `FILE_TOO_LARGE`     | Excede `maxFileSizeBytes` (declarado ou recebido)       |
| `DOWNLOAD_ERROR`     | Falha de rede, HTTP ou excesso de redirecionamentos     |
| `INVALID_OPTIONS`    | Opção fora da faixa aceita ou cabeçalho recusado        |
| `INVALID_PDF`        | Bytes de PDF corrompidos ou não abríveis                |
| `UNSUPPORTED_FORMAT` | Assinatura de bytes fora de PDF, JPEG e PNG             |
| `INVALID_IMAGE`      | JPEG/PNG malformado ou fora dos limites de dimensão     |
| `PASSWORD_REQUIRED`  | PDF criptografado; o pacote não oferece opção de senha  |
| `TIMEOUT`            | `timeoutMs` esgotado                                    |
| `ABORTED`            | `signal` disparado                                      |
| `RESOURCE_LIMIT`     | Limite de pixels, texto ou recurso interno atingido     |
| `PROCESSING_ERROR`   | Falha inesperada já convertida em resultado estruturado |

Erros estruturados não reproduzem a URL, a string de consulta, os valores dos
cabeçalhos, buffers nem objetos internos do documento.

---

## Chave de acesso

### Formatos aceitos

O pacote aceita tanto as chaves numéricas legadas de 44 dígitos quanto o formato
atual de 44 caracteres, introduzido para CNPJs alfanuméricos em julho de 2026:

```text
^[0-9]{6}[A-Z0-9]{12}[0-9]{26}$
```

Somente as **12 primeiras posições do identificador do emitente** podem ser
alfanuméricas; as demais continuam numéricas. As chaves numéricas são um
subconjunto compatível do mesmo algoritmo. `format` no resultado informa qual
dos dois casos foi detectado.

O leitor usa decodificação genérica de Code 128, portanto aceita tanto o Code
Set C legado quanto a representação híbrida atual em Code Set C/A.

### `AccessKeyComponents`

| Campo           | Posições | Conteúdo                                             |
| --------------- | -------- | ---------------------------------------------------- |
| `accessKey`     | 1–44     | Chave normalizada em maiúsculas                      |
| `format`        | —        | `"numeric"` ou `"alphanumeric"`                      |
| `stateCode`     | 1–2      | Código da UF                                         |
| `yearMonth`     | 3–6      | `YYMM`                                               |
| `year`          | 3–4      | Ano de emissão                                       |
| `month`         | 5–6      | Mês de emissão                                       |
| `issuerId`      | 7–20     | CNPJ ou CPF com zeros à esquerda (14 caracteres)     |
| `model`         | 21–22    | Modelo bruto, inclusive valores não suportados       |
| `documentType`  | —        | `"NFe"`, `"NFCe"` ou `null` para modelo desconhecido |
| `series`        | 23–25    | Série                                                |
| `invoiceNumber` | 26–34    | Número da nota                                       |
| `emissionType`  | 35       | Tipo de emissão                                      |
| `numericCode`   | 36–43    | Código numérico do emitente                          |
| `checkDigit`    | 44       | Dígito verificador, como `number`                    |

### Regras de validação

Uma chave só entra em `results` depois de passar por **todas**:

1. Formato numérico de 44 dígitos ou alfanumérico oficial.
2. `stateCode` presente na lista de 27 códigos IBGE de UF.
3. `month` entre `01` e `12`.
4. `model` igual a `55` ou `65` — e igual ao modelo da função chamada.
5. `invoiceNumber` diferente de `000000000`.
6. `issuerId` válido como CNPJ ou como CPF com zeros à esquerda.
7. Dígito verificador oficial por módulo 11.

O cálculo do DV mapeia cada um dos 43 primeiros caracteres para `ASCII - 48`,
aplica pesos repetidos de 2 a 9 da direita para a esquerda e então módulo 11.
Restos `0` e `1` produzem dígito `0`.

---

## Pontuação

`precisionScore` é determinístico e versionado por `metadata.confidenceVersion`.
Código de barras/QR, texto nativo exato, texto reconstruído e OCR partem de
bases diferentes; fontes independentes que concordam elevam a pontuação. **Não é
uma probabilidade calibrada estatisticamente.** Meça precisão, recall e falsos
positivos em um corpus privado representativo antes de usar um limiar em
automações fiscais.

---

## Validação independente

Estas funções são síncronas, puras e não carregam PDF, canvas ou OCR.

### `validateAccessKey(value)`

```ts
function validateAccessKey(value: string): AccessKeyValidation;
```

Não lança para conteúdo inválido — devolve estrutura com `issues`. A entrada é
normalizada para maiúsculas antes da análise.

```ts
interface AccessKeyValidation {
  isValid: boolean;
  normalizedValue: string;
  format: AccessKeyFormat | null;
  components: AccessKeyComponents | null;
  expectedCheckDigit: number | null;
  issues: AccessKeyIssue[];
}

interface AccessKeyIssue {
  code: AccessKeyIssueCode;
  message: string;
}
```

`validateAccessKey` aceita os modelos 55 e 65 **indistintamente** — o filtro por
modelo pertence somente às funções de extração. Para restringir, compare
`components.model` depois de validar.

`ACCESS_KEY_ISSUE_CODES` enumera os códigos estáveis:

```text
INVALID_FORMAT             INVALID_MONTH
INVALID_CHECK_DIGIT        INVALID_ISSUER_IDENTIFIER
INVALID_MODEL              INVALID_INVOICE_NUMBER
INVALID_STATE_CODE
```

Quando o formato é irreconhecível, `issues` traz apenas `INVALID_FORMAT` e
`components` volta `null`. Nos demais casos as regras são avaliadas todas, na
ordem determinística: UF, mês, modelo, número da nota, emitente, dígito
verificador.

### `parseAccessKey(value)`

```ts
function parseAccessKey(value: string): AccessKeyComponents;
```

Decompõe uma chave estruturalmente suportada. **Lança `TypeError`** se o valor
não casar com um dos formatos de 44 caracteres. Não julga validade semântica:
uma UF inexistente ou um modelo `99` são devolvidos como estão, com
`documentType` igual a `null`.

### `validateIssuerIdentifier(value)`

```ts
function validateIssuerIdentifier(value: string): boolean;
```

Valida o campo de 14 caracteres do emitente como CNPJ (inclusive alfanumérico)
ou como CPF com três zeros à esquerda. Rejeita sequências de caracteres
repetidos. Retorna `false` em vez de lançar.

### `calculateAccessKeyCheckDigit(body)`

```ts
function calculateAccessKeyCheckDigit(body: string): number;
```

Recebe o corpo de **43 caracteres**, sem o dígito verificador, e devolve o
dígito de `0` a `9`. Lança `TypeError` quando o corpo não casa com o formato
suportado.

---

## Documentos remotos

Somente URLs `http://` e `https://`. O download segue respostas 301, 302, 303,
307 e 308, com no máximo cinco redirecionamentos. Redirecionamentos de mesma
origem preservam os `requestHeaders`; quando a origem muda, todos são removidos
antes da próxima solicitação.

`maxFileSizeBytes` é aplicado tanto ao `Content-Length` declarado quanto aos
bytes recebidos durante a transferência. `timeoutMs` abrange download e extração
em conjunto, e `signal` cancela qualquer uma das fases. É a assinatura de PDF,
JPEG ou PNG — não a extensão da URL nem o tipo de mídia da resposta — que
determina se o conteúdo baixado é aceito. Falhas usam `DOWNLOAD_ERROR`.

> **O pacote não é um filtro de SSRF.** Uma URL e seus redirecionamentos podem
> alcançar qualquer endereço acessível ao processo. Quando forem necessárias
> listas de permissão de host, DNS/IP ou redirecionamento, faça o download com
> um cliente controlado pela aplicação e envie os bytes ao extrator.

---

## Imagens, limites e escopo

JPEG/JPG e PNG são os formatos de imagem suportados. Extensões ausentes,
incorretas ou duplicadas não interferem quando os bytes são válidos. GIF, TIFF,
HEIC/HEIF, vídeo e imagens multipágina não fazem parte deste contrato — cada
JPEG ou PNG é uma única página, e `pagesTotal` é sempre `1`.

Antes de decodificar, o extrator lê largura e altura do cabeçalho, valida a
estrutura inicial, recusa eixos acima de 32.767 pixels e aplica
`maxSourceImagePixels`. As dimensões decodificadas são verificadas novamente.
`maxPixelsPerPage` limita cada superfície produzida para reconhecimento. Antes
da renderização, o PDF.js ignora imagens incorporadas que excedam
`maxSourceImagePixels`. JPEG e PNG também são sondados e limitados antes da
decodificação completa, para reduzir o risco de bombas de descompressão.

A primeira tentativa visual mantém toda a imagem, na orientação EXIF declarada,
sem recorte ou filtro. Passagens seguintes, quando solicitadas, podem usar
recorte conservador de margens, redimensionamento limitado, escala de cinza,
contraste moderado e rotações discretas. Em imagens, o leitor de códigos também
usa leitura invertida e regiões candidatas. Essas transformações derivadas não
contam como ocorrências independentes.

A etapa de texto nativo existe somente em PDF e não conta como passagem visual.

### Segurança e recursos

- Execução somente por CPU; nenhum backend de GPU é usado.
- A rede é usada apenas para baixar a URL de entrada. Após o download limitado,
  a extração é local: os bytes do documento não são enviados a serviço de OCR
  nem a outro processador externo.
- Os dados de idioma do OCR são carregados explicitamente do disco.
- Tamanho, páginas, dimensões e pixels de origem, pixels de renderização, itens
  de texto, tamanho do texto, prazo e cancelamento têm limites definidos.
- A execução de JavaScript em PDFs é desabilitada.
- Falhas esperadas voltam como JSON estruturado, sem expor buffers, URLs
  completas, cabeçalhos ou objetos internos.

Fotos inclinadas, desfocadas, amassadas, manchadas, com reflexo ou código
degradado podem retornar legitimamente `not_found`. Aumentar `passes` não
garante recuperação. O extrator não completa trechos ilegíveis, não cria uma
chave a partir de CNPJ, data ou número parcial, e só aceita uma correção de OCR
quando existe **uma única** alternativa integralmente válida.

---

## Referências normativas

- [MOC 7.0 - Visão Geral](https://www.confaz.fazenda.gov.br/legislacao/arquivo-manuais/moc7-visao-geral.pdf)
- [Nota Técnica Conjunta DFe 2025.001 - CNPJ alfanumérico](https://www.nfe.fazenda.gov.br/Portal/exibirArquivo.aspx?conteudo=5ZkvIZt10mQ%3D)
- [NT 2026.004 v1.01 - NF-e/NFC-e schemas](https://www.nfe.fazenda.gov.br/POrtal/exibirArquivo.aspx?AspxAutoDetectCookieSupport=1&conteudo=BTZQzgsO9Ws%3D)
