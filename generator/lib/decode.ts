/**
 * Minimal runtime decoding helpers so that everything coming back from the
 * network is validated before it is trusted. Each helper throws a
 * `DecodeError` with a path-like context string when the shape is wrong.
 */

export type JsonRecord = Record<string, unknown>;

export class DecodeError extends Error {
  constructor(context: string, expected: string, actual: unknown) {
    super(`${context}: expected ${expected}, got ${describe(actual)}`);
    this.name = 'DecodeError';
  }
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `array(${value.length})`;
  if (typeof value === 'object') return 'object';
  if (typeof value === 'string') return `string "${value.length > 40 ? `${value.slice(0, 40)}…` : value}"`;
  return typeof value;
}

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function expectRecord(value: unknown, context: string): JsonRecord {
  if (!isRecord(value)) throw new DecodeError(context, 'object', value);
  return value;
}

export function expectArray(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value)) throw new DecodeError(context, 'array', value);
  return value;
}

export function expectString(value: unknown, context: string): string {
  if (typeof value !== 'string') throw new DecodeError(context, 'string', value);
  return value;
}

export function expectNumber(value: unknown, context: string): number {
  if (typeof value !== 'number' || Number.isNaN(value)) throw new DecodeError(context, 'number', value);
  return value;
}

export function optionalString(value: unknown, context: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return expectString(value, context);
}

export function optionalNumber(value: unknown, context: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  return expectNumber(value, context);
}

export function optionalBoolean(value: unknown, context: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') throw new DecodeError(context, 'boolean', value);
  return value;
}

export function optionalStringArray(value: unknown, context: string): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  return expectArray(value, context).map((item, i) => expectString(item, `${context}[${i}]`));
}

export function expectNumberArray(value: unknown, context: string): number[] {
  return expectArray(value, context).map((item, i) => expectNumber(item, `${context}[${i}]`));
}

export function decodeArray<T>(value: unknown, context: string, decode: (item: unknown, ctx: string) => T): T[] {
  return expectArray(value, context).map((item, i) => decode(item, `${context}[${i}]`));
}

export function optionalArray<T>(
  value: unknown,
  context: string,
  decode: (item: unknown, ctx: string) => T,
): T[] | undefined {
  if (value === undefined || value === null) return undefined;
  return decodeArray(value, context, decode);
}
