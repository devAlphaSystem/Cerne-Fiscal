# Cerne Fiscal

O Cerne Fiscal faz a extração local, somente por CPU, de chaves de acesso
validadas de NF-e e NFC-e em documentos PDF, JPEG e PNG. A entrada pode ser um
caminho local, uma URL HTTP/HTTPS, `Buffer`, `Uint8Array` ou `ArrayBuffer`. O
formato é identificado pela assinatura real dos bytes, independentemente da
extensão e do `Content-Type`.

Em PDFs, o extrator verifica primeiro o texto nativo e depois reutiliza o
pipeline visual de Code 128, QR Code e OCR. JPEG e PNG são tratados como
documentos visuais de uma página e passam pelo mesmo pipeline aplicável. Os
arquivos remotos são baixados para o processo Node.js; renderização,
reconhecimento e OCR permanecem locais e nenhuma imagem é enviada a serviços
externos.

O pacote aceita tanto as chaves numéricas legadas de 44 dígitos quanto o formato
atual de 44 caracteres, introduzido para CNPJs alfanuméricos em julho de 2026.

## Instalação

```bash
npm install cerne-fiscal
```

É necessário usar Node.js 20 ou mais recente. Não é preciso instalar o Tesseract
no sistema, usar GPU ou serviço externo de extração, baixar modelos durante a
execução nem fornecer credenciais de API ao pacote. A aplicação que chama o
pacote pode fornecer credenciais quando a URL do documento exigir autenticação.

## Uma função por modelo fiscal

```ts
import { extractNFCeAccessKeys, extractNFeAccessKeys } from "cerne-fiscal";

const result = await extractNFeAccessKeys("/local/path/danfe.pdf", {
  performance: "balanced",
  passes: 2,
});

const nfceResult = await extractNFCeAccessKeys("/local/path/danfce.pdf", {
  performance: "balanced",
  passes: 2,
});

const photoResult = await extractNFCeAccessKeys("/local/path/cupom.jpg", {
  performance: "accurate",
  passes: 5,
});

console.log(JSON.stringify(result, null, 2));
```

`extractNFeAccessKeys` procura exclusivamente chaves de NF-e, modelo 55, e
`extractNFCeAccessKeys` procura exclusivamente chaves de NFC-e, modelo 65. As
duas funções compartilham o mesmo pipeline e as mesmas opções, mas cada chamada
processa somente um modelo. O tipo fiscal não faz parte de `ExtractOptions`.
Em TypeScript, os retornos são inferidos como `ExtractionResult<"55">` e
`ExtractionResult<"65">`, respectivamente.

O contrato atual extrai e valida chaves de acesso. Itens, produtos, pagamentos,
tributos e demais campos completos de uma NFC-e são uma evolução futura e não
são inferidos por estas funções.

O tipo público recomendado para essas entradas é `DocumentInput`. `PdfInput`
continua exportado como um alias de compatibilidade, sem implementação paralela.
Também são aceitos `Buffer`, `Uint8Array` e `ArrayBuffer`:

```ts
const result = await extractNFeAccessKeys(documentBuffer);
```

URLs HTTP/HTTPS de qualquer formato aceito podem ser informadas diretamente:

```ts
const result = await extractNFCeAccessKeys("https://documents.example.com/public/cupom.png");
```

Para uma URL autenticada, use a opção `requestHeaders`, disponível somente na API:

```ts
const result = await extractNFeAccessKeys("https://documents.example.com/private/danfe.pdf", {
  requestHeaders: {
    Authorization: "Bearer <token>",
  },
});
```

O pacote não executa fluxos de login nem mantém um repositório de cookies. A
aplicação chamadora é responsável pelas credenciais fornecidas e pelo estado da
sessão. Prefira HTTPS sempre que enviar credenciais; cabeçalhos enviados a uma
URL HTTP inicial não são protegidos por TLS. `requestHeaders` aceita somente
valores do tipo string e não pode ser usada com um caminho local ou uma entrada
em memória. Cabeçalhos de roteamento, enquadramento, intervalo e negociação de
compressão são reservados pelo componente de download e não podem ser
sobrescritos.

