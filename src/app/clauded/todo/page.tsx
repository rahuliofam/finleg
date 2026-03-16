export default function TodoPage() {
  return (
    <div className="min-h-screen bg-slate-50 py-10 px-5">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-red-600 border-b-2 border-red-600 pb-2">
          GitGuardian Secret Exposure — Remediation Checklist
        </h1>

        <div className="bg-red-50 border border-red-300 rounded-lg p-4 my-4">
          <strong className="text-red-600">
            URGENT — Secrets are in git history forever. Removing from code is
            not enough. You must rotate.
          </strong>
        </div>

        <h2 className="text-lg font-semibold text-slate-700 mt-7">
          1. Rotate Supabase Service Role Key
        </h2>
        <ol className="list-decimal pl-5 space-y-3 mt-2 text-slate-800 leading-relaxed">
          <li>
            Go to{" "}
            <a
              href="https://supabase.com/dashboard/project/gjdvzzxsrzuorguwkaih/settings/api"
              target="_blank"
              className="text-blue-600 underline"
            >
              Supabase Dashboard → Settings → API
            </a>
          </li>
          <li>
            Under <strong>service_role key</strong>, click{" "}
            <strong>Regenerate</strong>
          </li>
          <li>Copy the new key</li>
          <li>
            Update your local <code className="bg-slate-200 px-1.5 py-0.5 rounded text-sm">.env</code> file:{" "}
            <code className="bg-slate-200 px-1.5 py-0.5 rounded text-sm">
              SUPABASE_SERVICE_ROLE_KEY=new-key-here
            </code>
          </li>
          <li>Update the key on Hostinger VPS (for batch jobs)</li>
        </ol>

        <h2 className="text-lg font-semibold text-slate-700 mt-7">
          2. Rotate Cloudflare R2 API Token
        </h2>
        <ol className="list-decimal pl-5 space-y-3 mt-2 text-slate-800 leading-relaxed">
          <li>
            Go to{" "}
            <a
              href="https://dash.cloudflare.com/?to=/:account/r2/api-tokens"
              target="_blank"
              className="text-blue-600 underline"
            >
              Cloudflare Dashboard → R2 → Manage R2 API Tokens
            </a>
          </li>
          <li>
            <strong>Revoke</strong> the existing token
          </li>
          <li>Create a new token with the same permissions</li>
          <li>
            Update <code className="bg-slate-200 px-1.5 py-0.5 rounded text-sm">wrangler</code> auth: run{" "}
            <code className="bg-slate-200 px-1.5 py-0.5 rounded text-sm">wrangler login</code> or update{" "}
            <code className="bg-slate-200 px-1.5 py-0.5 rounded text-sm">~/.wrangler/config/default.toml</code>
          </li>
        </ol>

        <h2 className="text-lg font-semibold text-slate-700 mt-7">
          3. Create your <code className="bg-slate-200 px-1.5 py-0.5 rounded text-sm">.env</code> file
        </h2>
        <ol className="list-decimal pl-5 space-y-3 mt-2 text-slate-800 leading-relaxed">
          <li>
            Copy the template:{" "}
            <code className="bg-slate-200 px-1.5 py-0.5 rounded text-sm">cp .env.example .env</code>
          </li>
          <li>
            Paste the <strong>new</strong> rotated keys (from steps 1 &amp; 2
            above)
          </li>
          <li>
            Verify scripts work:{" "}
            <code className="bg-slate-200 px-1.5 py-0.5 rounded text-sm">
              node scripts/verify-index.mjs
            </code>
          </li>
        </ol>

        <div className="bg-green-50 border border-green-300 rounded-lg p-4 my-6">
          <strong className="text-green-600">Already done by Claude:</strong>
          <ul className="list-disc pl-5 mt-2 space-y-1 text-slate-700">
            <li>
              All 5 scripts updated to use{" "}
              <code className="bg-slate-200 px-1.5 py-0.5 rounded text-sm">process.env</code> +{" "}
              <code className="bg-slate-200 px-1.5 py-0.5 rounded text-sm">dotenv</code> (no more hardcoded
              keys)
            </li>
            <li>
              <code className="bg-slate-200 px-1.5 py-0.5 rounded text-sm">.env.example</code> created with
              placeholder keys
            </li>
            <li>
              <code className="bg-slate-200 px-1.5 py-0.5 rounded text-sm">.env</code> already in{" "}
              <code className="bg-slate-200 px-1.5 py-0.5 rounded text-sm">.gitignore</code>
            </li>
            <li>
              Gitleaks pre-commit hook installed (
              <code className="bg-slate-200 px-1.5 py-0.5 rounded text-sm">.githooks/pre-commit</code>)
            </li>
            <li>
              <code className="bg-slate-200 px-1.5 py-0.5 rounded text-sm">npm prepare</code> script
              auto-configures hooks for new clones
            </li>
          </ul>
        </div>

        <p className="text-slate-400 text-sm mt-8">
          Generated: 2026-03-15 — GitGuardian incident response
        </p>
      </div>
    </div>
  );
}
