# CLI

O pacote registra o binário `cerne-fiscal`. A saída padrão contém **somente
JSON** — nada de logs, banners ou texto livre —, o que permite encadear com
`jq`, `ConvertFrom-Json` ou qualquer consumidor estruturado.

## Uso

```text
cerne-fiscal <documento-ou-url> --document-type nfe|nfce [opções]
```

Exatamente **uma** fonte por execução, e `--document-type` é **obrigatório**.
Não há modo de lote na CLI: para processar vários documentos, itere no shell ou
use a API.

A fonte pode ser um caminho local ou uma URL HTTP/HTTPS que retorne diretamente
bytes de PDF, JPEG ou PNG. O formato é decidido pela assinatura dos bytes,
também na CLI.

```bash
cerne-fiscal ./nota.pdf --document-type nfe --pretty
```

## Opções

| Opção                     | Valor                          | Padrão      | Efeito                                             |
| ------------------------- | ------------------------------ | ----------- | -------------------------------------------------- |
| `--document-type <tipo>`  | `nfe`, `nfce`                  | **exigido** | Seleciona o modelo 55 ou 65; só minúsculas         |
| `--performance <perfil>`  | `fast`, `balanced`, `accurate` | `balanced`  | Seleciona resolução, limites e política de OCR     |
| `--passes <n>`            | `1..5`                         | do perfil   | Número de tentativas visuais distintas             |
| `--ocr <modo>`            | `never`, `fallback`, `always`  | do perfil   | Controla o OCR local                               |
| `--max-pages <n>`         | `1..10000`                     | do perfil   | Máximo de páginas processadas                      |
| `--max-file-size <bytes>` | `1..1073741824`                | 30 MiB      | Limite da entrada local ou remota                  |
| `--max-pixels <n>`        | `250000..100000000`            | do perfil   | Limite da área renderizada por página              |
| `--max-source-pixels <n>` | `250000..200000000`            | do perfil   | Limite da imagem de origem                         |
| `--timeout-ms <n>`        | `0..3600000`                   | do perfil   | Prazo de download e extração; `0` desabilita       |
| `--first`                 | —                              | desligado   | Equivale a `stopAfterFirst: true`                  |
| `--pretty`                | —                              | desligado   | Indenta o JSON com dois espaços                    |
| `--help`                  | —                              | —           | Imprime o descritor de ajuda em JSON e sai com `0` |

Todos os valores numéricos precisam ser inteiros não negativos. Qualquer token
que não comece com `--` é tratado como fonte — e informar mais de uma fonte é
erro de argumento.

## Códigos de saída

| Código | Significado                                                            |
| ------ | ---------------------------------------------------------------------- |
| `0`    | Ao menos uma chave encontrada, ou `--help`                             |
| `2`    | `status` igual a `not_found` — varredura completa, nenhuma chave       |
| `1`    | Nenhuma chave e varredura incompleta, ou erro de entrada/processamento |

O código é decidido por `result.success`, ou seja, pela presença de resultados.
Um `status` igual a `partial` que **encontrou** chaves sai com `0`; confira
`status` e `warnings` no JSON quando a completude importar.

Erros de argumento também produzem JSON — um `ExtractionResult` com
`error.code === "INVALID_INPUT"` — e não texto solto em stderr.

## Sem credenciais na CLI

A CLI **não** aceita cabeçalhos nem senhas, por decisão de projeto. Para
downloads autenticados use a API com `requestHeaders`:

```ts
await extractNFeAccessKeys(url, { requestHeaders: { Authorization: "Bearer <token>" } });
```

Evite tokens de consulta assinados em URLs usadas na CLI: argumentos podem
aparecer no histórico do terminal e na lista de processos do sistema.

PDFs protegidos por senha retornam `PASSWORD_REQUIRED`; não há opção de senha em
nenhuma das interfaces.

## Exemplos

DANFE gerada por sistema:

```bash
cerne-fiscal ./nota.pdf --document-type nfe --performance balanced --passes 2 --pretty
```

Foto de cupom fiscal, esgotando as rotações:

```bash
cerne-fiscal ./cupom.jpg --document-type nfce --performance accurate --passes 5 --pretty
```

URL pública:

```bash
cerne-fiscal https://documents.example.com/public/cupom.png --document-type nfce --pretty
```

Varredura rápida, parando na primeira chave válida:

```bash
cerne-fiscal ./nota.pdf --document-type nfe --performance fast --first
```

Digitalização sem camada de texto, forçando o OCR:

```bash
cerne-fiscal ./scan.pdf --document-type nfe --ocr always --pretty
```

Documento longo com prazo maior:

```bash
cerne-fiscal ./lote-digitalizado.pdf --document-type nfe --max-pages 100 --timeout-ms 600000 --pretty
```

## Consumindo a saída

Somente a chave do melhor resultado:

```bash
cerne-fiscal ./nota.pdf --document-type nfe | jq -r '.bestMatch.accessKey'
```

Todas as chaves encontradas:

```bash
cerne-fiscal ./nota.pdf --document-type nfe | jq -r '.results[].accessKey'
```

Chave com o CNPJ do emitente:

```bash
cerne-fiscal ./nota.pdf --document-type nfe \
  | jq -r '.results[] | "\(.accessKey)\t\(.components.issuerId)"'
```

No PowerShell:

```powershell
(cerne-fiscal ./nota.pdf --document-type nfe | ConvertFrom-Json).bestMatch.accessKey
```

Ramificando por código de saída:

```bash
cerne-fiscal ./nota.pdf --document-type nfe > resultado.json
case $? in
  0) echo "chave encontrada" ;;
  2) echo "nenhuma chave no documento" ;;
  *) echo "revisar: $(jq -r '.error.code // .status' resultado.json)" ;;
esac
```

Processando um diretório inteiro:

```bash
for arquivo in ./notas/*.pdf; do
  cerne-fiscal "$arquivo" --document-type nfe \
    | jq -r --arg f "$arquivo" '"\($f)\t\(.bestMatch.accessKey // "-")"'
done
```

Tentando os dois modelos quando o tipo do documento é desconhecido:

```bash
cerne-fiscal ./documento.pdf --document-type nfe --first \
  || cerne-fiscal ./documento.pdf --document-type nfce --first
```

## Ajuda

```bash
cerne-fiscal --help
```

Devolve um descritor JSON com `name`, `usage`, `inputFormats`, `examples` e a
lista de `options`. `--help` tem precedência sobre qualquer outro argumento —
inclusive sobre a exigência de `--document-type` — e sempre sai com `0`.