### Download de documentos remotos

Somente URLs `http://` e `https://` são aceitas. O componente de download segue
respostas HTTP 301, 302, 303, 307 e 308, com no máximo cinco redirecionamentos.
Quando um redirecionamento muda a origem, todos os cabeçalhos fornecidos em
`requestHeaders` são removidos antes da próxima solicitação. Redirecionamentos
na mesma origem preservam esses cabeçalhos.

O limite `maxFileSizeBytes` (30 MiB por padrão) é aplicado tanto ao
`Content-Length` declarado quanto aos bytes recebidos durante a transferência.
`timeoutMs` abrange o download e a extração em conjunto, enquanto `signal` pode
cancelar qualquer uma das fases. É a assinatura de PDF, JPEG ou PNG, e não a
extensão da URL ou o tipo de mídia da resposta, que determina se o conteúdo
baixado é aceito.
Falhas de download usam o código de erro `DOWNLOAD_ERROR`. Erros estruturados
não reproduzem a URL, a string de consulta nem os valores dos cabeçalhos da
solicitação.

Trate URLs remotas como entradas confiáveis. O pacote não é um filtro de SSRF:
uma URL e seus redirecionamentos podem alcançar qualquer local da rede acessível
ao processo Node.js. Aplicações que aceitam URLs fornecidas por usuários devem
aplicar sua própria política de confiança. Quando forem necessárias listas de
permissão de host, DNS/IP ou redirecionamento, faça o download com um cliente
controlado pela aplicação e envie os bytes resultantes ao extrator.

## Formatos de imagem e segurança

JPEG/JPG e PNG são os formatos de imagem suportados. Extensões ausentes,
incorretas ou duplicadas não interferem na detecção quando os bytes são válidos.
GIF, TIFF, HEIC/HEIF, vídeo e imagens multipágina não fazem parte deste contrato.

Antes de decodificar uma imagem, o extrator lê largura e altura do cabeçalho,
valida a estrutura inicial, recusa eixos acima de 32.767 pixels e aplica
`maxSourceImagePixels`. As dimensões decodificadas são verificadas novamente.
`maxPixelsPerPage` limita cada superfície produzida para reconhecimento.

A primeira tentativa visual mantém toda a imagem, na orientação EXIF declarada,
sem recorte ou filtro. Passagens posteriores, quando solicitadas, podem usar
recorte conservador de margens, redimensionamento limitado, escala de cinza,
contraste moderado e rotações discretas. Leitura invertida e regiões candidatas
são usadas pelo leitor de códigos em imagens. Essas transformações derivadas não
são contadas como ocorrências independentes da mesma fonte.

Fotos inclinadas, desfocadas, amassadas, manchadas, com reflexo ou código
degradado podem retornar legitimamente `not_found`. Aumentar `passes` não garante
recuperação. O extrator não completa trechos ilegíveis, não cria uma chave a
partir de CNPJ/data/número parcial e só aceita uma correção de OCR quando existe
uma única alternativa integralmente válida.

## Resultado

Cada função retorna um objeto compatível com JSON para sucesso, ausência de
correspondência, entrada inválida, tempo limite e erros esperados do documento:

