# Exemplos de integração

Os exemplos usam apenas a API pública de `cerne-fiscal`. Ajuste caminhos, URLs e políticas de recurso ao ambiente da aplicação.

## NF-e a partir de arquivo local

```ts
import { extractNFeAccessKeys } from "cerne-fiscal";

const result = await extractNFeAccessKeys("./documentos/danfe.pdf");

switch (result.status) {
  case "success":
    console.log(result.bestMatch?.accessKey);
    break;
  case "not_found":
    console.log("Nenhuma chave de NF-e válida foi encontrada.");
    break;
  case "partial":
    console.log("Processamento parcial", result.results, result.error);
    break;
  case "error":
    console.error(result.error);
    break;
}
```

Uma chamada de NF-e descarta chaves válidas do modelo 65. Use a função correspondente ao documento esperado.

## NFC-e a partir de imagem

```ts
import { extractNFCeAccessKeys } from "cerne-fiscal";

const result = await extractNFCeAccessKeys("./imagens/cupom.jpg", {
  performance: "accurate",
  ocr: "fallback",
  stopAfterFirst: true,
});

if (result.success) {
  const match = result.bestMatch;
  console.log({
    accessKey: match?.accessKey,
    page: match?.pages[0],
    sources: match?.sources,
    confidence: match?.precisionScore,
  });
}
```

JPEG e PNG são tratados como documentos de uma página. Orientação EXIF de JPEG é considerada na renderização.

## Bytes em memória

### `Buffer`

```ts
import { readFile } from "node:fs/promises";
import { extractNFeAccessKeys } from "cerne-fiscal";

const bytes = await readFile("./nota.pdf");
const result = await extractNFeAccessKeys(bytes, {
  maxFileSizeBytes: 20 * 1024 * 1024,
});
```

`Buffer` funciona por ser uma subclasse de `Uint8Array`. A biblioteca copia a entrada antes de processá-la, evitando depender de mutações posteriores do chamador.

### `ArrayBuffer` e `Uint8Array`

```ts
import { extractNFeAccessKeys } from "cerne-fiscal";

async function inspectUpload(upload: ArrayBuffer) {
  return extractNFeAccessKeys(upload, {
    maxFileSizeBytes: 10 * 1024 * 1024,
    maxPages: 3,
    timeoutMs: 30_000,
  });
}
```

O formato é inferido dos bytes, não do nome fornecido pelo upload.

## URL pública

```ts
import { extractNFeAccessKeys } from "cerne-fiscal";

const result = await extractNFeAccessKeys("https://documents.example/notas/123.pdf", {
  timeoutMs: 60_000,
  maxFileSizeBytes: 15 * 1024 * 1024,
});
```

O download aceita somente HTTP(S), segue até cinco redirects, rejeita status não 2xx e interrompe o corpo assim que o limite configurado é excedido.

## URL autenticada

```ts
import { extractNFeAccessKeys } from "cerne-fiscal";

const result = await extractNFeAccessKeys("https://documents.example/private/nota.pdf", {
  requestHeaders: {
    authorization: `Bearer ${process.env.DOCUMENT_TOKEN ?? ""}`,
  },
});
```

Não inclua credenciais na URL. Cabeçalhos do chamador são removidos se um redirect mudar a origem. Mesmo assim, valide URLs não confiáveis antes da chamada e restrinja acesso de rede; a biblioteca não implementa allowlist de hosts ou bloqueio de endereços internos.

## Cancelamento pelo chamador

```ts
import { extractNFeAccessKeys } from "cerne-fiscal";

const controller = new AbortController();
const extraction = extractNFeAccessKeys("https://documents.example/nota.pdf", {
  signal: controller.signal,
  timeoutMs: 0,
});

const timer = setTimeout(() => controller.abort(), 10_000);
try {
  const result = await extraction;
  if (result.error?.code === "ABORTED") {
    console.log("Extração cancelada pelo chamador.");
  }
} finally {
  clearTimeout(timer);
}
```

O sinal é conectado diretamente ao download e verificado entre etapas de reconhecimento. Uma chamada nativa ou OCR já em execução pode só observar o cancelamento ao devolver o controle ao pipeline.

## Deadline interno

```ts
const result = await extractNFeAccessKeys("./nota.pdf", {
  performance: "balanced",
  timeoutMs: 45_000,
});

if (result.error?.code === "TIMEOUT") {
  console.error("A extração excedeu 45 segundos.");
}
```

