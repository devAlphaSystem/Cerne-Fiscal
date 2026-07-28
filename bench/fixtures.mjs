import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createCanvas } from "@napi-rs/canvas";

const OUTPUT_DIRECTORY = fileURLToPath(new URL("./fixtures/", import.meta.url));

const PAGE_WIDTH = 1654;
const PAGE_HEIGHT = 2339;

function modulo11(body) {
  let sum = 0;
  let weight = 2;
  for (let index = body.length - 1; index >= 0; index -= 1) {
    sum += (body.charCodeAt(index) - 48) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const remainder = sum % 11;
  return remainder === 0 || remainder === 1 ? 0 : 11 - remainder;
}

function cnpj14() {
  const base = "112223330001";
  const first = modulo11(base);
  return `${base}${first}${modulo11(`${base}${first}`)}`;
}

function accessKey(model = "55") {
  const state = "35";
  const issuedAt = "2601";
  const series = "001";
  const number = "000012345";
  const issuerType = "1";
  const randomCode = "12345678";
  const body = `${state}${issuedAt}${cnpj14()}${model}${series}${number}${issuerType}${randomCode}`;
  return `${body}${modulo11(body)}`;
}

function formatAccessKey(key) {
  return key.match(/.{1,4}/gu).join(" ");
}

const CODE128_PATTERNS = "212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112".split(" ");

const CODE128_START_C = 105;
const CODE128_STOP = 106;

function code128cModules(digits) {
  const values = [CODE128_START_C];
  for (let index = 0; index < digits.length; index += 2) {
    values.push(Number(digits.slice(index, index + 2)));
  }
  let checksum = CODE128_START_C;
  for (let index = 1; index < values.length; index += 1) {
    checksum += values[index] * index;
  }
  values.push(checksum % 103, CODE128_STOP);

  const widths = [];
  for (const value of values) {
    for (const element of CODE128_PATTERNS[value]) {
      widths.push(Number(element));
    }
  }
  return widths;
}

function drawLinear(context, widths, x, y, unit, height) {
  let cursor = x;
  let isBar = true;
  for (const width of widths) {
    if (isBar) {
      context.fillStyle = "#000000";
      context.fillRect(Math.round(cursor), y, Math.round(width * unit), height);
    }
    cursor += width * unit;
    isBar = !isBar;
  }
}

function newPage() {
  const canvas = createCanvas(PAGE_WIDTH, PAGE_HEIGHT);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
  return { canvas, context };
}

function label(context, text, x, y, size = 22, bold = false) {
  context.fillStyle = "#000000";
  context.font = `${bold ? "bold " : ""}${size}px Arial`;
  context.fillText(text, x, y);
}

const DANFE_ROWS = [
  ["NATUREZA DA OPERACAO", "VENDA DE MERCADORIA"],
  ["PROTOCOLO DE AUTORIZACAO DE USO", "135260000123456 - 25/07/2026 10:15:00"],
  ["INSCRICAO ESTADUAL", "111.222.333.444"],
  ["CNPJ", "11.222.333/0001-81"],
  ["DESTINATARIO / REMETENTE", "EMPRESA EXEMPLO LTDA"],
  ["ENDERECO", "RUA DAS FLORES, 1000 - CENTRO"],
  ["MUNICIPIO", "SAO PAULO"],
  ["UF", "SP"],
  ["CEP", "01000-000"],
  ["DATA DA EMISSAO", "25/07/2026"],
  ["DATA DA SAIDA/ENTRADA", "25/07/2026"],
  ["BASE DE CALCULO DO ICMS", "1.234,56"],
  ["VALOR DO ICMS", "222,22"],
  ["VALOR TOTAL DOS PRODUTOS", "1.234,56"],
  ["VALOR DO FRETE", "0,00"],
  ["VALOR TOTAL DA NOTA", "1.234,56"],
  ["TRANSPORTADOR", "TRANSPORTES EXEMPLO LTDA"],
  ["DADOS DOS PRODUTOS / SERVICOS", "0001 - PRODUTO DE EXEMPLO - UN - 1,000 - 1.234,56"],
  ["DADOS ADICIONAIS", "DOCUMENTO EMITIDO POR ME OPTANTE PELO SIMPLES NACIONAL"],
];

function danfePage({ withBarcode = true, withKey = true } = {}) {
  const { canvas, context } = newPage();
  const key = accessKey("55");

  context.strokeStyle = "#000000";
  context.lineWidth = 2;

  if (withBarcode) {
    drawLinear(context, code128cModules(key), 200, 150, 4, 120);
  }
  label(context, "CHAVE DE ACESSO", 200, 320, 20);
  if (withKey) {
    label(context, formatAccessKey(key), 200, 355, 26, true);
  }
  label(context, "Consulta de autenticidade no portal nacional da NF-e", 200, 395, 18);

  context.strokeRect(90, 420, PAGE_WIDTH - 180, 1300);
  label(context, "DANFE", 110, 470, 40, true);
  label(context, "Documento Auxiliar da Nota Fiscal Eletronica", 400, 470, 20);
  label(context, "0 - ENTRADA    1 - SAIDA", 110, 505, 20);
  label(context, "N. 000.012.345    SERIE 001", 110, 545, 26, true);

  let y = 610;
  for (const [name, value] of DANFE_ROWS) {
    label(context, name, 110, y, 18);
    label(context, value, 110, y + 30, 24);
    context.beginPath();
    context.moveTo(100, y + 46);
    context.lineTo(PAGE_WIDTH - 100, y + 46);
    context.stroke();
    y += 62;
  }
  return { canvas, key };
}

function noisePage() {
  const { canvas, context } = newPage();
  label(context, "RELATORIO GERENCIAL DE MOVIMENTACAO", 110, 180, 34, true);
  let y = 260;
  for (let row = 0; row < 40; row += 1) {
    label(context, `Linha ${row + 1} - Centro de custo 1234 - Valor 9.876,54 - Ref 2026-07-25`, 110, y, 22);
    y += 40;
  }
  return canvas;
}

function degrade(sourceCanvas) {
  const small = createCanvas(Math.round(PAGE_WIDTH * 0.55), Math.round(PAGE_HEIGHT * 0.55));
  const smallContext = small.getContext("2d");
  smallContext.filter = "blur(1.5px)";
  smallContext.drawImage(sourceCanvas, 0, 0, small.width, small.height);

  const canvas = createCanvas(PAGE_WIDTH, PAGE_HEIGHT);
  const context = canvas.getContext("2d");
  context.drawImage(small, 0, 0, PAGE_WIDTH, PAGE_HEIGHT);
  const imageData = context.getImageData(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
  const data = imageData.data;
  let seed = 20260725;
  for (let offset = 0; offset < data.length; offset += 4) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const noise = ((seed >> 16) % 41) - 20;
    data[offset] += noise;
    data[offset + 1] += noise;
    data[offset + 2] += noise;
  }
  context.putImageData(imageData, 0, 0);
  return canvas;
}

function pdfFromObjects(objects) {
  const header = Buffer.from("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n", "latin1");
  const chunks = [header];
  const offsets = [0];
  let position = header.length;
  for (const [index, body] of objects.entries()) {
    const object = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`, "latin1"), Buffer.isBuffer(body) ? body : Buffer.from(body, "latin1"), Buffer.from("\nendobj\n", "latin1")]);
    offsets.push(position);
    chunks.push(object);
    position += object.length;
  }
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) {
    xref += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${position}\n%%EOF\n`;
  chunks.push(Buffer.from(xref, "latin1"));
  return Buffer.concat(chunks);
}

function pdfStream(dictionary, data) {
  return Buffer.concat([Buffer.from(`<< ${dictionary} /Length ${data.length} >>\nstream\n`, "latin1"), data, Buffer.from("\nendstream", "latin1")]);
}

function escapePdfText(text) {
  return text.replace(/([\\()])/gu, "\\$1");
}

function imagePdf(jpeg, width, height) {
  return pdfFromObjects(["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>", pdfStream(`/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`, jpeg), pdfStream("", Buffer.from("q 595 0 0 842 0 0 cm /Im0 Do Q\n", "latin1"))]);
}

function textPdf(lines) {
  let content = "BT /F1 9 Tf 12 TL 40 800 Td\n";
  for (const line of lines) {
    content += `(${escapePdfText(line)}) Tj T*\n`;
  }
  content += "ET\n";
  return pdfFromObjects(["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>", pdfStream("", Buffer.from(content, "latin1"))]);
}

function vectorPdf(lines, widths, barcode) {
  let content = "BT /F1 9 Tf 12 TL 40 800 Td\n";
  for (const line of lines) {
    content += `(${escapePdfText(line)}) Tj T*\n`;
  }
  content += "ET\n0 0 0 rg\n";
  let cursor = barcode.x;
  let isBar = true;
  for (const width of widths) {
    if (isBar) {
      content += `${cursor.toFixed(3)} ${barcode.y} ${(width * barcode.unit).toFixed(3)} ${barcode.height} re f\n`;
    }
    cursor += width * barcode.unit;
    isBar = !isBar;
  }
  return pdfFromObjects(["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>", pdfStream("", Buffer.from(content, "latin1"))]);
}

mkdirSync(OUTPUT_DIRECTORY, { recursive: true });

function write(name, data) {
  writeFileSync(join(OUTPUT_DIRECTORY, name), data);
}

const danfe = danfePage();
const danfeWithoutKey = danfePage({ withKey: false });
const noise = noisePage();

const danfeTextLines = ["DANFE - Documento Auxiliar da Nota Fiscal Eletronica", `CHAVE DE ACESSO ${formatAccessKey(danfe.key)}`, "NATUREZA DA OPERACAO: VENDA DE MERCADORIA", "PROTOCOLO DE AUTORIZACAO DE USO: 135260000123456 - 25/07/2026", "VALOR TOTAL DA NOTA: 1.234,56"];
const vectorBarcode = { x: 300, y: 745, unit: 0.72, height: 30 };

write("danfe.png", danfe.canvas.toBuffer("image/png"));
write("danfe.jpg", danfe.canvas.toBuffer("image/jpeg", 82));
write("danfe-blur.jpg", degrade(danfe.canvas).toBuffer("image/jpeg", 45));
write("danfe-scan.pdf", imagePdf(danfe.canvas.toBuffer("image/jpeg", 82), PAGE_WIDTH, PAGE_HEIGHT));
write("danfe-scan-barcode-only.pdf", imagePdf(danfeWithoutKey.canvas.toBuffer("image/jpeg", 82), PAGE_WIDTH, PAGE_HEIGHT));
write("danfe-native.pdf", textPdf(danfeTextLines));
write("danfe-vector.pdf", vectorPdf(danfeTextLines, code128cModules(danfe.key), vectorBarcode));
write("danfe-vector-barcode-only.pdf", vectorPdf(["DANFE"], code128cModules(danfe.key), vectorBarcode));
write("nomatch.jpg", noise.toBuffer("image/jpeg", 82));
write("nomatch-scan.pdf", imagePdf(noise.toBuffer("image/jpeg", 82), PAGE_WIDTH, PAGE_HEIGHT));

console.log(`Chave de acesso: ${danfe.key}`);
console.log(`Fixtures geradas em ${OUTPUT_DIRECTORY}`);
