# Cerne Fiscal

Extração local de chaves de acesso validadas de **NF-e** e **NFC-e** em
documentos **PDF, JPEG ou PNG** — por caminho, URL ou bytes em memória.
Processamento **somente por CPU**: sem GPU, sem serviço externo, sem credencial
de API.

```bash
npm install cerne-fiscal
```

```ts
import { extractNFeAccessKeys } from "cerne-fiscal";

const result = await extractNFeAccessKeys("./danfe.pdf");

if (result.success) {
  console.log(result.bestMatch.accessKey);
  // 35260712345678000195550010000000011123456784
}
```

## Documentação

| Documento                        | Conteúdo                                                     |
| -------------------------------- | ------------------------------------------------------------ |
| [Instalação](docs/INSTALACAO.md) | Requisitos, scripts e benchmark                              |
| [API](docs/API.md)               | Referência completa de funções, opções, tipos e erros        |
| [CLI](docs/CLI.md)               | Argumentos, códigos de saída e consumo da saída JSON         |
| [Exemplos](docs/EXEMPLOS.md)     | Receitas para URLs, concorrência, cancelamento e integrações |

## Uma função por modelo fiscal

```ts
import { extractNFCeAccessKeys, extractNFeAccessKeys } from "cerne-fiscal";

const nfe = await extractNFeAccessKeys("./danfe.pdf"); // somente modelo 55
const nfce = await extractNFCeAccessKeys("./cupom.jpg"); // somente modelo 65
```

As duas compartilham pipeline e opções, mas cada chamada processa um único
modelo — o tipo fiscal **não** faz parte de `ExtractOptions`. Em TypeScript os
retornos são estreitados para `ExtractionResult<"55">` e `ExtractionResult<"65">`.

O contrato atual extrai e valida **chaves de acesso**. Itens, produtos,
pagamentos e tributos são uma evolução futura e não são inferidos.

## Formatos de chave

São aceitas tanto as chaves numéricas legadas de 44 dígitos quanto o formato
atual de 44 caracteres, introduzido para CNPJs alfanuméricos em julho de 2026:

```text
^[0-9]{6}[A-Z0-9]{12}[0-9]{26}$
```

Apenas as 12 primeiras posições do identificador do emitente podem ser
alfanuméricas. O leitor usa decodificação genérica de Code 128, aceitando o Code
Set C legado e a representação híbrida atual em Code Set C/A.

Uma chave só entra em `results` depois de passar por formato, UF, mês, modelo
correspondente à função chamada, número da nota diferente de zero, CNPJ/CPF do
emitente e dígito verificador oficial por módulo 11.

## Como funciona

| Etapa            | Aplicação                                           |
| ---------------- | --------------------------------------------------- |
| Texto nativo     | Somente PDF; não conta como passagem visual         |
| Código de barras | Code 128 e QR Code                                  |
| OCR              | Tesseract local, conforme o modo configurado        |
| Consolidação     | Deduplicação e pontuação por evidência independente |

## Perfis

| Perfil     | Passagens | OCR        | Páginas | Prazo padrão |
| ---------- | --------- | ---------- | ------- | ------------ |
| `fast`     | 1         | `never`    | 10      | 30 s         |
| `balanced` | 2         | `fallback` | 30      | 120 s        |
| `accurate` | 3         | `fallback` | 50      | 300 s        |

`fast` e `balanced` ignoram o trabalho visual nas páginas que já produziram uma
chave válida em texto. `accurate` ainda executa as passagens de código de barras
configuradas, para verificação cruzada independente. O perfil só define padrões:
qualquer opção informada explicitamente prevalece.

## Custo de memória

O pico é transitório e vale por chamada: N extrações simultâneas multiplicam
esse valor por N. Medido num JPEG de 3,9 MP e num PDF equivalente:

| Etapa                                   | Pico    | Tempo  |
| --------------------------------------- | ------- | ------ |
| PDF com texto nativo (`stopAfterFirst`) | ~0 MB   | ~13 ms |
| Decodificar a imagem de origem          | ~19 MB  | —      |
| Render + leitura de código de barras    | ~49 MB  | —      |
| Passagens extras de `accurate`          | ~44 MB  | —      |
| **OCR**                                 | ~126 MB | ~1,7 s |

