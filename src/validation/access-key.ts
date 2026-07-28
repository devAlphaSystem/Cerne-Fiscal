const NUMERIC_ACCESS_KEY_PATTERN = /^[0-9]{44}$/;
const CURRENT_ACCESS_KEY_PATTERN = /^[0-9]{6}[A-Z0-9]{12}[0-9]{26}$/;
const ACCESS_KEY_BODY_PATTERN = /^[0-9]{6}[A-Z0-9]{12}[0-9]{25}$/;
const ISSUER_IDENTIFIER_PATTERN = /^[A-Z0-9]{12}[0-9]{2}$/;
const ZERO_PADDED_CPF_PATTERN = /^000[0-9]{11}$/;

const VALID_STATE_CODES = new Set(["11", "12", "13", "14", "15", "16", "17", "21", "22", "23", "24", "25", "26", "27", "28", "29", "31", "32", "33", "35", "41", "42", "43", "50", "51", "52", "53"]);

const ACCESS_KEY_DOCUMENT_TYPES = {
  "55": "NFe",
  "65": "NFCe",
} as const;

const SUPPORTED_MODELS = Object.keys(ACCESS_KEY_DOCUMENT_TYPES);

/**
 * Enumerates the stable issue codes produced by access-key validation.
 *
 * @enum {string}
 * @readonly
 * @since 0.1.0
 */
export const ACCESS_KEY_ISSUE_CODES = {
  INVALID_FORMAT: "INVALID_FORMAT",
  INVALID_CHECK_DIGIT: "INVALID_CHECK_DIGIT",
  INVALID_MODEL: "INVALID_MODEL",
  INVALID_STATE_CODE: "INVALID_STATE_CODE",
  INVALID_MONTH: "INVALID_MONTH",
  INVALID_ISSUER_IDENTIFIER: "INVALID_ISSUER_IDENTIFIER",
  INVALID_INVOICE_NUMBER: "INVALID_INVOICE_NUMBER",
} as const;

/**
 * Identifies a machine-readable issue produced by access-key validation.
 *
 * @since 0.1.0
 */
export type AccessKeyIssueCode = (typeof ACCESS_KEY_ISSUE_CODES)[keyof typeof ACCESS_KEY_ISSUE_CODES];

/**
 * Identifies whether an access key uses a numeric or alphanumeric issuer segment.
 *
 * @since 0.1.0
 */
export type AccessKeyFormat = "numeric" | "alphanumeric";

/**
 * Identifies a supported two-digit fiscal document model.
 *
 * @since 0.1.0
 */
export type AccessKeyModel = keyof typeof ACCESS_KEY_DOCUMENT_TYPES;

/**
 * Identifies a supported fiscal document type.
 *
 * @since 0.1.0
 */
export type AccessKeyDocumentType = (typeof ACCESS_KEY_DOCUMENT_TYPES)[AccessKeyModel];

/**
 * Resolves the fiscal document type associated with a supported model.
 *
 * @template {AccessKeyModel} TModel - Identifies the model whose document type is resolved.
 * @since 0.1.0
 */
export type AccessKeyDocumentTypeForModel<TModel extends AccessKeyModel> = (typeof ACCESS_KEY_DOCUMENT_TYPES)[TModel];

/**
 * Describes one structural, semantic, or checksum problem found in an access key.
 *
 * @since 0.1.0
 */
export interface AccessKeyIssue {
  /**
   * Identifies the validation rule that failed.
   */
  code: AccessKeyIssueCode;
  /**
   * Explains the invalid field or relationship in human-readable form.
   */
  message: string;
}

/**
 * Represents the fields parsed from a structurally supported 44-character access key.
 *
 * @since 0.1.0
 */
export interface AccessKeyComponents {
  /**
   * Contains the normalized uppercase access key.
   */
  accessKey: string;
  /**
   * Identifies the numeric or alphanumeric access-key format.
   */
  format: AccessKeyFormat;
  /**
   * Contains the two-digit issuing-state code field, including unsupported values.
   */
  stateCode: string;
  /**
   * Contains the four-digit issue year and month in `YYMM` form.
   */
  yearMonth: string;
  /**
   * Contains the two-digit issue year.
   */
  year: string;
  /**
   * Contains the two-digit issue month.
   */
  month: string;
  /**
   * Contains the 14-character issuer-identifier field interpreted as a CNPJ or zero-padded CPF.
   */
  issuerId: string;
  /**
   * Contains the raw two-digit fiscal model, including unsupported values.
   */
  model: string;
  /**
   * Identifies the supported document type, or `null` for an unknown model.
   */
  documentType: AccessKeyDocumentType | null;
  /**
   * Contains the three-digit document series.
   */
  series: string;
  /**
   * Contains the nine-digit invoice number.
   */
  invoiceNumber: string;
  /**
   * Contains the one-digit emission type.
   */
  emissionType: string;
  /**
   * Contains the eight-digit numeric code assigned by the issuer.
   */
  numericCode: string;
  /**
   * Contains the final modulo-11 check digit.
   */
  checkDigit: number;
}