```json
{
  "status": "success",
  "success": true,
  "precisionScore": 0.99,
  "bestMatch": {
    "accessKey": "35260712345678000195550010000000011123456784",
    "documentType": "NFe",
    "model": "55",
    "format": "numeric",
    "isValid": true,
    "precisionScore": 0.99,
    "pages": [1],
    "sources": ["pdf-text"],
    "occurrences": 1,
    "components": {
      "accessKey": "35260712345678000195550010000000011123456784",
      "format": "numeric",
      "stateCode": "35",
      "yearMonth": "2607",
      "year": "26",
      "month": "07",
      "issuerId": "12345678000195",
      "model": "55",
      "documentType": "NFe",
      "series": "001",
      "invoiceNumber": "000000001",
      "emissionType": "1",
      "numericCode": "12345678",
      "checkDigit": 4
    }
  },
  "results": [
    {
      "accessKey": "35260712345678000195550010000000011123456784",
      "documentType": "NFe",
      "model": "55",
      "format": "numeric",
      "isValid": true,
      "precisionScore": 0.99,
      "pages": [1],
      "sources": ["pdf-text"],
      "occurrences": 1,
      "components": {
        "accessKey": "35260712345678000195550010000000011123456784",
        "format": "numeric",
        "stateCode": "35",
        "yearMonth": "2607",
        "year": "26",
        "month": "07",
        "issuerId": "12345678000195",
        "model": "55",
        "documentType": "NFe",
        "series": "001",
        "invoiceNumber": "000000001",
        "emissionType": "1",
        "numericCode": "12345678",
        "checkDigit": 4
      }
    }
  ],
  "metadata": {
    "performance": "balanced",
    "ocrMode": "fallback",
    "inputFormat": "pdf",
    "passesRequested": 2,
    "passesUsed": 0,
    "pagesTotal": 1,
    "pagesProcessed": 1,
    "pagesRendered": 0,
    "renderAttempts": 0,
    "ocrPages": 0,
    "fileSizeBytes": 8421,
    "maxPixelsPerPage": 12000000,
    "maxSourceImagePixels": 60000000,
    "durationMs": 12.34,
    "complete": true,
    "confidenceVersion": "1.0.0"
  },
  "warnings": [],
  "error": null
}
```

Para JPEG e PNG, `pagesTotal` é sempre `1`. `sourceImageWidth` e
`sourceImageHeight` registram as dimensões decodificadas originais, enquanto
`renderAttempts` informa quantas renderizações o pipeline pediu, inclusive as
que reaproveitam uma superfície já pronta.
`pagesRendered` continua representando a quantidade de páginas distintas
renderizadas. `inputFormat` pode ficar ausente quando a entrada falha antes de a
assinatura ser reconhecida.

`results` contém todas as chaves únicas e validadas do modelo escolhido
detectadas pelas etapas executadas nas páginas processadas. A função de NF-e
retorna somente modelo 55, enquanto a função de NFC-e retorna somente modelo 65.
Os perfis `fast` e `balanced` podem ignorar etapas de maior custo depois que uma
evidência válida mais barata é encontrada; use `accurate` ou `ocr: 'always'`
quando quiser verificações cruzadas adicionais. `bestMatch` é o resultado com a
maior pontuação. O `precisionScore` do nível superior é conservador: quando
várias chaves são retornadas, ele corresponde à menor pontuação entre os
resultados.

Todas as chaves permanecem como strings, portanto zeros à esquerda nunca são
perdidos.

### O que a pontuação significa

`precisionScore` é uma pontuação determinística de confiança nas evidências,
versionada por `metadata.confidenceVersion`. Código de barras/QR, texto nativo
exato, texto reconstruído e OCR têm pontuações-base diferentes; fontes
independentes que concordam entre si aumentam a pontuação. Toda chave retornada
já passou pelas validações de formato, UF, mês, modelo correspondente à função,
número da nota diferente de zero, CNPJ/CPF do emitente e dígito verificador
oficial por módulo 11.

A pontuação não é uma probabilidade calibrada estatisticamente. Meça precisão,
recall e falsos positivos em um corpus privado representativo antes de usar um
limiar em automações fiscais.

## Opções