O timeout mede a chamada completa, inclusive carregamento, parsing e inicializações. O valor `0` desativa a deadline e deve ser usado com cautela para entradas não confiáveis.

## Limitar recursos para upload não confiável

```ts
const result = await extractNFeAccessKeys(uploadBytes, {
  performance: "fast",
  ocr: "never",
  maxPages: 2,
  maxFileSizeBytes: 8 * 1024 * 1024,
  maxPixelsPerPage: 4_000_000,
  maxSourceImagePixels: 20_000_000,
  timeoutMs: 20_000,
  stopAfterFirst: true,
});
```

Esse perfil reduz exposição a documentos custosos, mas pode diminuir recuperação em scans ruins. Limites de aplicação, concorrência e isolamento de processo continuam sendo responsabilidade do integrador.

## Tratar resultado parcial

```ts
const result = await extractNFeAccessKeys("./lote.pdf", {
  maxPages: 5,
});

if (result.status === "partial") {
  if (result.success) {
    console.log("Chaves encontradas antes do corte:", result.results);
  }
  console.warn(result.warnings);
  console.warn(result.error);
}
```

Um corte por `maxPages` gera warning e não necessariamente `error`. Uma falha depois de evidência pode preencher `error` e ainda manter `success: true`.

## Percorrer todas as chaves

```ts
const result = await extractNFeAccessKeys("./lote.pdf", {
  stopAfterFirst: false,
  maxPages: 100,
});

for (const item of result.results) {
  console.log({
    key: item.accessKey,
    pages: item.pages,
    sources: item.sources,
    occurrences: item.occurrences,
    score: item.precisionScore,
  });
}
```

Os resultados vêm em confiança decrescente; empates usam a primeira página. `occurrences` conta evidências deduplicadas por página e fonte, não cada match bruto do parser.

## Validar uma chave sem documento

```ts
import { validateAccessKey } from "cerne-fiscal";

const validation = validateAccessKey("35260712345678000195550010000000011123456784");

if (validation.isValid) {
  console.log(validation.components);
} else {
  for (const issue of validation.issues) {
    console.error(issue.code, issue.message);
  }
}
```

`validateAccessKey` não lança para chave inválida. Ele não faz consulta externa.

## Analisar campos quando o formato já é confiável

```ts
import { parseAccessKey } from "cerne-fiscal";

try {
  const components = parseAccessKey("35260712345678000195550010000000011123456784");
  console.log(components.model, components.invoiceNumber);
} catch (error) {
  console.error("Formato incompatível", error);
}
```

`parseAccessKey` pode retornar componentes semanticamente inválidos e lança para estrutura não suportada. Para dados externos, valide primeiro.

## Calcular o dígito geral

```ts
import { calculateAccessKeyCheckDigit } from "cerne-fiscal";

const body = "3526071234567800019555001000000001112345678";
const digit = calculateAccessKeyCheckDigit(body);
console.log(`${body}${digit}`);
```

O corpo precisa ter exatamente 43 caracteres no formato suportado.

## CommonJS

```js
const { extractNFeAccessKeys } = require("cerne-fiscal");

async function main() {
  const result = await extractNFeAccessKeys("./nota.pdf");
  console.log(result.bestMatch?.accessKey ?? null);
}

void main();
```

## CLI

```bash
cerne-fiscal ./nota.pdf --document-type nfe --pretty
cerne-fiscal ./cupom.png --document-type nfce --ocr always --first
```

Veja opções, JSON e códigos de saída em [CLI](CLI.md).

## Padrão recomendado de integração

Em serviços que recebem documentos de terceiros:

1. autentique e autorize antes de aceitar o documento;
2. limite tamanho no transporte e novamente em `maxFileSizeBytes`;
3. prefira bytes já baixados quando a URL vem de usuário não confiável;
4. use deadline, limite de páginas/pixels e controle de concorrência;
5. trate `partial` de forma explícita;
6. não registre `requestHeaders`, documento bruto ou resultado fiscal sem necessidade;
7. valide o modelo adequado ao contexto;
8. monitore `error.code`, duração, páginas renderizadas e páginas de OCR.

Antes de expor a extração em uma API pública, aplique essas medidas junto às políticas de segurança, observabilidade e operação do serviço integrador.
