"use client";

import { Suspense } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import CenteredBrandLayout from "@/components/centered-brand-layout";
import { useForm } from "@/lib/use-form";
import {
  email as emailRule,
  minLength,
  required,
  type ValidationSchema,
} from "@/lib/validation";

interface SignInValues extends Record<string, unknown> {
  email: string;
  password: string;
}

const signInSchema: ValidationSchema<SignInValues> = {
  email: [required("Email is required"), emailRule()],
  password: [required("Password is required"), minLength(1)],
};

function SignInContent() {
  const { user, loading, signInWithGoogle, signIn } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [showEmail, setShowEmail] = useState(false);
  const [authError, setAuthError] = useState("");

  const form = useForm<SignInValues>({
    initialValues: { email: "", password: "" },
    schema: signInSchema,
    onSubmit: async (values) => {
      setAuthError("");
      try {
        const { error: err } = await signIn(values.email, values.password);
        if (err) setAuthError(err.message);
      } catch {
        setAuthError("Sign in failed");
      }
    },
  });

  // Auto sign-in for automated testing: /signin?auto=1&redirect=/intranet
  const autoTriggeredRef = useRef(false);
  useEffect(() => {
    if (!loading && !user && !autoTriggeredRef.current && searchParams.get("auto") === "1") {
      autoTriggeredRef.current = true;
      signIn("tester@finleg.net", "M@akeSureItsG00d").catch(() => {});
    }
  }, [loading, user, searchParams, signIn]);

  useEffect(() => {
    if (!loading && user) {
      const redirect = searchParams.get("redirect") || "/intranet";
      router.replace(redirect);
    }
  }, [user, loading, router, searchParams]);

  if (loading || user) {
    return null;
  }

  const fieldError = (name: keyof SignInValues & string) =>
    form.touched[name] && form.errors[name] ? form.errors[name] : null;

  return (
    <CenteredBrandLayout>
      <p className="text-2xl text-slate-500 mb-10">
        Sign in to access your account
      </p>

      <button
        onClick={signInWithGoogle}
        className="w-full flex items-center justify-center gap-3 px-6 py-3.5 bg-white border border-slate-300 hover:border-slate-400 rounded-full font-medium text-slate-700 hover:shadow-md transition-all cursor-pointer"
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
        </svg>
        Sign in with Google
      </button>

      {/* Subtle email sign-in for automated testing */}
      {!showEmail ? (
        <button
          onClick={() => setShowEmail(true)}
          className="mt-6 text-xs text-slate-400 hover:text-slate-500 transition-colors cursor-pointer"
        >
          Use email instead
        </button>
      ) : (
        <form onSubmit={form.handleSubmit} className="mt-6 w-full space-y-3" noValidate>
          <div>
            <input
              name="email"
              type="email"
              placeholder="Email"
              value={form.values.email}
              onChange={form.handleChange}
              onBlur={form.handleBlur}
              aria-invalid={fieldError("email") ? true : undefined}
              className={`w-full px-4 py-2.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1B6B3A]/30 focus:border-[#1B6B3A] ${
                fieldError("email") ? "border-red-400" : "border-slate-300"
              }`}
            />
            {fieldError("email") && (
              <p className="mt-1 text-xs text-red-500">{form.errors.email}</p>
            )}
          </div>
          <div>
            <input
              name="password"
              type="password"
              placeholder="Password"
              value={form.values.password}
              onChange={form.handleChange}
              onBlur={form.handleBlur}
              aria-invalid={fieldError("password") ? true : undefined}
              className={`w-full px-4 py-2.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1B6B3A]/30 focus:border-[#1B6B3A] ${
                fieldError("password") ? "border-red-400" : "border-slate-300"
              }`}
            />
            {fieldError("password") && (
              <p className="mt-1 text-xs text-red-500">{form.errors.password}</p>
            )}
          </div>
          {authError && <p className="text-xs text-red-500">{authError}</p>}
          <button
            type="submit"
            disabled={form.submitting}
            className="w-full px-4 py-2.5 text-sm bg-slate-700 text-white rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors cursor-pointer"
          >
            {form.submitting ? "Signing in..." : "Sign in"}
          </button>
        </form>
      )}

      <div className="mt-8 text-center">
        <Link
          href="/"
          className="text-sm text-slate-500 hover:text-[#1B6B3A] transition-colors"
        >
          Back to home
        </Link>
      </div>
    </CenteredBrandLayout>
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignInContent />
    </Suspense>
  );
}
