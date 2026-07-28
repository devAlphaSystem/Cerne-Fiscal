# Referência da API

Esta referência descreve os exports de `src/index.ts` e o contrato implementado pela versão `0.5.0`.

## Imports

```ts
import { ACCESS_KEY_ISSUE_CODES, calculateAccessKeyCheckDigit, extractNFCeAccessKeys, extractNFeAccessKeys, parseAccessKey, validateAccessKey, validateIssuerIdentifier } from "cerne-fiscal";
```

O pacote também exporta os tipos TypeScript listados em [Tipos públicos](#tipos-públicos).

## Funções de extração

```ts
function extractNFeAccessKeys(input: DocumentInput, options?: ExtractOptions): Promise<ExtractionResult<"55">>;

function extractNFCeAccessKeys(input: DocumentInput, options?: ExtractOptions): Promise<ExtractionResult<"65">>;
```

As funções compartilham o mesmo pipeline. A primeira só aceita resultados validados do modelo 55; a segunda, do modelo 65. Uma chave válida de outro modelo é descartada como candidata, não convertida.

Falhas de opção, entrada, download, parsing, deadline e processamento são representadas em `ExtractionResult.error`. O pipeline protege a resolução estruturada inclusive quando uma etapa de limpeza falha. Ainda é recomendável que uma aplicação mantenha seu limite normal de tratamento de exceções para falhas externas ao contrato, como indisponibilidade catastrófica do runtime.

## `DocumentInput`

```ts
type DocumentInput = string | ArrayBuffer | Uint8Array;
type PdfInput = DocumentInput; // alias de compatibilidade
```

Interpretação da entrada:

| Valor                                         | Comportamento                       |
| --------------------------------------------- | ----------------------------------- |
| `string` iniciada por `http://` ou `https://` | download remoto                     |
| outra `string` sem esquema URI                | caminho de arquivo local            |
| caminho Windows com letra de unidade          | caminho local, não URL              |
| `ArrayBuffer`                                 | os bytes são copiados e validados   |
| `Uint8Array`                                  | os bytes são copiados e validados   |
| `Buffer`                                      | aceito porque herda de `Uint8Array` |

URLs com credenciais embutidas são rejeitadas. Esquemas diferentes de HTTP(S), entradas vazias, diretórios e tipos não previstos produzem erro estruturado. O formato real é detectado pela assinatura dos bytes; a extensão do arquivo e o `Content-Type` remoto não determinam o parser.

Formatos reconhecidos:

- PDF, pela presença de `%PDF-` nos primeiros 1.024 bytes;
- PNG, pela assinatura completa de oito bytes;
- JPEG, pelo início `FF D8 FF`.

## `ExtractOptions`

Todas as opções são opcionais. O perfil padrão é `balanced`.

| Opção                  | Tipo                                 | Padrão                            | Faixa/regras          | Efeito                                                                      |
| ---------------------- | ------------------------------------ | --------------------------------- | --------------------- | --------------------------------------------------------------------------- |
| `performance`          | `"fast" \| "balanced" \| "accurate"` | `"balanced"`                      | valor fechado         | escolhe os defaults e as receitas de renderização                           |
| `passes`               | `number` inteiro                     | 1 / 2 / 3 por perfil              | 1 a 5                 | limita quantas receitas ordenadas de render/reconhecimento podem ser usadas |
| `ocr`                  | `"never" \| "fallback" \| "always"`  | `never` / `fallback` / `fallback` | valor fechado         | desativa, usa apenas em páginas sem evidência ou força OCR                  |
| `maxPages`             | `number` inteiro                     | 10 / 30 / 50                      | 1 a 10.000            | processa somente as primeiras páginas                                       |
| `maxFileSizeBytes`     | `number` inteiro                     | 31.457.280 (30 MiB)               | 1 a 1.073.741.824     | limita entrada local, remota ou em memória                                  |
| `maxPixelsPerPage`     | `number` inteiro                     | 8M / 12M / 20M                    | 250.000 a 100.000.000 | limita a área de cada canvas renderizado                                    |
| `maxSourceImagePixels` | `number` inteiro                     | 40M / 60M / 100M                  | 250.000 a 200.000.000 | limita a área declarada/decodificada da imagem-fonte e imagens do PDF       |
| `timeoutMs`            | `number` inteiro                     | 30.000 / 120.000 / 300.000        | 0 a 3.600.000         | deadline total; zero desativa o timeout                                     |
| `stopAfterFirst`       | `boolean`                            | `false`                           | booleano real         | encerra etapas adicionais depois da primeira chave válida                   |
| `requestHeaders`       | `Readonly<Record<string, string>>`   | ausente                           | somente URL HTTP(S)   | adiciona cabeçalhos à requisição remota                                     |
| `signal`               | `AbortSignal`                        | ausente                           | objeto compatível     | cancela download e impede novas etapas de reconhecimento                    |

Os valores separados por `/` correspondem a `fast`, `balanced` e `accurate`, nessa ordem. Uma opção explícita substitui somente o default correspondente; por exemplo, `performance: "fast", ocr: "always"` é uma combinação aceita.

### Perfis resolvidos

| Perfil     | `passes` | `ocr`      | `maxPages` | `maxPixelsPerPage` | `maxSourceImagePixels` | `timeoutMs` |
| ---------- | -------: | ---------- | ---------: | -----------------: | ---------------------: | ----------: |
| `fast`     |        1 | `never`    |         10 |          8.000.000 |             40.000.000 |      30.000 |
| `balanced` |        2 | `fallback` |         30 |         12.000.000 |             60.000.000 |     120.000 |
| `accurate` |        3 | `fallback` |         50 |         20.000.000 |            100.000.000 |     300.000 |

### Semântica de OCR e passes

- `never`: o pipeline usa texto de PDF e códigos de barras, sem criar worker do Tesseract.
- `fallback`: o OCR recebe apenas páginas que ainda não possuem evidência válida.
- `always`: o OCR recebe as páginas processadas mesmo se texto ou barcode já tiverem encontrado uma chave.
- em PDF, o OCR escolhe a receita não rotacionada de maior escala disponível; no perfil `accurate`, também percorre receitas rotacionadas habilitadas;
- em JPEG/PNG, as receitas incluem tentativas sem transformação, redução/contraste/tons de cinza/crop e rotações conforme o número de passes;
- `passes` não promete que todas as tentativas serão executadas: uma chave, deduplicação de geometria ou ausência de páginas pendentes pode encerrar o caminho antes.

### Cabeçalhos remotos

`requestHeaders`:

- precisa ser um objeto simples ou de protótipo nulo;
- aceita somente valores string e nomes/valores válidos para HTTP;
- normaliza nomes para minúsculas;
- rejeita nomes duplicados sem distinguir caixa;
- só pode acompanhar uma URL HTTP(S);
- é removido quando um redirect muda a origem;
- não pode sobrescrever `accept-encoding`, `connection`, `content-length`, `expect`, `host`, `if-range`, `keep-alive`, `proxy-connection`, `range`, `te`, `trailer`, `transfer-encoding` ou `upgrade`.

O loader define `accept-encoding: identity`, segue no máximo cinco redirects e rejeita respostas não 2xx.

## `ExtractionResult<TModel>`

```ts
interface ExtractionResult<TModel extends "55" | "65"> {
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

### Estados

| `status`    | Significado                                                                                    |
| ----------- | ---------------------------------------------------------------------------------------------- |
| `success`   | há resultado e todo o escopo elegível foi concluído                                            |
| `not_found` | o escopo foi concluído, mas nenhuma chave válida do modelo solicitado foi encontrada           |
| `partial`   | o escopo foi truncado ou ocorreu falha depois de alguma evidência; pode ou não haver resultado |
| `error`     | ocorreu falha e nenhuma chave foi preservada                                                   |

`success` não é um espelho de `status === "success"`; ele vale `results.length > 0`. Uma resposta `partial` com chave tem `success: true`. Avalie `status`, `success`, `warnings` e `error` de acordo com a necessidade do negócio.

`precisionScore` no nível da resposta é o menor score entre todos os itens retornados, arredondado para três casas. É zero sem resultados. `bestMatch` é o primeiro item de `results`, que é ordenado pelo maior score e, em empate, pela primeira página.

### `ExtractedAccessKey`

Cada item contém:

| Campo            | Significado                                                    |
| ---------------- | -------------------------------------------------------------- |
| `accessKey`      | chave normalizada com 44 caracteres                            |
| `documentType`   | `"NFe"` ou `"NFCe"`                                            |
| `model`          | `"55"` ou `"65"`, já estreitado pela função chamada            |
| `format`         | `"numeric"` ou `"alphanumeric"`                                |
| `isValid`        | sempre `true` para resultados emitidos                         |
| `precisionScore` | confiança consolidada, de 0 a 1                                |
| `pages`          | páginas distintas, em ordem crescente, indexadas a partir de 1 |
| `sources`        | fontes distintas em ordem canônica                             |
| `occurrences`    | evidências distintas após deduplicação por página e fonte      |
| `components`     | campos posicionais já analisados da chave                      |

Fontes possíveis:

- `pdf-text`;
- `pdf-text-reconstructed`;
- `code128`;
- `qr-code`;
- `ocr`.

### Componentes da chave

`components` contém `stateCode`, `yearMonth`, `year`, `month`, `issuerId`, `model`, `documentType`, `series`, `invoiceNumber`, `emissionType`, `numericCode` e `checkDigit`, além da chave e do formato. O ano permanece com dois dígitos e nenhum século é inferido.

### Metadados

| Campo                                       | Interpretação                                                                      |
| ------------------------------------------- | ---------------------------------------------------------------------------------- |
| `performance` / `ocrMode`                   | configuração efetiva                                                               |
| `inputFormat`                               | assinatura detectada; ausente se o carregamento falhou antes da detecção           |
| `passesRequested`                           | número configurado                                                                 |
| `passesUsed`                                | maior índice de pass alcançado pelo leitor de barcode                              |
| `pagesTotal`                                | total declarado pelo documento                                                     |
| `pagesProcessed`                            | páginas visitadas na fase de texto nativo; imagens contam como uma página visitada |
| `pagesRendered`                             | páginas distintas que tiveram ao menos um render efetivamente analisado            |
| `renderAttempts`                            | número de tentativas de render, incluindo renders reutilizados pelo OCR            |
| `ocrPages`                                  | páginas distintas enviadas ao OCR                                                  |
| `fileSizeBytes`                             | bytes carregados                                                                   |
| `sourceImageWidth` / `sourceImageHeight`    | dimensões decodificadas para JPEG/PNG; ausentes em PDF                             |
| `maxPixelsPerPage` / `maxSourceImagePixels` | limites efetivos                                                                   |
| `durationMs`                                | duração monotônica total, em milissegundos                                         |
| `complete`                                  | se o escopo elegível terminou sem truncamento                                      |
| `confidenceVersion`                         | contrato de scoring; atualmente `"1.0.0"`                                          |

Quando `maxPages` corta um PDF, `complete` é falso e `warnings` registra quantas páginas foram processadas. Quando `stopAfterFirst` encontra uma chave, a interrupção é intencional e `complete` é marcado como verdadeiro.

## Códigos de erro de extração

| Código               | Situações representadas                                                                                               |
| -------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `INVALID_INPUT`      | entrada vazia/tipo inválido, caminho não-arquivo, URL inválida, leitura local recusada ou argumentos inválidos na CLI |
| `FILE_NOT_FOUND`     | caminho local inexistente                                                                                             |
| `FILE_TOO_LARGE`     | tamanho conhecido ou lido excede `maxFileSizeBytes`                                                                   |
| `DOWNLOAD_ERROR`     | falha de rede, resposta sem body, status HTTP não 2xx ou redirect inválido/excessivo                                  |
| `INVALID_OPTIONS`    | valor fora da faixa, combinação inválida, cabeçalho ou signal inválido                                                |
| `INVALID_PDF`        | PDF não pode ser parseado ou tem geometria inválida                                                                   |
| `UNSUPPORTED_FORMAT` | assinatura não corresponde a PDF/JPEG/PNG                                                                             |
| `INVALID_IMAGE`      | estrutura PNG/JPEG truncada/malformada ou decodificação inválida                                                      |
| `PASSWORD_REQUIRED`  | PDF criptografado exige senha; não há opção de senha                                                                  |
| `TIMEOUT`            | deadline total excedido                                                                                               |
| `ABORTED`            | `AbortSignal` do chamador foi abortado                                                                                |
| `RESOURCE_LIMIT`     | limites de dimensão, área, memória ou volume de texto foram excedidos                                                 |
| `PROCESSING_ERROR`   | falha inesperada de processamento não classificada em categoria mais específica                                       |

As mensagens atuais são em inglês e evitam incluir a entrada bruta ou a causa interna. Use `error.code` para decisões de programa, não comparação textual de `message`.

## Funções de validação

### `validateAccessKey(value)`

```ts
const validation = validateAccessKey("35260712345678000195550010000000011123456784");

if (!validation.isValid) {
  console.log(validation.issues);
}
```

Não lança por chave inválida. Retorna valor normalizado, formato detectado, componentes quando parseáveis, dígito esperado e todas as violações em ordem determinística.

Regras verificadas:

- formato suportado de 44 caracteres;
- código de UF presente no conjunto oficial incorporado;
- mês entre `01` e `12`;
- modelo 55 ou 65;
- número da nota diferente de `000000000`;
- identificador de emitente como CNPJ válido, inclusive base alfanumérica aceita pelo formato, ou CPF válido com três zeros à esquerda;
- dígito geral módulo 11.

O validador não consulta cadastros externos e não confirma existência, autorização, cancelamento ou situação fiscal.

Problemas possíveis em `issues`:

- `INVALID_FORMAT`;
- `INVALID_CHECK_DIGIT`;
- `INVALID_MODEL`;
- `INVALID_STATE_CODE`;
- `INVALID_MONTH`;
- `INVALID_ISSUER_IDENTIFIER`;
- `INVALID_INVOICE_NUMBER`.

Os mesmos valores estão em `ACCESS_KEY_ISSUE_CODES`.

### `parseAccessKey(value)`

Analisa posições fixas e normaliza para maiúsculas, mas não afirma validade semântica. Lança `TypeError` se o valor não corresponder a um dos formatos estruturais de 44 caracteres. Para validar e analisar de uma vez, prefira `validateAccessKey`.

### `calculateAccessKeyCheckDigit(body)`

Calcula o dígito módulo 11 de um corpo suportado com exatamente 43 caracteres. Lança `TypeError` para corpo incompatível.

### `validateIssuerIdentifier(value)`

Retorna booleano para um identificador de 14 caracteres que seja CNPJ válido ou CPF válido precedido de `000`. Valores são normalizados para maiúsculas.

## Confiança e ordenação

O contrato de confiança `1.0.0` usa scores-base:

| Fonte              |     Base |
| ------------------ | -------: |
| QR Code            |    0,995 |
| Code 128           |    0,995 |
| texto nativo       |    0,985 |
| texto reconstruído |    0,970 |
| OCR                | variável |

No OCR, o score parte da confiança do Tesseract, fica pelo menos em 0,75, recebe bônus por contexto de rótulo e penalidade por correção. Texto de PDF próximo a “CHAVE DE ACESSO”/“ACCESS KEY” recebe pequeno bônus. Evidência em mais de uma família independente (texto, barcode, OCR) recebe bônus limitado, com teto final de 0,999.

O score mede a força da evidência de extração, não a situação fiscal nem a probabilidade estatística de autorização da nota. Alterações na fórmula devem incrementar `confidenceVersion`.

## Tipos públicos

Exports de validação:

- `AccessKeyComponents`;
- `AccessKeyDocumentType`;
- `AccessKeyDocumentTypeForModel`;
- `AccessKeyFormat`;
- `AccessKeyIssue`;
- `AccessKeyIssueCode`;
- `AccessKeyModel`;
- `AccessKeyValidation`.

Exports de extração:

- `DocumentFormat`;
- `DocumentInput`;
- `ExtractOptions`;
- `ExtractedAccessKey`;
- `ExtractionErrorCode`;
- `ExtractionErrorInfo`;
- `ExtractionMetadata`;
- `ExtractionResult`;
- `ExtractionSource`;
- `ExtractionStatus`;
- `OcrMode`;
- `PdfInput`;
- `PerformanceProfile`.

## Referências no código

- superfície pública: `src/index.ts`;
- tipos: `src/types.ts`;
- orquestração: `src/extractor.ts`;
- defaults e validação de opções: `src/options.ts`;
- carregamento de entrada: `src/document/load-input.ts`;
- validação fiscal: `src/validation/access-key.ts`;
- consolidação e confiança: `src/scoring/merge-results.ts`.