| Opção                  | Valores                        | Padrão               | Significado                                                 |
| ---------------------- | ------------------------------ | -------------------- | ----------------------------------------------------------- |
| `performance`          | `fast`, `balanced`, `accurate` | `balanced`           | Seleciona escala de renderização, limites e política de OCR |
| `passes`               | inteiro `1..5`                 | específico do perfil | Número de tentativas visuais distintas de renderização      |
| `ocr`                  | `never`, `fallback`, `always`  | específico do perfil | Controla o OCR local do Tesseract                           |
| `maxPages`             | inteiro positivo               | `10`, `30` ou `50`   | Máximo de páginas processadas                               |
| `maxFileSizeBytes`     | inteiro positivo               | 30 MiB               | Limite de tamanho da entrada                                |
| `maxPixelsPerPage`     | inteiro positivo               | específico do perfil | Limite de pixels da renderização e de imagens incorporadas  |
| `maxSourceImagePixels` | inteiro positivo               | específico do perfil | Limite de pixels da imagem de origem decodificada           |
| `timeoutMs`            | `0..3600000`                   | específico do perfil | Prazo do download/extração; `0` o desabilita                |
| `stopAfterFirst`       | booleano                       | `false`              | Interrompe na primeira chave válida do modelo selecionado   |
| `requestHeaders`       | registro de strings            | nenhum               | Cabeçalhos exclusivos da API para um download HTTP(S)       |
| `signal`               | `AbortSignal`                  | nenhum               | Cancela o download ou a extração local                      |

A etapa de texto nativo existe somente para PDF e não conta como uma passagem
visual. Em imagens, a primeira passagem usa toda a origem; as seguintes usam uma
receita determinística de redimensionamento, filtro, recorte ou rotação. O
extrator não usa repetições derivadas da mesma página para aumentar a confiança
ou o número de ocorrências.

Perfis:

- `fast`: texto nativo quando houver e uma tentativa visual; OCR desabilitado
  por padrão.
- `balanced`: duas estratégias visuais, incluindo pré-processamento moderado de
  imagens, e OCR somente quando texto/código não encontra uma chave válida.
- `accurate`: limites maiores e passagens adicionais configuráveis, incluindo
  rotações e OCR local como alternativa.

Os perfis `fast` e `balanced` ignoram o trabalho visual nas páginas que já
produziram texto válido. O perfil `accurate` ainda executa as passagens de código
de barras configuradas para fazer uma verificação cruzada independente. O OCR no
modo `fallback` só é executado nas páginas não resolvidas pelas etapas
anteriores; `ocr: 'always'` o executa de qualquer forma.

## CLI

Após a instalação:

```text
cerne-fiscal <file-or-url> --document-type nfe|nfce [options]
```

Por exemplo:

```bash
cerne-fiscal ./nota.pdf --document-type nfe --performance balanced --passes 2 --pretty
cerne-fiscal ./cupom.jpg --document-type nfce --performance accurate --passes 5 --pretty
cerne-fiscal https://documents.example.com/public/cupom.png --document-type nfce --pretty
```

O argumento posicional pode ser o caminho de um arquivo local ou uma URL pública
HTTP/HTTPS de PDF, JPEG ou PNG. A detecção também usa os bytes na CLI.
`--document-type` é obrigatório, aceita somente `nfe` ou `nfce` em minúsculas e
seleciona uma função de extração por execução. Intencionalmente, a CLI não
oferece uma opção para credenciais ou cabeçalhos de solicitação personalizados;
use a API da biblioteca com `requestHeaders` para downloads autenticados. Evite
tokens de consulta assinados em URLs usadas na CLI, pois os argumentos do
comando podem ficar visíveis no histórico do terminal ou na lista de processos
do sistema operacional.

Opções disponíveis:

```text
--document-type nfe|nfce
--performance fast|balanced|accurate
--passes 1..5
--ocr never|fallback|always
--max-pages N
--max-file-size BYTES
--max-pixels N
--max-source-pixels N
--timeout-ms N
--first
--pretty
--help
```

O fluxo de saída padrão contém somente JSON. O código de saída `0` significa que
uma ou mais chaves foram encontradas (ou que a ajuda foi solicitada), `2`
significa que uma varredura completa não encontrou nenhuma, e `1` indica um erro
de entrada/processamento ou uma varredura incompleta sem chave.

