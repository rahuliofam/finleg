/**
 * Lightweight, dependency-free validation layer.
 *
 * Usage:
 *   const schema: ValidationSchema<{ email: string; name: string }> = {
 *     email: [required(), email()],
 *     name: [required(), minLength(2)],
 *   };
 *   const { valid, errors } = validate(values, schema);
 *
 * Each validator returns `null` when the value is valid, or a string error message.
 * Field rules are evaluated in order and short-circuit on the first failure.
 */

export type Validator = (value: unknown, allValues?: Record<string, unknown>) => string | null;

export type ValidationSchema<T extends Record<string, unknown> = Record<string, unknown>> = {
  [K in keyof T]?: Validator[];
};

export interface ValidationResult {
  valid: boolean;
  errors: Record<string, string>;
}

// --- helpers -----------------------------------------------------------------

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

// --- validators --------------------------------------------------------------

export function required(message = "This field is required"): Validator {
  return (value) => (isEmpty(value) ? message : null);
}

export function email(message = "Enter a valid email address"): Validator {
  // RFC 5322-ish; intentionally simple and permissive.
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return (value) => {
    if (isEmpty(value)) return null;
    return re.test(asString(value).trim()) ? null : message;
  };
}

export function minLength(min: number, message?: string): Validator {
  return (value) => {
    if (isEmpty(value)) return null;
    const s = asString(value);
    return s.length >= min ? null : message ?? `Must be at least ${min} characters`;
  };
}

export function maxLength(max: number, message?: string): Validator {
  return (value) => {
    if (isEmpty(value)) return null;
    const s = asString(value);
    return s.length <= max ? null : message ?? `Must be no more than ${max} characters`;
  };
}

export function pattern(regex: RegExp, message = "Invalid format"): Validator {
  return (value) => {
    if (isEmpty(value)) return null;
    return regex.test(asString(value)) ? null : message;
  };
}

export function number(message = "Must be a number"): Validator {
  return (value) => {
    if (isEmpty(value)) return null;
    const s = asString(value).trim();
    // Accept ints, decimals, negatives.
    return /^-?\d+(\.\d+)?$/.test(s) ? null : message;
  };
}

export function currency(message = "Enter a valid amount"): Validator {
  // Accepts 0, 0.00, 1,234.56, -1234.56, with optional leading $.
  return (value) => {
    if (isEmpty(value)) return null;
    const s = asString(value).trim().replace(/^\$/, "").replace(/,/g, "");
    return /^-?\d+(\.\d{1,2})?$/.test(s) ? null : message;
  };
}

export function date(message = "Enter a valid date"): Validator {
  return (value) => {
    if (isEmpty(value)) return null;
    const s = asString(value).trim();
    // Accept ISO (YYYY-MM-DD) or anything Date can parse; reject NaN.
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? message : null;
  };
}

export function url(message = "Enter a valid URL"): Validator {
  return (value) => {
    if (isEmpty(value)) return null;
    const s = asString(value).trim();
    try {
      const parsed = new URL(s);
      return parsed.protocol === "http:" || parsed.protocol === "https:" ? null : message;
    } catch {
      return message;
    }
  };
}

// --- entry point -------------------------------------------------------------

/**
 * Validate `values` against `schema`. Returns `{ valid, errors }`.
 * Only the first failing rule per field is reported.
 */
export function validate<T extends Record<string, unknown>>(
  values: T,
  schema: ValidationSchema<T>,
): ValidationResult {
  const errors: Record<string, string> = {};
  for (const key of Object.keys(schema) as Array<keyof T>) {
    const rules = schema[key];
    if (!rules || rules.length === 0) continue;
    const value = values[key];
    for (const rule of rules) {
      const msg = rule(value, values);
      if (msg) {
        errors[key as string] = msg;
        break;
      }
    }
  }
  return { valid: Object.keys(errors).length === 0, errors };
}

/**
 * Validate a single field against an array of rules. Returns the first error message
 * or `null`. Handy for `onBlur` validation of a single field.
 */
export function validateField(
  value: unknown,
  rules: Validator[],
  allValues?: Record<string, unknown>,
): string | null {
  for (const rule of rules) {
    const msg = rule(value, allValues);
    if (msg) return msg;
  }
  return null;
}
