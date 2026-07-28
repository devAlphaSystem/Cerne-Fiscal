# Cerne Fiscal

Biblioteca e ferramenta de linha de comando para localizar, validar e classificar chaves de acesso de NF-e (modelo 55) e NFC-e (modelo 65) em documentos PDF, JPEG e PNG. As entradas podem ser caminhos locais, URLs HTTP(S), bytes em memória, `Readable` do Node.js ou qualquer `AsyncIterable<Uint8Array>`; o processamento usa CPU e combina texto nativo de PDF, Code 128, QR Code e OCR.

O pacote atual é `cerne-fiscal` versão `0.6.0`, requer Node.js 20 ou superior e publica interfaces ESM, CommonJS e TypeScript.

## Escopo

O Cerne Fiscal:

- detecta o formato pelo conteúdo do arquivo, sem confiar na extensão;
- extrai chaves contíguas ou separadas no texto nativo do PDF;
- reconstrói linhas visuais de PDFs quando a ordem do stream não representa a leitura humana;
- renderiza páginas para procurar Code 128 e QR Code;
- usa OCR como fallback ou de forma obrigatória, conforme a configuração;
- aceita o formato numérico tradicional e o segmento de emitente alfanumérico previsto pelo validador;
- valida UF, mês, modelo, identificador do emitente, número da nota e dígito verificador;
- retorna resultados estruturados, fontes da evidência, páginas, confiança, métricas, avisos e erros estáveis.

O pacote não consulta SEFAZ, não verifica autorização ou situação atual de uma nota, não lê XML fiscal e não inicia servidor. Uma chave retornada é estrutural e semanticamente válida de acordo com as regras implementadas; isso não comprova a existência ou a validade jurídica do documento.

## Instalação

Em um projeto consumidor:

```bash
npm install cerne-fiscal
```

O runtime exige Node.js `>=20`. Consulte [Instalação e desenvolvimento](docs/INSTALACAO.md) para uso a partir do código-fonte, build, distribuição e dependências nativas.

## Uso rápido da API

```ts
import { extractNFeAccessKeys } from "cerne-fiscal";

const extraction = await extractNFeAccessKeys("./danfe.pdf", {
  performance: "balanced",
  stopAfterFirst: true,
});

if (extraction.success) {
  console.log(extraction.bestMatch?.accessKey);
} else {
  console.error(extraction.error ?? extraction.status);
}
```

Para NFC-e, use `extractNFCeAccessKeys`. As duas funções aceitam caminho, URL HTTP(S), `ArrayBuffer`, `Uint8Array`, `Buffer` (por herança), `Readable` e qualquer `AsyncIterable<Uint8Array>`.

### Entrada em stream

```js
const result = await extractNFeAccessKeys(readable, {
  streamStorage: "auto",
  streamMemoryThresholdBytes: 1024 * 1024,
  maxFileSizeBytes: 25 * 1024 * 1024,
  signal,
});
```

`streamStorage` decide onde os bytes ficam enquanto o stream é consumido: `memory` acumula na memória do processo, `file` grava cada bloco em um temporário do extrator e `auto` (padrão) começa na memória e migra para um temporário ao ultrapassar `streamMemoryThresholdBytes`. A política vale apenas para streams; `Buffer`, `Uint8Array` e `ArrayBuffer` já estão na memória e nunca vão para disco. Temporários criados pelo extrator são removidos ao fim da chamada, inclusive em erro, timeout, aborto e `not_found`. Detalhes em [API](docs/API.md#entradas-em-stream).

## Uso rápido da CLI

```bash
cerne-fiscal ./nota.pdf --document-type nfe --pretty
cerne-fiscal ./cupom.jpg --document-type nfce --performance accurate --first
```

A CLI escreve exatamente um documento JSON em `stdout`. O código de saída é `0` quando há resultado (ou na ajuda), `2` quando a extração termina sem encontrar chave e `1` nos demais erros. Veja todas as opções em [CLI](docs/CLI.md).

## Pipeline de extração

O fluxo percorre, nesta ordem:

1. validação das opções;
2. leitura limitada da entrada e detecção de assinatura;
3. abertura como PDF ou imagem de página única;
4. busca no texto nativo e nas linhas reconstruídas do PDF;
5. renderização e leitura de Code 128/QR Code nas páginas ainda relevantes;
6. OCR conforme `ocr: "never" | "fallback" | "always"`;
7. revalidação fiscal, deduplicação, cálculo de confiança e ordenação.

Somente chaves válidas do modelo solicitado chegam a `results`. Recursos de página, canvas, worker de OCR, documento e timeout são liberados ao final da chamada, inclusive em falhas.

## Perfis

| Perfil     | Passes padrão | OCR padrão | Páginas padrão | Pixels por página | Pixels da imagem-fonte | Timeout |
| ---------- | ------------: | ---------- | -------------: | ----------------: | ---------------------: | ------: |
| `fast`     |             1 | `never`    |             10 |         8.000.000 |             40.000.000 |    30 s |
| `balanced` |             2 | `fallback` |             30 |        12.000.000 |             60.000.000 |   120 s |
| `accurate` |             3 | `fallback` |             50 |        20.000.000 |            100.000.000 |   300 s |

O padrão é `balanced`. Todos os limites podem ser sobrescritos dentro das faixas aceitas; `maxFileSizeBytes` tem padrão de 30 MiB em todos os perfis. Mais passes e OCR aumentam consumo de CPU, memória e latência.

## Resultado

As funções de extração resolvem um `ExtractionResult` com quatro estados:

- `success`: uma ou mais chaves foram encontradas e o escopo configurado foi concluído;
- `not_found`: o processamento terminou sem chave válida;
- `partial`: houve chave antes de uma falha ou o escopo foi truncado, por exemplo por `maxPages`;
- `error`: nenhuma chave foi preservada e ocorreu uma falha.

`success` é um booleano independente do campo `status`: ele é verdadeiro sempre que `results` contém ao menos uma chave, inclusive em uma resposta `partial`. O consumidor deve avaliar ambos.

## API pública

Além das funções de extração, o pacote exporta:

- `validateAccessKey`;
- `parseAccessKey`;
- `calculateAccessKeyCheckDigit`;
- `validateIssuerIdentifier`;
- `ACCESS_KEY_ISSUE_CODES`;
- os tipos TypeScript da entrada, opções, resultados, componentes, problemas de validação e metadados.

O contrato completo, os limites, os códigos de erro e a interpretação da confiança estão em [API](docs/API.md).

## Documentação

- [Instalação e desenvolvimento](docs/INSTALACAO.md)
- [Referência da API](docs/API.md)
- [Referência da CLI](docs/CLI.md)
- [Exemplos de integração](docs/EXEMPLOS.md)
- [Benchmark](bench/README.md)

## Desenvolvimento

Os scripts declarados no projeto cobrem verificação de tipos, lint, formatação, build, auditoria e benchmark. O fluxo consolidado é `npm run check`; o CI executa verificação de tipos, lint, formatação e build em Node.js 20, 22 e 24, além de uma auditoria separada em Node.js 22.

As fixtures sintéticas e determinísticas em `bench/` verificam regressões de resultado e desempenho, mas o benchmark não faz parte do workflow de CI atual.

## Licença

MIT. Consulte [LICENSE](LICENSE).
