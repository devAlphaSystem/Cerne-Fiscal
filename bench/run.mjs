import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { clearInterval, setImmediate, setInterval } from "node:timers";
import { fileURLToPath } from "node:url";

const FIXTURE_DIRECTORY = fileURLToPath(new URL("./fixtures/", import.meta.url));
const RESULT_DIRECTORY = fileURLToPath(new URL("./results/", import.meta.url));
const DIST_ENTRY = new URL("../dist/index.js", import.meta.url);

const CASES = [
  ["danfe-native.pdf", "balanced"],
  ["danfe-vector.pdf", "balanced"],
  ["danfe-vector-barcode-only.pdf", "balanced"],
  ["danfe-vector-barcode-only.pdf", "fast"],
  ["danfe-scan.pdf", "balanced"],
  ["danfe-scan-barcode-only.pdf", "balanced"],
  ["danfe.png", "balanced"],
  ["danfe.jpg", "balanced"],
  ["nomatch-scan.pdf", "balanced"],
  ["nomatch.jpg", "balanced"],
  ["danfe-scan.pdf", "fast"],
  ["danfe.jpg", "fast"],
  ["danfe-scan.pdf", "accurate"],
  ["danfe.jpg", "accurate"],
  ["nomatch.jpg", "accurate"],
  ["danfe-blur.jpg", "balanced"],
  ["danfe-blur.jpg", "accurate"],
];

function parseArguments(argv) {
  const options = { save: null, compare: null, repeats: 1, filter: null };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--save" || flag === "--compare" || flag === "--filter") {
      if (value === undefined) {
        throw new Error(`${flag} exige um valor.`);
      }
      options[flag.slice(2)] = value;
      index += 1;
    } else if (flag === "--repeats") {
      options.repeats = Number(value);
      if (!Number.isInteger(options.repeats) || options.repeats < 1) {
        throw new Error("--repeats exige um inteiro maior que zero.");
      }
      index += 1;
    } else {
      throw new Error(`Argumento desconhecido: ${flag}`);
    }
  }
  return options;
}

function withoutTiming(result) {
  return JSON.parse(JSON.stringify(result, (key, value) => (key === "durationMs" ? 0 : value)));
}

