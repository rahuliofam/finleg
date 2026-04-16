"use client";

import { useState } from "react";
import { useForm } from "@/lib/use-form";
import {
  email as emailRule,
  maxLength,
  minLength,
  required,
  type ValidationSchema,
} from "@/lib/validation";

interface ContactFormValues extends Record<string, unknown> {
  name: string;
  email: string;
  message: string;
}

const schema: ValidationSchema<ContactFormValues> = {
  name: [required("Please enter your name"), maxLength(120)],
  email: [required("Please enter your email"), emailRule()],
  message: [
    required("Please enter a message"),
    minLength(10, "Message must be at least 10 characters"),
    maxLength(5000, "Message is too long (max 5000 characters)"),
  ],
};

export default function ContactPage() {
  const [sent, setSent] = useState(false);

  const form = useForm<ContactFormValues>({
    initialValues: { name: "", email: "", message: "" },
    schema,
    onSubmit: async () => {
      // No backend wired up yet; mirror prior behavior (no-op) but surface success.
      setSent(true);
      form.reset({ name: "", email: "", message: "" });
    },
  });

  const fieldError = (name: keyof ContactFormValues & string) =>
    form.touched[name] && form.errors[name] ? form.errors[name] : null;

  const inputCls = (name: keyof ContactFormValues & string) =>
    `w-full rounded-lg border px-4 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500 ${
      fieldError(name) ? "border-red-400" : "border-slate-300"
    }`;

  return (
    <div className="py-20 px-6">
      <div className="max-w-xl mx-auto">
        <h1 className="text-4xl font-bold mb-4">Contact Us</h1>
        <p className="text-lg text-slate-600 mb-10">
          Get in touch with the Finleg team.
        </p>

        {sent && (
          <div className="mb-6 text-sm rounded-lg px-4 py-3 bg-green-50 border border-green-200 text-green-700">
            Thanks! Your message has been sent.
          </div>
        )}

        <form className="space-y-6" onSubmit={form.handleSubmit} noValidate>
          <div>
            <label
              htmlFor="name"
              className="block text-sm font-medium text-slate-700 mb-1"
            >
              Your Name
            </label>
            <input
              id="name"
              name="name"
              type="text"
              value={form.values.name}
              onChange={form.handleChange}
              onBlur={form.handleBlur}
              aria-invalid={fieldError("name") ? true : undefined}
              aria-describedby={fieldError("name") ? "name-error" : undefined}
              className={inputCls("name")}
            />
            {fieldError("name") && (
              <p id="name-error" className="mt-1 text-xs text-red-600">
                {form.errors.name}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-slate-700 mb-1"
            >
              Your Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              value={form.values.email}
              onChange={form.handleChange}
              onBlur={form.handleBlur}
              aria-invalid={fieldError("email") ? true : undefined}
              aria-describedby={fieldError("email") ? "email-error" : undefined}
              className={inputCls("email")}
            />
            {fieldError("email") && (
              <p id="email-error" className="mt-1 text-xs text-red-600">
                {form.errors.email}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="message"
              className="block text-sm font-medium text-slate-700 mb-1"
            >
              Your Message
            </label>
            <textarea
              id="message"
              name="message"
              rows={5}
              value={form.values.message}
              onChange={form.handleChange}
              onBlur={form.handleBlur}
              aria-invalid={fieldError("message") ? true : undefined}
              aria-describedby={fieldError("message") ? "message-error" : undefined}
              className={inputCls("message")}
            />
            {fieldError("message") && (
              <p id="message-error" className="mt-1 text-xs text-red-600">
                {form.errors.message}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={form.submitting}
            className="w-full px-6 py-3 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
          >
            {form.submitting ? "Sending..." : "Send Message"}
          </button>
        </form>
      </div>
    </div>
  );
}
