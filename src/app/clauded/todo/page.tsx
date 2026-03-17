import Link from "next/link";

export default function TodoPage() {
  return (
    <div className="min-h-screen py-10 px-5">
      <div className="max-w-3xl mx-auto">
        <div className="mb-6">
          <Link
            href="/clauded"
            className="text-base text-zinc-400 hover:text-white transition-colors"
          >
            ← Clauded
          </Link>
        </div>

        <h1 className="text-3xl font-bold text-red-400 border-b-2 border-red-500 pb-3">
          GitGuardian Secret Exposure — Remediation Checklist
        </h1>

        <div className="bg-red-900/40 border border-red-700 rounded-lg p-5 my-6">
          <strong className="text-red-300 text-lg">
            URGENT — Secrets are in git history forever. Removing from code is
            not enough. You must rotate.
          </strong>
        </div>

        <h2 className="text-xl font-semibold text-white mt-8">
          1. Rotate Supabase Service Role Key
        </h2>
        <ol className="list-decimal pl-5 space-y-3 mt-3 text-zinc-200 text-base leading-relaxed">
          <li>
            Go to{" "}
            <a
              href="https://supabase.com/dashboard/project/gjdvzzxsrzuorguwkaih/settings/api"
              target="_blank"
              className="text-blue-400 underline hover:text-blue-300"
            >
              Supabase Dashboard → Settings → API
            </a>
          </li>
          <li>
            Under <strong className="text-white">service_role key</strong>, click{" "}
            <strong className="text-white">Regenerate</strong>
          </li>
          <li>Copy the new key</li>
          <li>
            Update your local <code className="bg-zinc-800 text-zinc-200 px-2 py-0.5 rounded text-sm">.env</code> file:{" "}
            <code className="bg-zinc-800 text-zinc-200 px-2 py-0.5 rounded text-sm">
              SUPABASE_SERVICE_ROLE_KEY=new-key-here
            </code>
          </li>
          <li>Update the key on Hostinger VPS (for batch jobs)</li>
        </ol>

        <h2 className="text-xl font-semibold text-white mt-8">
          2. Rotate Cloudflare R2 API Token
        </h2>
        <ol className="list-decimal pl-5 space-y-3 mt-3 text-zinc-200 text-base leading-relaxed">
          <li>
            Go to{" "}
            <a
              href="https://dash.cloudflare.com/?to=/:account/r2/api-tokens"
              target="_blank"
              className="text-blue-400 underline hover:text-blue-300"
            >
              Cloudflare Dashboard → R2 → Manage R2 API Tokens
            </a>
          </li>
          <li>
            <strong className="text-white">Revoke</strong> the existing token
          </li>
          <li>Create a new token with the same permissions</li>
          <li>
            Update <code className="bg-zinc-800 text-zinc-200 px-2 py-0.5 rounded text-sm">wrangler</code> auth: run{" "}
            <code className="bg-zinc-800 text-zinc-200 px-2 py-0.5 rounded text-sm">wrangler login</code> or update{" "}
            <code className="bg-zinc-800 text-zinc-200 px-2 py-0.5 rounded text-sm">~/.wrangler/config/default.toml</code>
          </li>
        </ol>

        <h2 className="text-xl font-semibold text-white mt-8">
          3. Create your <code className="bg-zinc-800 text-zinc-200 px-2 py-0.5 rounded text-sm">.env</code> file
        </h2>
        <ol className="list-decimal pl-5 space-y-3 mt-3 text-zinc-200 text-base leading-relaxed">
          <li>
            Copy the template:{" "}
            <code className="bg-zinc-800 text-zinc-200 px-2 py-0.5 rounded text-sm">cp .env.example .env</code>
          </li>
          <li>
            Paste the <strong className="text-white">new</strong> rotated keys (from steps 1 &amp; 2
            above)
          </li>
          <li>
            Verify scripts work:{" "}
            <code className="bg-zinc-800 text-zinc-200 px-2 py-0.5 rounded text-sm">
              node scripts/verify-index.mjs
            </code>
          </li>
        </ol>

        <div className="bg-green-900/40 border border-green-700 rounded-lg p-5 my-8">
          <strong className="text-green-300 text-lg">Already done by Claude:</strong>
          <ul className="list-disc pl-5 mt-3 space-y-2 text-zinc-200 text-base">
            <li>
              All 5 scripts updated to use{" "}
              <code className="bg-zinc-800 text-zinc-200 px-2 py-0.5 rounded text-sm">process.env</code> +{" "}
              <code className="bg-zinc-800 text-zinc-200 px-2 py-0.5 rounded text-sm">dotenv</code> (no more hardcoded
              keys)
            </li>
            <li>
              <code className="bg-zinc-800 text-zinc-200 px-2 py-0.5 rounded text-sm">.env.example</code> created with
              placeholder keys
            </li>
            <li>
              <code className="bg-zinc-800 text-zinc-200 px-2 py-0.5 rounded text-sm">.env</code> already in{" "}
              <code className="bg-zinc-800 text-zinc-200 px-2 py-0.5 rounded text-sm">.gitignore</code>
            </li>
            <li>
              Gitleaks pre-commit hook installed (
              <code className="bg-zinc-800 text-zinc-200 px-2 py-0.5 rounded text-sm">.githooks/pre-commit</code>)
            </li>
            <li>
              <code className="bg-zinc-800 text-zinc-200 px-2 py-0.5 rounded text-sm">npm prepare</code> script
              auto-configures hooks for new clones
            </li>
          </ul>
        </div>

        <p className="text-zinc-500 text-base mt-8">
          Generated: 2026-03-15 — GitGuardian incident response
        </p>
      </div>
    </div>
  );
}
