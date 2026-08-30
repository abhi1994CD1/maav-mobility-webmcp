import {
  STRESS_LAB_CANONICALIZATION_VERSION,
  StressLabInputValidationError,
} from "./types";

export type CanonicalJsonPrimitive = string | number | boolean | null;
export type CanonicalJsonValue =
  | CanonicalJsonPrimitive
  | readonly CanonicalJsonValue[]
  | { readonly [key: string]: CanonicalJsonValue };

export interface CanonicalJsonDocument {
  readonly canonicalizationVersion: typeof STRESS_LAB_CANONICALIZATION_VERSION;
  readonly json: string;
}

function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function normalizedString(value: string, path: string): string {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (Number.isNaN(next) || next < 0xdc00 || next > 0xdfff) {
        throw new StressLabInputValidationError(
          "CANONICAL_UNPAIRED_SURROGATE",
          `Unpaired high surrogate at ${path}.`,
        );
      }
      index += 1;
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new StressLabInputValidationError(
        "CANONICAL_UNPAIRED_SURROGATE",
        `Unpaired low surrogate at ${path}.`,
      );
    }
  }
  return value.normalize("NFC");
}

function canonicalizeValue(
  value: unknown,
  path: string,
  ancestors: WeakSet<object>,
): CanonicalJsonValue {
  if (value === null) return null;

  if (typeof value === "string") return normalizedString(value, path);
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new StressLabInputValidationError(
        "CANONICAL_NON_FINITE_NUMBER",
        `Non-finite number at ${path}.`,
      );
    }
    return Object.is(value, -0) ? 0 : value;
  }

  if (
    typeof value === "undefined" ||
    typeof value === "function" ||
    typeof value === "symbol" ||
    typeof value === "bigint"
  ) {
    throw new StressLabInputValidationError(
      "CANONICAL_UNSUPPORTED_VALUE",
      `Unsupported ${typeof value} at ${path}.`,
    );
  }

  if (typeof value !== "object") {
    throw new StressLabInputValidationError(
      "CANONICAL_UNSUPPORTED_VALUE",
      `Unsupported value at ${path}.`,
    );
  }

  if (ancestors.has(value)) {
    throw new StressLabInputValidationError(
      "CANONICAL_CYCLIC_VALUE",
      `Cyclic value at ${path}.`,
    );
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const result: CanonicalJsonValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          throw new StressLabInputValidationError(
            "CANONICAL_SPARSE_ARRAY",
            `Sparse array entry at ${path}[${index}].`,
          );
        }
        result.push(canonicalizeValue(value[index], `${path}[${index}]`, ancestors));
      }
      return result;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new StressLabInputValidationError(
        "CANONICAL_NON_PLAIN_OBJECT",
        `Only plain objects are supported at ${path}.`,
      );
    }

    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new StressLabInputValidationError(
        "CANONICAL_SYMBOL_KEY",
        `Symbol keys are not supported at ${path}.`,
      );
    }

    const descriptors = Object.getOwnPropertyDescriptors(value);
    const normalizedEntries = Object.keys(descriptors).map((key) => {
      const descriptor = descriptors[key];
      if (!descriptor.enumerable) {
        throw new StressLabInputValidationError(
          "CANONICAL_NON_ENUMERABLE_PROPERTY",
          `Non-enumerable property at ${path}.${key}.`,
        );
      }
      if (!("value" in descriptor)) {
        throw new StressLabInputValidationError(
          "CANONICAL_ACCESSOR_PROPERTY",
          `Accessor property at ${path}.${key}.`,
        );
      }
      return {
        originalKey: key,
        normalizedKey: normalizedString(key, `${path} key`),
        value: descriptor.value,
      };
    });

    normalizedEntries.sort((left, right) =>
      compareCodeUnits(left.normalizedKey, right.normalizedKey),
    );

    const result: Record<string, CanonicalJsonValue> = {};
    let priorKey: string | undefined;
    for (const entry of normalizedEntries) {
      if (entry.normalizedKey === priorKey) {
        throw new StressLabInputValidationError(
          "CANONICAL_NORMALIZED_KEY_COLLISION",
          `Two keys normalize to ${entry.normalizedKey} at ${path}.`,
        );
      }
      priorKey = entry.normalizedKey;
      result[entry.normalizedKey] = canonicalizeValue(
        entry.value,
        `${path}.${entry.originalKey}`,
        ancestors,
      );
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalJson(value: unknown): string {
  const normalized = canonicalizeValue(value, "$", new WeakSet<object>());
  return JSON.stringify(normalized);
}

export function canonicalJsonDocument(value: unknown): CanonicalJsonDocument {
  return Object.freeze({
    canonicalizationVersion: STRESS_LAB_CANONICALIZATION_VERSION,
    json: canonicalJson(value),
  });
}