/**
 * Reports validation state, parsed components, and every detected access-key issue.
 *
 * @since 0.1.0
 */
export interface AccessKeyValidation {
  /**
   * Indicates whether the access key passed every validation rule.
   */
  isValid: boolean;
  /**
   * Contains the uppercase input used during validation.
   */
  normalizedValue: string;
  /**
   * Identifies the detected format, or `null` when the input is structurally invalid.
   */
  format: AccessKeyFormat | null;
  /**
   * Provides parsed fields, or `null` when the input format is unsupported.
   */
  components: AccessKeyComponents | null;
  /**
   * Provides the calculated check digit, or `null` when it cannot be calculated.
   */
  expectedCheckDigit: number | null;
  /**
   * Lists every validation issue found in deterministic rule order.
   */
  issues: AccessKeyIssue[];
}

function normalizeAccessKey(value: unknown): string {
  return typeof value === "string" ? value.toUpperCase() : "";
}

function getAccessKeyFormat(value: string): AccessKeyFormat | null {
  if (NUMERIC_ACCESS_KEY_PATTERN.test(value)) {
    return "numeric";
  }

  if (CURRENT_ACCESS_KEY_PATTERN.test(value)) {
    return "alphanumeric";
  }

  return null;
}

function isAccessKeyModel(model: string): model is AccessKeyModel {
  return Object.hasOwn(ACCESS_KEY_DOCUMENT_TYPES, model);
}

function getDocumentType(model: string): AccessKeyDocumentType | null {
  return isAccessKeyModel(model) ? ACCESS_KEY_DOCUMENT_TYPES[model] : null;
}

function calculateAsciiModulo11Digit(body: string): number {
  let sum = 0;
  let weight = 2;

  for (let index = body.length - 1; index >= 0; index -= 1) {
    sum += (body.charCodeAt(index) - 48) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }

  const remainder = sum % 11;
  return remainder === 0 || remainder === 1 ? 0 : 11 - remainder;
}

function hasRepeatedCharacters(value: string): boolean {
  return value.length > 0 && new Set(value).size === 1;
}

function validateCnpj(value: string): boolean {
  const base = value.slice(0, 12);

  if (hasRepeatedCharacters(base)) {
    return false;
  }

  const firstCheckDigit = calculateAsciiModulo11Digit(base);
  const secondCheckDigit = calculateAsciiModulo11Digit(`${base}${firstCheckDigit}`);

  return value.slice(12) === `${firstCheckDigit}${secondCheckDigit}`;
}

function calculateCpfCheckDigit(body: string): number {
  let sum = 0;

  for (let index = 0; index < body.length; index += 1) {
    sum += (body.charCodeAt(index) - 48) * (body.length + 1 - index);
  }

  const remainder = sum % 11;
  return remainder === 0 || remainder === 1 ? 0 : 11 - remainder;
}

function validateZeroPaddedCpf(value: string): boolean {
  if (!ZERO_PADDED_CPF_PATTERN.test(value)) {
    return false;
  }

  const cpf = value.slice(3);
  const base = cpf.slice(0, 9);

  if (hasRepeatedCharacters(cpf) || hasRepeatedCharacters(base)) {
    return false;
  }

  const firstCheckDigit = calculateCpfCheckDigit(base);
  const secondCheckDigit = calculateCpfCheckDigit(`${base}${firstCheckDigit}`);

  return cpf.slice(9) === `${firstCheckDigit}${secondCheckDigit}`;
}

/**
 * Validates a 14-character issuer identifier as a CNPJ or zero-padded CPF.
 *
 * @param {string} value - Supplies the issuer identifier to validate.
 * @returns {boolean} Returns `true` when the identifier has a valid supported checksum.
 * @since 0.1.0
 */
export function validateIssuerIdentifier(value: string): boolean {
  const normalizedValue = normalizeAccessKey(value);

  if (!ISSUER_IDENTIFIER_PATTERN.test(normalizedValue)) {
    return false;
  }

  return validateCnpj(normalizedValue) || validateZeroPaddedCpf(normalizedValue);
}

/**
 * Calculates the modulo-11 check digit for a supported 43-character access-key body.
 *
 * @param {string} body - Supplies the access-key body without its final check digit.
 * @returns {number} Returns the calculated check digit from 0 through 9.
 * @throws {TypeError} Throws when the body does not match a supported 43-character format.
 * @since 0.1.0
 *
 * @example
 * const digit = calculateAccessKeyCheckDigit("3526071234567800019555001000000001112345678");
 */
export function calculateAccessKeyCheckDigit(body: string): number {
  const normalizedBody = normalizeAccessKey(body);

  if (!ACCESS_KEY_BODY_PATTERN.test(normalizedBody)) {
    throw new TypeError("Access key body must have 43 characters and match the supported access key format.");
  }

  return calculateAsciiModulo11Digit(normalizedBody);
}