function loadResults(label) {
  const path = join(RESULT_DIRECTORY, `${label}.json`);
  if (!existsSync(path)) {
    throw new Error(`Execução salva não encontrada: ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

const options = parseArguments(process.argv.slice(2));

if (!existsSync(FIXTURE_DIRECTORY)) {
  throw new Error("Fixtures ausentes. Rode `node bench/fixtures.mjs` primeiro.");
}
if (!existsSync(fileURLToPath(DIST_ENTRY))) {
  throw new Error("dist ausente. Rode `npm run build` primeiro.");
}

const { extractNFeAccessKeys } = await import(DIST_ENTRY.href);
const selected = options.filter === null ? CASES : CASES.filter(([fixture, profile]) => `${fixture} [${profile}]`.includes(options.filter));
if (selected.length === 0) {
  throw new Error(`Nenhum caso corresponde a "${options.filter}".`);
}

const MEBIBYTE = 1024 * 1024;

async function settle() {
  if (typeof globalThis.gc !== "function") {
    return;
  }
  for (let round = 0; round < 3; round += 1) {
    globalThis.gc();
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/**
 * Roda uma execução medindo tempo e pico de RSS. O pico é o número que dimensiona
 * o container; a memória residual entre execuções é baixa.
 */
async function measure(work) {
  await settle();
  const baseRss = process.memoryUsage.rss();
  let peakRss = baseRss;
  const sampler = setInterval(() => {
    const rss = process.memoryUsage.rss();
    if (rss > peakRss) {
      peakRss = rss;
    }
  }, 10);
  sampler.unref();
  const startedAt = process.hrtime.bigint();
  try {
    const result = await work();
    return {
      result,
      ms: Number(process.hrtime.bigint() - startedAt) / 1e6,
      peakMb: Math.max(0, peakRss - baseRss) / MEBIBYTE,
    };
  } finally {
    clearInterval(sampler);
  }
}

const rows = [];
for (const [fixture, performance] of selected) {
  const data = new Uint8Array(readFileSync(join(FIXTURE_DIRECTORY, fixture)));
  const timings = [];
  const peaks = [];
  let snapshot = null;
  for (let attempt = 0; attempt < options.repeats; attempt += 1) {
    const measured = await measure(() => extractNFeAccessKeys(data, { performance }));
    timings.push(measured.ms);
    peaks.push(measured.peakMb);
    snapshot ??= withoutTiming(measured.result);
  }
  const name = `${fixture} [${performance}]`;
  const bestMs = Number(Math.min(...timings).toFixed(1));
  const peakMb = Number(Math.min(...peaks).toFixed(1));
  rows.push({ case: name, bestMs, peakMb, snapshot });
  console.log(`  ${name.padEnd(38)} ${bestMs.toFixed(0).padStart(7)} ms ${peakMb.toFixed(0).padStart(5)} MB  ${snapshot.status.padEnd(10)} ${snapshot.results.length} resultado(s)`);
}

const totalMs = rows.reduce((sum, row) => sum + row.bestMs, 0);
const maxPeakMb = Math.max(...rows.map((row) => row.peakMb));
console.log(`\ntotal ${totalMs.toFixed(0)} ms  ·  pico máximo ${maxPeakMb.toFixed(0)} MB`);
if (typeof globalThis.gc !== "function") {
  console.log("dica: rode com `node --expose-gc bench/run.mjs` para picos de memória estáveis.");
}

if (options.save !== null) {
  mkdirSync(RESULT_DIRECTORY, { recursive: true });
  writeFileSync(join(RESULT_DIRECTORY, `${options.save}.json`), `${JSON.stringify(rows, null, 2)}\n`);
  console.log(`gravado em bench/results/${options.save}.json`);
}

if (options.compare !== null) {
  const baseline = new Map(loadResults(options.compare).map((row) => [row.case, row]));
  let differences = 0;
  let baselineTotal = 0;
  let baselinePeak = 0;
  console.log(`\ncomparando com ${options.compare}\n`);
  console.log(`${"caso".padEnd(38)} ${"ms antes".padStart(9)} ${"ms depois".padStart(9)} ${"Δt".padStart(6)} ${"MB antes".padStart(9)} ${"MB depois".padStart(9)} ${"Δm".padStart(6)}   saída`);
  for (const row of rows) {
    const previous = baseline.get(row.case);
    if (previous === undefined) {
      console.log(`${row.case.padEnd(38)} ${"—".padStart(9)} ${String(row.bestMs).padStart(9)} ${"—".padStart(6)} ${"—".padStart(9)} ${String(row.peakMb).padStart(9)} ${"—".padStart(6)}   caso novo`);
      continue;
    }
    baselineTotal += previous.bestMs;
    baselinePeak = Math.max(baselinePeak, previous.peakMb ?? 0);
    const identical = JSON.stringify(previous.snapshot) === JSON.stringify(row.snapshot);
    if (!identical) {
      differences += 1;
    }
    const timeDelta = `${((row.bestMs / previous.bestMs - 1) * 100).toFixed(0)}%`;
    const hasPeak = typeof previous.peakMb === "number" && previous.peakMb > 0;
    const peakBefore = hasPeak ? String(previous.peakMb) : "—";
    const peakDelta = hasPeak ? `${((row.peakMb / previous.peakMb - 1) * 100).toFixed(0)}%` : "—";
    console.log(`${row.case.padEnd(38)} ${String(previous.bestMs).padStart(9)} ${String(row.bestMs).padStart(9)} ${timeDelta.padStart(6)} ${peakBefore.padStart(9)} ${String(row.peakMb).padStart(9)} ${peakDelta.padStart(6)}   ${identical ? "idêntica" : "*** DIFERENTE ***"}`);
  }
  if (baselineTotal > 0) {
    console.log(`\ntotal ${baselineTotal.toFixed(0)} ms -> ${totalMs.toFixed(0)} ms  (${((totalMs / baselineTotal - 1) * 100).toFixed(0)}%)`);
  }
  if (baselinePeak > 0) {
    console.log(`pico máximo ${baselinePeak.toFixed(0)} MB -> ${maxPeakMb.toFixed(0)} MB  (${((maxPeakMb / baselinePeak - 1) * 100).toFixed(0)}%)`);
  }
  console.log(differences === 0 ? "todas as saídas idênticas" : `${differences} caso(s) com saída diferente`);
  if (differences > 0) {
    process.exitCode = 1;
  }
}
