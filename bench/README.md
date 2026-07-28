# Benchmark

Mede o tempo de extração e verifica que uma mudança não alterou o resultado.
As fixtures são sintéticas e determinísticas: nenhuma DANFE real é versionada.

## Uso

```bash
npm run build
node bench/fixtures.mjs
node bench/run.mjs
```

`bench/fixtures.mjs` só precisa rodar de novo quando o próprio gerador muda.

## Verificando uma otimização

Grave a execução de referência antes de mexer em `src/`, e confronte depois:

```bash
git stash && npm run build && node bench/run.mjs --repeats 3 --save antes
git stash pop && npm run build && node bench/run.mjs --repeats 3 --compare antes
```

A comparação ignora `durationMs` e confronta todo o resto do JSON — `results`,
`precisionScore`, `warnings` e `metadata`. Qualquer divergência é listada e o
processo sai com código 1, então a comparação serve em CI.

## Interpretando os números

O tempo varia entre 5% e 30% de uma execução para outra, principalmente nos
casos curtos: o OCR roda em uma worker thread e sofre com o escalonamento do
sistema. Use `--repeats 3` e leve a sério só as diferenças acima de ~15%, ou o
total da suíte. A saída, ao contrário do tempo, é determinística — uma
divergência ali é sempre real.

A coluna de memória é o pico de RSS durante o caso, medido por amostragem a cada
10 ms sobre uma linha de base tirada depois de um GC. Ela responde "quanta
memória este caso exige de um contêiner", não "quanta memória foi vazada" — o
residual entre casos é baixo e não aparece aqui.

O ruído é maior do que o do tempo: o RSS é contabilidade do sistema operacional e
o alocador devolve páginas quando quer, então um caso isolado pode oscilar 30%
sem que nada tenha mudado. Trate como sinal confiável o **pico máximo da suíte**,
e per-caso só com `--repeats 3` e diferenças acima de ~40%. `npm run bench` já
passa `--expose-gc`; rodando `node bench/run.mjs` direto, sem essa flag, as
linhas de base ficam sujas e os picos saem inflados.

## Casos

| Fixture                            | Caminho exercitado                                  |
| ---------------------------------- | --------------------------------------------------- |
| `danfe-native.pdf`                 | PDF só com camada de texto                          |
| `danfe-vector.pdf`                 | DANFE de sistema: texto real e Code 128 vetorial    |
| `danfe-vector-barcode-only.pdf`    | Vetorial sem a chave em texto, força render e OCR   |
| `danfe-scan.pdf`                   | PDF escaneado (JPEG embutido, sem texto)            |
| `danfe-scan-barcode-only.pdf`      | Escaneado sem a chave em texto                      |
| `danfe.png` / `danfe.jpg`          | Imagem avulsa                                       |
| `danfe-blur.jpg`                   | Foto degradada                                      |
| `nomatch.jpg` / `nomatch-scan.pdf` | Página densa sem chave: pior caso, pipeline inteiro |

Cada um roda nos perfis que fazem diferença para aquele caminho.

O gerador desenha o código de barras em uma faixa horizontal limpa de
propósito: uma borda vertical à esquerda impede o ZXing de localizar o padrão
inicial do Code 128, e a fixture deixaria de exercitar o leitor.