/**
 * Parses the fixed-position fields of a structurally supported access key.
 *
 * @param {string} value - Supplies the complete 44-character access key to parse.
 * @returns {AccessKeyComponents} Returns normalized fields without asserting their semantic validity.
 * @throws {TypeError} Throws when the value does not match a supported 44-character format.
 * @since 0.1.0
 *
 * @example
 * const components = parseAccessKey("35260712345678000195550010000000011123456784");
 * console.log(components.model);
 */
export function parseAccessKey(value: string): AccessKeyComponents {
  const normalizedValue = normalizeAccessKey(value);
  const format = getAccessKeyFormat(normalizedValue);

  if (format === null) {
    throw new TypeError("Access key does not match a supported 44-character format.");
  }

  const model = normalizedValue.slice(20, 22);
  const yearMonth = normalizedValue.slice(2, 6);

  return {
    accessKey: normalizedValue,
    format,
    stateCode: normalizedValue.slice(0, 2),
    yearMonth,
    year: yearMonth.slice(0, 2),
    month: yearMonth.slice(2, 4),
    issuerId: normalizedValue.slice(6, 20),
    model,
    documentType: getDocumentType(model),
    series: normalizedValue.slice(22, 25),
    invoiceNumber: normalizedValue.slice(25, 34),
    emissionType: normalizedValue.slice(34, 35),
    numericCode: normalizedValue.slice(35, 43),
    checkDigit: Number(normalizedValue[43]),
  };
}

/**
 * Validates the format, fiscal fields, issuer identifier, and check digit of an access key.
 *
 * @param {string} value - Supplies the complete access key to validate.
 * @returns {AccessKeyValidation} Returns parsed fields and all detected issues without throwing for invalid input.
 * @since 0.1.0
 *
 * @example
 * const validation = validateAccessKey("35260712345678000195550010000000011123456784");
 * console.log(validation.isValid);
 */
export function validateAccessKey(value: string): AccessKeyValidation {
  const normalizedValue = normalizeAccessKey(value);
  const format = getAccessKeyFormat(normalizedValue);

  if (format === null) {
    return {
      isValid: false,
      normalizedValue,
      format: null,
      components: null,
      expectedCheckDigit: null,
      issues: [
        {
          code: ACCESS_KEY_ISSUE_CODES.INVALID_FORMAT,
          message: "Access key does not match a supported 44-character format.",
        },
      ],
    };
  }

  const components = parseAccessKey(normalizedValue);
  const expectedCheckDigit = calculateAccessKeyCheckDigit(normalizedValue.slice(0, 43));
  const issues: AccessKeyIssue[] = [];

  if (!VALID_STATE_CODES.has(components.stateCode)) {
    issues.push({
      code: ACCESS_KEY_ISSUE_CODES.INVALID_STATE_CODE,
      message: `State code ${components.stateCode} is not an official IBGE UF code.`,
    });
  }

  const month = Number(components.month);
  if (month < 1 || month > 12) {
    issues.push({
      code: ACCESS_KEY_ISSUE_CODES.INVALID_MONTH,
      message: `Month ${components.month} must be between 01 and 12.`,
    });
  }

  if (!isAccessKeyModel(components.model)) {
    issues.push({
      code: ACCESS_KEY_ISSUE_CODES.INVALID_MODEL,
      message: `Model ${components.model} is not supported; expected ${SUPPORTED_MODELS.join(" or ")}.`,
    });
  }

  if (components.invoiceNumber === "000000000") {
    issues.push({
      code: ACCESS_KEY_ISSUE_CODES.INVALID_INVOICE_NUMBER,
      message: "Invoice number must be between 000000001 and 999999999.",
    });
  }

  if (!validateIssuerIdentifier(components.issuerId)) {
    issues.push({
      code: ACCESS_KEY_ISSUE_CODES.INVALID_ISSUER_IDENTIFIER,
      message: `Issuer identifier ${components.issuerId} is not a valid CNPJ or zero-padded CPF.`,
    });
  }

  if (components.checkDigit !== expectedCheckDigit) {
    issues.push({
      code: ACCESS_KEY_ISSUE_CODES.INVALID_CHECK_DIGIT,
      message: `Check digit ${components.checkDigit} does not match expected digit ${expectedCheckDigit}.`,
    });
  }

  return {
    isValid: issues.length === 0,
    normalizedValue,
    format,
    components,
    expectedCheckDigit,
    issues,
  };
}

/**
 * Checks whether an access key is valid and belongs to the expected fiscal model.
 *
 * @param {string} value - Supplies the complete access key to validate.
 * @param {AccessKeyModel} expectedModel - Selects the fiscal model the key must contain.
 * @returns {boolean} Returns `true` when the key is valid and its model matches the expectation.
 */
export function isValidAccessKeyForModel(value: string, expectedModel: AccessKeyModel): boolean {
  const validation = validateAccessKey(value);
  return validation.isValid && validation.components?.model === expectedModel;
}
