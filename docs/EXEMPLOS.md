# Exemplos

Receitas prontas para os usos mais comuns. A referência dos tipos está em
[API.md](API.md).

## Sumário

- [Extração básica](#extração-básica)
- [Escolhendo o perfil](#escolhendo-o-perfil)
- [Entradas em memória](#entradas-em-memória)
- [URLs e autenticação](#urls-e-autenticação)
- [Processando vários documentos](#processando-vários-documentos)
- [Cancelamento e prazo](#cancelamento-e-prazo)
- [Lendo o resultado com segurança](#lendo-o-resultado-com-segurança)
- [Tratamento de erros](#tratamento-de-erros)
- [Usando os componentes da chave](#usando-os-componentes-da-chave)
- [Validação sem documento](#validação-sem-documento)
- [Integrações](#integrações)

---

## Extração básica

```ts
import { extractNFCeAccessKeys, extractNFeAccessKeys } from "cerne-fiscal";

const nfe = await extractNFeAccessKeys("./danfe.pdf");

if (nfe.success) {
  console.log(nfe.bestMatch.accessKey); // 44 caracteres
  console.log(nfe.bestMatch.documentType); // "NFe"
  console.log(nfe.bestMatch.model); // "55"
}

const nfce = await extractNFCeAccessKeys("./cupom.jpg");
```

Em CommonJS:

```js
const { extractNFeAccessKeys } = require("cerne-fiscal");

extractNFeAccessKeys("./danfe.pdf").then((result) => {
  console.log(JSON.stringify(result, null, 2));
});
```

Cada função procura **exclusivamente** o seu modelo. Uma DANFE de NF-e passada
para `extractNFCeAccessKeys` termina em `not_found`, não em erro.

## Escolhendo o perfil

```ts
// DANFE gerada por sistema, com texto nativo: o mais barato resolve.
const rapido = await extractNFeAccessKeys("./danfe-sistema.pdf", {
  performance: "fast",
});

// Foto de cupom: vale gastar em rotações e OCR.
const foto = await extractNFCeAccessKeys("./foto-cupom.jpg", {
  performance: "accurate",
  passes: 5,
});

// Digitalização sem camada de texto: force o OCR mesmo no perfil rápido.
const digitalizado = await extractNFeAccessKeys("./scan.pdf", {
  performance: "fast",
  ocr: "always",
});
```

Quando quiser **verificação cruzada** — que o código de barras confirme o que o
texto já disse —, use `accurate`: ele executa as passagens de código mesmo com a
chave já encontrada em texto. `fast` e `balanced` param antes.

```ts
const cruzado = await extractNFeAccessKeys("./danfe.pdf", { performance: "accurate" });
const confirmada = cruzado.bestMatch?.sources.length > 1;
```

## Entradas em memória

```ts
import { readFile } from "node:fs/promises";
import { extractNFeAccessKeys } from "cerne-fiscal";

const bytes = await readFile("./danfe.pdf");
const result = await extractNFeAccessKeys(bytes); // Buffer é Uint8Array
```

Vindo de um upload HTTP, sem tocar no disco:

```ts
app.post("/notas", async (request, reply) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request.raw) {
    chunks.push(chunk);
  }

  const result = await extractNFeAccessKeys(Buffer.concat(chunks), {
    performance: "balanced",
    maxFileSizeBytes: 10 * 1024 * 1024,
    timeoutMs: 60_000,
  });

  return reply.code(result.success ? 200 : 422).send(result);
});
```

O formato é detectado pelos bytes, então não é preciso confiar no nome do
arquivo nem no `Content-Type` enviado pelo cliente.

## URLs e autenticação

```ts
// URL pública
const publico = await extractNFCeAccessKeys("https://documents.example.com/public/cupom.png");

// URL autenticada — requestHeaders existe apenas na API
const privado = await extractNFeAccessKeys("https://documents.example.com/private/danfe.pdf", {
  requestHeaders: {
    Authorization: "Bearer <token>",
    "X-Tenant-Id": "acme",
  },
});
```

Os cabeçalhos sobrevivem a redirecionamentos de mesma origem e são descartados
quando a origem muda.

Quando a URL vem de terceiros, prefira baixar com um cliente sob seu controle e
entregar os bytes — o extrator não faz filtragem de SSRF:

```ts
const response = await fetch(urlValidadaPelaSuaPolitica, { redirect: "error" });
const bytes = new Uint8Array(await response.arrayBuffer());
const result = await extractNFeAccessKeys(bytes);
```

## Processando vários documentos

O pacote não expõe API de lote — cada chamada é um documento. Para paralelizar,
controle a concorrência no seu código:

```ts
async function extrairComLimite(caminhos: string[], limite = 4) {
  const resultados: ExtractionResult<"55">[] = new Array(caminhos.length);
  let proximo = 0;

  async function trabalhador() {
    while (proximo < caminhos.length) {
      const indice = proximo++;
      resultados[indice] = await extractNFeAccessKeys(caminhos[indice]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limite, caminhos.length) }, trabalhador));
  return resultados;
}
```

Cada extração já é limitada internamente por prazo e recursos, mas o OCR roda em
worker thread: concorrência alta demais degrada o tempo total em vez de melhorá-lo.

Quando o modelo do documento é desconhecido:

```ts
async function extrairQualquerModelo(entrada: DocumentInput) {
  const nfe = await extractNFeAccessKeys(entrada, { stopAfterFirst: true });
  if (nfe.success) return nfe;

  return extractNFCeAccessKeys(entrada, { stopAfterFirst: true });
}
```

## Cancelamento e prazo

```ts
const controller = new AbortController();
setTimeout(() => controller.abort(), 30_000);

const result = await extractNFeAccessKeys("./documento-grande.pdf", {
  signal: controller.signal,
});

if (result.error?.code === "ABORTED") {
  console.warn("cancelado pelo chamador");
}
```

Prazo interno, sem `AbortController`:

```ts
const result = await extractNFeAccessKeys("./documento.pdf", { timeoutMs: 15_000 });
// result.error?.code === "TIMEOUT" quando estoura
```

Ligando ao ciclo de vida de uma requisição HTTP:

```ts
app.post("/extrair", async (request, reply) => {
  const controller = new AbortController();
  request.raw.on("close", () => controller.abort());

  return extractNFeAccessKeys(request.body.url, { signal: controller.signal });
});
```

`timeoutMs` cobre download e extração em conjunto; `signal` cancela qualquer uma
das fases.

## Lendo o resultado com segurança

`status` e `success` respondem perguntas diferentes:

```ts
const result = await extractNFeAccessKeys("./danfe.pdf");

switch (result.status) {
  case "success":
    // Varredura completa, ao menos uma chave validada.
    break;
  case "not_found":
    // Varredura completa, nada encontrado. Não é erro.
    break;
  case "partial":
    // Encontrou algo, mas a varredura foi truncada ou falhou no meio.
    // result.success pode ser true aqui.
    console.warn(result.warnings);
    break;
  case "error":
    console.error(result.error);
    break;
}
```

O `precisionScore` do topo é o **menor** entre os resultados. Para avaliar o
melhor resultado isoladamente, use o dele:

```ts
const confiavel = result.bestMatch !== null && result.bestMatch.precisionScore >= 0.9;
```

Exigindo confirmação por fontes independentes:

```ts
const corroborada = result.results.filter((chave) => chave.sources.length > 1);
```

Distinguindo a origem da evidência:

```ts
const porCodigo = result.results.filter((chave) => chave.sources.some((fonte) => fonte === "code128" || fonte === "qr-code"));

const somenteOcr = result.results.filter((chave) => chave.sources.length === 1 && chave.sources[0] === "ocr");
```

Detectando truncamento por limite de páginas:

```ts
if (!result.metadata.complete) {
  console.warn("varredura incompleta:", result.warnings);
}
```

Documentos com mais de uma nota:

```ts
if (result.results.length > 1) {
  console.log(`${result.results.length} chaves distintas no documento`);
  for (const chave of result.results) {
    console.log(chave.accessKey, chave.pages, chave.precisionScore);
  }
}
```

## Tratamento de erros

A promise não é rejeitada por falha esperada — tudo chega em `result.error`:

```ts
const result = await extractNFeAccessKeys(entrada);

if (result.error) {
  switch (result.error.code) {
    case "PASSWORD_REQUIRED":
      return { motivo: "PDF protegido por senha" };
    case "FILE_TOO_LARGE":
    case "RESOURCE_LIMIT":
      return { motivo: "documento acima dos limites configurados" };
    case "TIMEOUT":
    case "ABORTED":
      return { motivo: "processamento interrompido", retentar: true };
    case "UNSUPPORTED_FORMAT":
      return { motivo: "envie PDF, JPEG ou PNG" };
    case "DOWNLOAD_ERROR":
      return { motivo: "não foi possível baixar a URL", retentar: true };
    default:
      return { motivo: result.error.message };
  }
}
```

Nenhum campo do resultado reproduz caminho, URL, string de consulta, buffer ou
valor de cabeçalho, então `result` pode ir para o log sem tratamento adicional.

## Usando os componentes da chave

```ts
const chave = result.bestMatch;
if (chave === null) return;

const { stateCode, year, month, issuerId, model, documentType, series, invoiceNumber, emissionType, numericCode, checkDigit } = chave.components;

console.log(`UF ${stateCode}, emissão ${month}/20${year}`);
console.log(`emitente ${issuerId}, nota ${invoiceNumber} série ${series}`);
console.log(`${documentType} modelo ${model}, DV ${checkDigit}`);
```

Distinguindo CNPJ de CPF no identificador do emitente:

```ts
const { issuerId } = chave.components;

if (issuerId.startsWith("000") && /^000\d{11}$/.test(issuerId)) {
  console.log("emitente pessoa física, CPF", issuerId.slice(3));
} else {
  console.log("emitente pessoa jurídica, CNPJ", issuerId);
}
```

Tratando o CNPJ alfanumérico:

```ts
if (chave.format === "alphanumeric") {
  // As 12 primeiras posições do emitente podem conter letras.
  // Nunca converta a chave para número: use sempre string.
}
```

Conferindo contra um pedido já conhecido:

```ts
function confere(result: ExtractionResult<"55">, esperada: string) {
  const encontrada = result.results.some((chave) => chave.accessKey === esperada.toUpperCase());
  return { ok: encontrada, confianca: result.bestMatch?.precisionScore ?? 0 };
}
```

A comparação precisa ser em maiúsculas: chaves são normalizadas assim.

## Validação sem documento

Os validadores são síncronos e não carregam PDF, canvas ou OCR:

```ts
import { validateAccessKey } from "cerne-fiscal";

const validacao = validateAccessKey("35260712345678000195550010000000011123456784");

if (validacao.isValid) {
  console.log(validacao.components.documentType); // "NFe"
  console.log(validacao.format); // "numeric"
} else {
  for (const issue of validacao.issues) {
    console.error(issue.code, issue.message);
  }
}
```

`validateAccessKey` aceita 55 e 65 indistintamente. Para restringir a um modelo:

```ts
function ehNFeValida(valor: string): boolean {
  const validacao = validateAccessKey(valor);
  return validacao.isValid && validacao.components?.model === "55";
}
```

Validando o que o usuário digitou:

```ts
import { ACCESS_KEY_ISSUE_CODES, validateAccessKey } from "cerne-fiscal";

const validacao = validateAccessKey(entradaDoFormulario.replace(/\s/g, ""));

if (!validacao.isValid) {
  const dvErrado = validacao.issues.some((issue) => issue.code === ACCESS_KEY_ISSUE_CODES.INVALID_CHECK_DIGIT);

  return dvErrado ? `Confira os dígitos: o DV deveria ser ${validacao.expectedCheckDigit}.` : validacao.issues[0].message;
}
```

Decompondo sem validar — útil para diagnóstico:

```ts
import { parseAccessKey } from "cerne-fiscal";

try {
  const componentes = parseAccessKey(valor);
  console.log(componentes.model, componentes.documentType); // documentType pode ser null
} catch {
  console.error("formato de 44 caracteres não reconhecido");
}
```

Validando um emitente isoladamente ou recalculando o DV:

```ts
import { calculateAccessKeyCheckDigit, validateIssuerIdentifier } from "cerne-fiscal";

validateIssuerIdentifier("12345678000195"); // CNPJ
validateIssuerIdentifier("00012345678901"); // CPF com zeros à esquerda

const dv = calculateAccessKeyCheckDigit(chaveCompleta.slice(0, 43));
console.log(dv === Number(chaveCompleta[43]));
```

## Integrações

### Fila de processamento com retentativa seletiva

```ts
const RETENTAVEIS = new Set(["DOWNLOAD_ERROR", "TIMEOUT", "PROCESSING_ERROR"]);

async function processar(job: { url: string; tentativas: number }) {
  const result = await extractNFeAccessKeys(job.url, {
    performance: job.tentativas === 0 ? "balanced" : "accurate",
    passes: job.tentativas === 0 ? 2 : 5,
    timeoutMs: 120_000,
  });

  if (result.success) {
    return result;
  }

  if (result.error && RETENTAVEIS.has(result.error.code) && job.tentativas < 3) {
    throw new Error(`retentar: ${result.error.code}`);
  }

  return result; // not_found e erros definitivos não voltam para a fila
}
```

### Escalonando o esforço

```ts
async function extrairComEscalada(entrada: DocumentInput) {
  const barato = await extractNFeAccessKeys(entrada, { performance: "fast" });
  if (barato.success) return barato;

  return extractNFeAccessKeys(entrada, {
    performance: "accurate",
    passes: 5,
    ocr: "always",
  });
}
```

### Conciliação com uma base própria

```ts
async function conciliar(caminho: string) {
  const result = await extractNFeAccessKeys(caminho, { performance: "balanced" });

  if (!result.success) {
    return { situacao: result.status, chave: null };
  }

  const chave = result.bestMatch;

  if (chave.precisionScore < 0.9 || chave.sources.length === 1) {
    return { situacao: "revisao_manual", chave: chave.accessKey };
  }

  return {
    situacao: "conciliado",
    chave: chave.accessKey,
    emitente: chave.components.issuerId,
    competencia: `20${chave.components.year}-${chave.components.month}`,
  };
}
```

Limiares como `0.9` são um ponto de partida, não um valor calibrado: meça
precisão e recall no seu próprio corpus antes de automatizar a decisão.
