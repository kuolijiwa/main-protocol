export function requireObject(
  value: unknown,
  name: string,
): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be a JSON object`);
  }
}

export function requireExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
  name: string,
): void {
  const expected = new Set(expectedKeys);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) throw new Error(`${name} contains unsupported field: ${key}`);
  }
  for (const key of expectedKeys) {
    if (!(key in value)) throw new Error(`${name} is missing required field: ${key}`);
  }
}

export function requirePositiveDecimal(value: unknown, name: string): bigint {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`${name} must be a positive decimal string`);
  }
  return BigInt(value);
}

export function requireCanonicalUtcTimestamp(value: unknown, name: string): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new Error(`${name} must be a canonical UTC timestamp`);
  }
  return value;
}