## Chaves de acesso atuais e legadas

As chaves numéricas legadas continuam sendo aceitas. A expressão oficial atual é:

```text
^[0-9]{6}[A-Z0-9]{12}[0-9]{26}$
```

Somente as primeiras 12 posições do identificador do emitente dentro da chave
podem ser alfanuméricas; as demais posições continuam numéricas. O cálculo do
dígito verificador mapeia cada um dos primeiros 43 caracteres para `ASCII - 48`,
aplica pesos repetidos de 2 a 9, da direita para a esquerda, e depois módulo 11.
As chaves numéricas são um subconjunto compatível do mesmo algoritmo.

O leitor de código de barras usa decodificação genérica de Code 128, portanto
aceita tanto o Code Set C legado quanto a representação híbrida atual em Code
Set C/A.

Referências oficiais:

- [MOC 7.0 - Visão Geral](https://www.confaz.fazenda.gov.br/legislacao/arquivo-manuais/moc7-visao-geral.pdf)
- [Nota Técnica Conjunta DFe 2025.001 - CNPJ alfanumérico](https://www.nfe.fazenda.gov.br/Portal/exibirArquivo.aspx?conteudo=5ZkvIZt10mQ%3D)
- [NT 2026.004 v1.01 - NF-e/NFC-e schemas](https://www.nfe.fazenda.gov.br/POrtal/exibirArquivo.aspx?AspxAutoDetectCookieSupport=1&conteudo=BTZQzgsO9Ws%3D)

## Validação independente

O analisador e o validador fiscais são públicos e não carregam dependências de
PDF/OCR:

```ts
import { calculateAccessKeyCheckDigit, parseAccessKey, validateAccessKey, validateIssuerIdentifier } from "cerne-fiscal";

const validation = validateAccessKey(accessKey);
```

`validateAccessKey` continua aceitando independentemente os modelos 55 e 65; o
filtro por modelo pertence somente às funções de extração.

## Comportamento de recursos e segurança

- Execução somente por CPU; nenhum backend de GPU é usado.
- O acesso à rede é usado apenas para baixar uma URL de entrada HTTP/HTTPS. Após
  o download limitado, a extração é local; os bytes do documento ou da
  fotografia não são enviados a um serviço de OCR nem a outro processador
  externo.
- Os dados de idioma do OCR são instalados localmente com o pacote e carregados
  explicitamente do disco, evitando o uso padrão da CDN do Tesseract.
- Tamanho do arquivo, quantidade de páginas, dimensões/pixels de imagens de
  origem, pixels de renderização, itens de texto, tamanho do texto, prazo e
  cancelamento têm limites definidos.
- A execução de JavaScript em PDFs é desabilitada.
- As falhas esperadas são retornadas como JSON estruturado e nunca expõem
  buffers, URLs completas, cabeçalhos ou objetos internos do documento.

PDFs criptografados que exigem senha são informados como `PASSWORD_REQUIRED`.
PDFs, imagens ou digitalizações gravemente danificados ainda podem produzir
`not_found`; o pacote não inventa uma chave que não passe pela validação fiscal
determinística. Uma evidência visual só entra em `results` depois de formato,
modelo, emitente, campos fiscais aplicáveis e dígito verificador serem validados.

Antes da renderização, o PDF.js ignora imagens incorporadas que excedam
`maxSourceImagePixels`. Os valores padrão dos perfis permitem digitalizações em
alta resolução sem deixar a decodificação da origem sem limites; aumente o
limite explicitamente apenas para digitalizações confiáveis e excepcionalmente
grandes. JPEG e PNG também são sondados e limitados antes da decodificação
completa para reduzir o risco de bombas de descompressão.

## Desenvolvimento

```bash
npm install
npm run typecheck
npm run lint
npm run security:audit
npm run build
npm run check
```

A compilação gera ESM, CommonJS, declarações, mapas de código-fonte e a CLI em
`dist/`.