**O OCR domina, e o custo é subir o motor**: criar o worker do Tesseract sem
reconhecer nada já custa ~113 MB e ~300 ms. O reconhecimento em si é barato —
três páginas seguidas no mesmo worker somam ~0 MB. É a mesma natureza da heap
WebAssembly do OpenCV: runtime do motor, não trabalho útil.

Por isso `fast` usa `ocr: "never"` e os demais perfis usam `fallback`, que só
aciona o OCR quando código de barras e texto nativo falham. Force `ocr: "always"`
apenas quando a perda de reconhecimento justificar o custo; `maxPixelsPerPage`
governa o restante linearmente.

## CLI

```bash
cerne-fiscal ./nota.pdf --document-type nfe --pretty
cerne-fiscal ./cupom.jpg --document-type nfce --performance accurate --passes 5 --pretty
```

Uma fonte por execução e `--document-type` obrigatório. A saída padrão contém
somente JSON. Códigos de saída: `0` quando há chave, `2` para varredura completa
sem chave, `1` para erro ou varredura incompleta sem chave.

A CLI não aceita cabeçalhos nem senhas — use a API com `requestHeaders` para
downloads autenticados.

## Validação independente

O analisador e o validador não carregam dependências de PDF ou OCR:

```ts
import { validateAccessKey } from "cerne-fiscal";

const validacao = validateAccessKey(chave);
console.log(validacao.isValid, validacao.components?.documentType);
```

`validateAccessKey` aceita os modelos 55 e 65 indistintamente — o filtro por
modelo pertence apenas às funções de extração. Também são exportados
`parseAccessKey`, `validateIssuerIdentifier`, `calculateAccessKeyCheckDigit` e
`ACCESS_KEY_ISSUE_CODES`.

## Limites e escopo

- A rede é usada apenas para baixar a URL informada; nada é enviado a serviços
  externos de OCR ou processamento.
- Resultados estruturados não reproduzem caminhos, URLs, consultas, buffers nem
  credenciais.
- JavaScript embutido em PDF permanece desabilitado; PDFs com senha retornam
  `PASSWORD_REQUIRED`.
- Tamanho, páginas, pixels, texto, tempo e cancelamento são limitados. Cada eixo
  de imagem é limitado a 32.767 pixels, e imagens são sondadas antes da
  decodificação completa.
- **O pacote não é um filtro de SSRF.** Trate URLs de terceiros com política
  própria de host, DNS/IP e redirecionamento.
- Fora do escopo: GIF, TIFF, HEIC/HEIF, vídeo e imagens multipágina. Cada JPEG
  ou PNG é uma única página.

O extrator não completa trechos ilegíveis, não cria uma chave a partir de CNPJ,
data ou número parcial, e só aceita uma correção de OCR quando existe uma única
alternativa integralmente válida. Fotos degradadas podem terminar legitimamente
em `not_found`; aumentar `passes` não garante recuperação.

`precisionScore` é determinístico e versionado por `metadata.confidenceVersion`
(hoje `"1.0.0"`), **não** uma probabilidade calibrada. Meça precisão, recall e
falsos positivos em um corpus próprio antes de usar um limiar em automações
fiscais.

## Desenvolvimento

```bash
npm install
npm run check   # typecheck + lint + format:check + build + test
```

O repositório não versiona arquivos de teste — `npm test` executa zero testes. A
verificação real de que uma mudança em `src/` não alterou o resultado é o
benchmark, que compara todo o JSON de saída exceto `durationMs`:

```bash
npm run build && node bench/run.mjs --repeats 3 --compare antes
```

Detalhes em [`bench/README.md`](bench/README.md) e
[docs/INSTALACAO.md](docs/INSTALACAO.md).

## Referências

- [MOC 7.0 - Visão Geral](https://www.confaz.fazenda.gov.br/legislacao/arquivo-manuais/moc7-visao-geral.pdf)
- [Nota Técnica Conjunta DFe 2025.001 - CNPJ alfanumérico](https://www.nfe.fazenda.gov.br/Portal/exibirArquivo.aspx?conteudo=5ZkvIZt10mQ%3D)
- [NT 2026.004 v1.01 - NF-e/NFC-e schemas](https://www.nfe.fazenda.gov.br/POrtal/exibirArquivo.aspx?AspxAutoDetectCookieSupport=1&conteudo=BTZQzgsO9Ws%3D)

## Licença

MIT. Veja [LICENSE](LICENSE).
