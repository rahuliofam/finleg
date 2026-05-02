"use client";

import { useCallback, useRef, useState } from "react";
import {
  validate,
  validateField,
  type ValidationSchema,
} from "@/lib/validation";

type FormValues = Record<string, unknown>;

export interface UseFormOptions<T extends FormValues> {
  initialValues: T;
  schema?: ValidationSchema<T>;
  onSubmit: (values: T) => void | Promise<void>;
  /** Re-validate a field on change once it has been touched. Defaults to true. */
  validateOnChange?: boolean;
}

export interface UseFormReturn<T extends FormValues> {
  values: T;
  errors: Record<string, string>;
  touched: Record<string, boolean>;
  submitting: boolean;
  /** True after the user has tried to submit at least once. */
  submitAttempted: boolean;
  /** Change handler compatible with native input/select/textarea. */
  handleChange: (
    event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => void;
  /** Blur handler: marks the field touched and validates it. */
  handleBlur: (
    event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => void;
  /** Submit handler: validates, marks all touched, and invokes onSubmit when valid. */
  handleSubmit: (event?: React.FormEvent) => Promise<void>;
  /** Imperatively set a single field's value (e.g. from a custom control). */
  setFieldValue: <K extends keyof T>(field: K, value: T[K]) => void;
  /** Imperatively set or clear a field error (e.g. server-side errors). */
  setFieldError: (field: keyof T & string, error: string | null) => void;
  /** Replace all errors at once (e.g. server-side validation response). */
  setErrors: (errors: Record<string, string>) => void;
  /** Reset to initial values. Optionally pass new initial values. */
  reset: (nextInitialValues?: T) => void;
}

/**
 * Minimal, dependency-free form hook.
 *
 * Pair with a schema from `@/lib/validation`:
 *
 *   const form = useForm({
 *     initialValues: { email: "", name: "" },
 *     schema: { email: [required(), email()], name: [required()] },
 *     onSubmit: async (values) => { ... },
 *   });
 *
 *   <input
 *     name="email"
 *     value={form.values.email}
 *     onChange={form.handleChange}
 *     onBlur={form.handleBlur}
 *   />
 *   {form.touched.email && form.errors.email && <p>{form.errors.email}</p>}
 */
export function useForm<T extends FormValues>(
  options: UseFormOptions<T>,
): UseFormReturn<T> {
  const { schema, onSubmit, validateOnChange = true } = options;
  const initialRef = useRef(options.initialValues);
  const [values, setValues] = useState<T>(options.initialValues);
  const [errors, setErrorsState] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const coerceEventValue = (
    event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ): unknown => {
    const target = event.target as HTMLInputElement;
    if (target.type === "checkbox") return target.checked;
    if (target.type === "number") {
      // Empty stays empty string; otherwise coerce to number.
      return target.value === "" ? "" : Number(target.value);
    }
    return target.value;
  };

  const handleChange = useCallback(
    (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
    ) => {
      const name = event.target.name;
      if (!name) return;
      const value = coerceEventValue(event);

      setValues((prev) => ({ ...prev, [name]: value }) as T);

      if (!validateOnChange || !schema) return;
      // Only re-validate once the field has been touched or submit attempted.
      if (!touched[name] && !submitAttempted) return;
      const rules = schema[name as keyof T];
      if (!rules) return;
      const msg = validateField(value, rules, { ...values, [name]: value });
      setErrorsState((prev) => {
        const next = { ...prev };
        if (msg) next[name] = msg;
        else delete next[name];
        return next;
      });
    },
    [schema, validateOnChange, touched, submitAttempted, values],
  );

  const handleBlur = useCallback(
    (
      event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
    ) => {
      const name = event.target.name;
      if (!name) return;
      setTouched((prev) => (prev[name] ? prev : { ...prev, [name]: true }));
      if (!schema) return;
      const rules = schema[name as keyof T];
      if (!rules) return;
      const msg = validateField(values[name as keyof T], rules, values);
      setErrorsState((prev) => {
        const next = { ...prev };
        if (msg) next[name] = msg;
        else delete next[name];
        return next;
      });
    },
    [schema, values],
  );

  const handleSubmit = useCallback(
    async (event?: React.FormEvent) => {
      if (event && typeof event.preventDefault === "function") {
        event.preventDefault();
      }
      setSubmitAttempted(true);

      let nextErrors: Record<string, string> = {};
      if (schema) {
        const result = validate(values, schema);
        nextErrors = result.errors;
        setErrorsState(nextErrors);
      }

      // Mark every schema field + existing value key as touched so errors render.
      const touchedKeys = new Set<string>([
        ...Object.keys(values),
        ...(schema ? Object.keys(schema) : []),
      ]);
      const allTouched: Record<string, boolean> = {};
      touchedKeys.forEach((k) => { allTouched[k] = true; });
      setTouched(allTouched);

      if (Object.keys(nextErrors).length > 0) return;

      setSubmitting(true);
      try {
        await onSubmit(values);
      } finally {
        setSubmitting(false);
      }
    },
    [schema, values, onSubmit],
  );

  const setFieldValue = useCallback(
    <K extends keyof T>(field: K, value: T[K]) => {
      setValues((prev) => ({ ...prev, [field]: value }) as T);
    },
    [],
  );

  const setFieldError = useCallback((field: keyof T & string, error: string | null) => {
    setErrorsState((prev) => {
      const next = { ...prev };
      if (error) next[field] = error;
      else delete next[field];
      return next;
    });
  }, []);

  const setErrors = useCallback((next: Record<string, string>) => {
    setErrorsState(next);
  }, []);

  const reset = useCallback((nextInitialValues?: T) => {
    const target = nextInitialValues ?? initialRef.current;
    initialRef.current = target;
    setValues(target);
    setErrorsState({});
    setTouched({});
    setSubmitAttempted(false);
    setSubmitting(false);
  }, []);

  return {
    values,
    errors,
    touched,
    submitting,
    submitAttempted,
    handleChange,
    handleBlur,
    handleSubmit,
    setFieldValue,
    setFieldError,
    setErrors,
    reset,
  };
}
