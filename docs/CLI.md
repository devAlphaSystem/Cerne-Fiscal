# Referência da CLI

O binário `cerne-fiscal` expõe as duas rotas de extração da biblioteca como um comando que recebe um documento e escreve um único resultado JSON.

## Sintaxe

```text
cerne-fiscal <caminho-ou-url> --document-type nfe|nfce [opções]
```

Exemplos:

```bash
cerne-fiscal ./nota.pdf --document-type nfe --pretty
cerne-fiscal ./cupom.jpg --document-type nfce --performance balanced
cerne-fiscal https://documents.example/cupom.png --document-type nfce --pretty
```

A origem e `--document-type` são obrigatórios. A CLI aceita exatamente uma origem. Diferentemente da API, ela não recebe bytes em memória, `requestHeaders` nem `AbortSignal`.

## Opções

| Opção                 | Valor                            | Mapeamento/efeito                                        |
| --------------------- | -------------------------------- | -------------------------------------------------------- |
| `--document-type`     | `nfe` ou `nfce`                  | seleciona modelo 55 ou 65; obrigatória                   |
| `--performance`       | `fast`, `balanced` ou `accurate` | `performance`                                            |
| `--passes`            | inteiro                          | `passes`, validado depois na faixa 1 a 5                 |
| `--ocr`               | `never`, `fallback` ou `always`  | `ocr`                                                    |
| `--max-pages`         | inteiro                          | `maxPages`                                               |
| `--max-file-size`     | inteiro em bytes                 | `maxFileSizeBytes`                                       |
| `--max-pixels`        | inteiro                          | `maxPixelsPerPage`                                       |
| `--max-source-pixels` | inteiro                          | `maxSourceImagePixels`                                   |
| `--timeout-ms`        | inteiro em milissegundos         | `timeoutMs`; zero desativa deadline                      |
| `--first`             | sem valor                        | ativa `stopAfterFirst`                                   |
| `--pretty`            | sem valor                        | indenta o JSON com dois espaços                          |
| `--help`              | sem valor                        | imprime o descritor JSON da ajuda e encerra com código 0 |

Opções numéricas só aceitam dígitos não negativos no parser da CLI. As faixas completas são aplicadas pelo mesmo resolvedor da API. Assim, por exemplo, `--passes 0` passa pelo parser, mas resulta em `INVALID_OPTIONS` porque a API exige ao menos um pass.

## Ajuda

```bash
cerne-fiscal --help
```

A ajuda é JSON, não texto formatado. Ela contém `name`, `usage`, `inputFormats`, `examples` e `options`. A presença de `--help` retorna a ajuda antes de validar os demais argumentos.

## Saída

Sem `--pretty`, a saída é uma linha JSON compacta. Com `--pretty`, o mesmo objeto é indentado. O formato é `ExtractionResult`, documentado em [API](API.md).

Exemplo ilustrativo de uma resposta sem chave:

```json
{
  "status": "not_found",
  "success": false,
  "precisionScore": 0,
  "bestMatch": null,
  "results": [],
  "metadata": {
    "performance": "balanced",
    "ocrMode": "fallback",
    "inputFormat": "pdf",
    "passesRequested": 2,
    "passesUsed": 2,
    "pagesTotal": 1,
    "pagesProcessed": 1,
    "pagesRendered": 1,
    "renderAttempts": 3,
    "ocrPages": 1,
    "fileSizeBytes": 1024,
    "maxPixelsPerPage": 12000000,
    "maxSourceImagePixels": 60000000,
    "durationMs": 2500.4,
    "complete": true,
    "confidenceVersion": "1.0.0"
  },
  "warnings": [],
  "error": null
}
```

Os números são apenas ilustrativos; a forma dos campos segue o contrato real. Use os tipos exportados, não esse exemplo, como schema da integração.

## Códigos de saída

| Código | Condição                                                                     |
| -----: | ---------------------------------------------------------------------------- |
|    `0` | ajuda ou resposta com `success: true`                                        |
|    `2` | `status: "not_found"` sem resultado                                          |
|    `1` | argumentos inválidos, erro, timeout, abort ou resposta parcial sem resultado |

Uma resposta `partial` com ao menos uma chave usa código `0`, pois a CLI prioriza o booleano `success`. Se a distinção entre completa e parcial for relevante, sempre leia `status` e `metadata.complete`, mesmo quando o processo encerra com zero.

## Argumentos inválidos

Erros do parser são transformados em um `ExtractionResult` com:

- `status: "error"`;
- `success: false`;
- `error.code: "INVALID_INPUT"`;
- metadados padrão do perfil `balanced`;
- código de saída 1.

Casos cobertos incluem:

- origem ausente ou mais de uma origem;
- `--document-type` ausente ou diferente de `nfe`/`nfce`;
- opção desconhecida;
- valor ausente;
- valor numérico com sinal, decimal ou caracteres não numéricos.

Erros de opção reconhecida, mas fora da faixa, chegam como `INVALID_OPTIONS` pela camada de API.

## Exemplos por cenário

### NF-e em PDF com texto nativo

```bash
cerne-fiscal ./documentos/danfe.pdf --document-type nfe --performance fast --pretty
```

O perfil `fast` não usa OCR por padrão. É adequado quando o PDF tem texto utilizável ou código de barras legível.

### Foto de NFC-e com OCR

```bash
cerne-fiscal ./imagens/cupom.jpg --document-type nfce --performance accurate --ocr always --pretty
```

Esse comando tende a consumir mais CPU e memória. `accurate` não torna o resultado fiscal mais válido; ele amplia tentativas de reconhecimento.

### Limites explícitos

```bash
cerne-fiscal ./lote/nota.pdf \
  --document-type nfe \
  --max-pages 5 \
  --max-file-size 10485760 \
  --max-pixels 8000000 \
  --timeout-ms 45000
```

Quando o PDF tem mais páginas que `--max-pages`, a resposta é `partial`, `metadata.complete` é falso e `warnings` informa o corte.

### Primeira chave

```bash
cerne-fiscal ./nota.pdf --document-type nfe --first
```

`--first` reduz trabalho depois da primeira chave válida. Ele não garante qual chave será encontrada primeiro em documentos com várias chaves além da ordem do pipeline e das páginas.

### URL remota

```bash
cerne-fiscal https://documents.example/nota.pdf --document-type nfe --timeout-ms 60000
```

A CLI não possui opção para cabeçalhos de autorização. Para URLs autenticadas, use a API com `requestHeaders` ou faça o download em uma camada controlada e forneça um arquivo/bytes.

## Automação em shell

A CLI sempre escreve JSON em `stdout`; o código não usa um logger nem escreve progresso. Isso facilita captura por outra ferramenta, mas a saída contém chaves e componentes fiscais. Trate o arquivo ou log resultante como dado potencialmente sensível.

Exemplo conceitual:

```bash
cerne-fiscal ./nota.pdf --document-type nfe --pretty > resultado.json
```

Ao automatizar, diferencie o código 2 (`not_found`) do código 1 (falha). Não use apenas presença de texto em `stdout`, pois até argumentos inválidos produzem um JSON estruturado.

## Referências no código

- entrada executável: `src/cli.ts`;
- parsing, ajuda, JSON e códigos de saída: `src/cli/run.ts`;
- declaração do binário: `package.json`;
- contrato do resultado e opções: `src/types.ts` e `src/options.ts`.
