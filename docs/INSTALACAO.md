# Instalação e desenvolvimento

Este guia separa o consumo do pacote publicado do trabalho no código-fonte. O Cerne Fiscal é uma biblioteca e uma CLI; não existe serviço, porta ou banco de dados para configurar.

## Requisitos

- Node.js 20 ou superior, conforme `engines.node` em `package.json`;
- um gerenciador compatível com o `package-lock.json` para desenvolvimento local;
- plataforma suportada pelas dependências nativas de `@napi-rs/canvas`;
- CPU e memória compatíveis com o tamanho, número de páginas e perfil usados.

Não há variáveis de ambiente obrigatórias, arquivo `.env` de exemplo, banco de dados ou serviço externo obrigatório. O OCR usa o pacote local `@tesseract.js-data/eng`; uma chamada só acessa a rede quando a própria entrada é uma URL HTTP(S).

## Como dependência de outro projeto

```bash
npm install cerne-fiscal
```

Uso ESM:

```ts
import { extractNFeAccessKeys, validateAccessKey } from "cerne-fiscal";
```

Uso CommonJS:

```js
const { extractNFeAccessKeys, validateAccessKey } = require("cerne-fiscal");
```

O mapa de exports aponta para:

| Consumidor       | JavaScript       | Tipos              |
| ---------------- | ---------------- | ------------------ |
| ESM/import       | `dist/index.js`  | `dist/index.d.ts`  |
| CommonJS/require | `dist/index.cjs` | `dist/index.d.cts` |
| CLI              | `dist/cli.js`    | não aplicável      |

O pacote declara `sideEffects: false`, possibilitando tree-shaking por ferramentas que respeitem esse campo.

## A partir do código-fonte

Depois de obter o repositório, o fluxo previsto pelos scripts é:

```bash
npm ci
npm run check
```

`npm run check` executa, em sequência:

1. `tsc --noEmit`;
2. ESLint;
3. verificação do Prettier;
4. build com `tsup`.

O build gera ESM, CommonJS, declarações TypeScript e source maps da biblioteca em `dist/`, além da CLI ESM. O alvo é Node.js 20 e os bundles não fazem code splitting.

Os comandos acima são instruções para execução manual. Consulte também os scripts individuais:

| Script                   | Finalidade                             |
| ------------------------ | -------------------------------------- |
| `npm run build`          | gera os artefatos em `dist/`           |
| `npm run typecheck`      | valida os tipos sem emitir arquivos    |
| `npm run lint`           | executa ESLint no projeto              |
| `npm run format:check`   | confere a formatação sem reescrever    |
| `npm run format`         | aplica Prettier                        |
| `npm run security:audit` | executa `npm audit --audit-level=low`  |
| `npm run bench:fixtures` | regenera as fixtures sintéticas        |
| `npm run bench`          | executa o benchmark com GC exposto     |
| `npm run check`          | agrega tipos, lint, formatação e build |

O benchmark determinístico descrito em `bench/README.md` continua sendo a verificação de regressão de resultado e desempenho sobre documentos completos.

## Dependências de runtime

| Dependência              | Papel no projeto                                 |
| ------------------------ | ------------------------------------------------ |
| `pdfjs-dist`             | parsing, texto nativo e renderização de PDF      |
| `@napi-rs/canvas`        | canvas, decodificação e transformação de imagens |
| `@zxing/library`         | leitura de Code 128 e QR Code                    |
| `tesseract.js`           | worker de OCR                                    |
| `@tesseract.js-data/eng` | dados de idioma embarcados para o OCR            |

Os runtimes pesados são importados sob demanda: PDF, canvas, leitor de código de barras e OCR só são carregados quando o caminho da extração precisa deles. Isso reduz trabalho inicial, mas a primeira chamada que alcança cada estágio pode ter latência adicional de inicialização.

## TypeScript e estilo

O projeto usa TypeScript estrito, `moduleResolution: "Bundler"`, ES2022, imports verbatim, checagem de variáveis não usadas e `noUncheckedIndexedAccess`. O código-fonte está em `src/` e não deve importar artefatos de `dist/`.

O `prepare` executa `patch-package`. Existe um patch versionado para o Prettier 3.9.4 que altera decisões de quebra de linha e indentação de templates; por isso a versão do Prettier está fixada exatamente em `3.9.4`. Antes de atualizar o formatador, o patch deve ser revisto e migrado, não descartado silenciosamente.

## CI

O workflow `.github/workflows/ci.yml` possui dois jobs:

- `verify`: instala com `npm ci` e executa typecheck, lint, verificação de formato e build em Node.js 20, 22 e 24;
- `security`: instala com `npm ci` e executa a auditoria de dependências em Node.js 22.

O benchmark não é executado pelo CI atual.

## Conteúdo publicado

O campo `files` do `package.json` inclui somente:

- `dist/`;
- `README.md`;
- `LICENSE`.

Os guias em `docs/` e os arquivos de benchmark permanecem no repositório, mas não são incluídos no pacote gerado pela configuração atual. O `prepack` chama `npm run check`, portanto empacotamento ou publicação dependem de todas as verificações estáticas e do build.

## Problemas de instalação

### Versão do Node.js rejeitada

Confirme `node --version`. O pacote declara Node.js 20 como versão mínima e usa APIs disponíveis nesse runtime, inclusive `fetch`, `AbortSignal` e módulos ESM.

### Falha ao carregar canvas

`@napi-rs/canvas` depende de um binário específico da plataforma. Confirme que a plataforma/arquitetura está contemplada pelo pacote instalado e que a instalação não omitiu dependências opcionais necessárias. A extração de imagens e a renderização de PDF não funcionam sem esse runtime.

### OCR não inicializa

Confirme que `tesseract.js` e `@tesseract.js-data/eng` foram instalados. O projeto configura o worker com dados `eng` locais, `OEM.LSTM_ONLY`, segmentação `SPARSE_TEXT` e uma whitelist alfanumérica.

### `dist/` ausente ao usar o repositório

Os entrypoints do pacote apontam para `dist/`; execute o build antes de importar o diretório como pacote ou rodar o benchmark. O código-fonte TypeScript não é o entrypoint publicado.

### Patch do Prettier não aplica

Verifique se a versão instalada continua exatamente `3.9.4`. Alterações nessa dependência exigem migração consciente de `patches/prettier+3.9.4.patch`.

## Referências no código

- requisitos, exports, scripts e dependências: `package.json`;
- configuração TypeScript: `tsconfig.json`;
- lint: `eslint.config.js`;
- estilo: `.prettierrc.json` e `patches/prettier+3.9.4.patch`;
- CI: `.github/workflows/ci.yml`;
- benchmark: `bench/README.md`, `bench/fixtures.mjs` e `bench/run.mjs`.
