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

        <h2 className="text-lg font-semibold text-slate-700 mt-7">
          Security Posture Review (2026-03-16)
        </h2>
        <p className="text-slate-600 mt-2 leading-relaxed">
          A full security audit identified 6 additional items beyond the GitGuardian remediation.
        </p>

        <div className="mt-4 space-y-4">
          <div className="border border-red-200 bg-red-50 rounded-lg p-4">
            <div className="flex items-center gap-2">
              <span className="bg-red-600 text-white text-xs font-bold px-2 py-0.5 rounded">HIGH</span>
              <strong className="text-slate-800">Cloudflare Worker placeholder auth token</strong>
            </div>
            <p className="text-slate-600 text-sm mt-1">
              <code className="bg-slate-200 px-1.5 py-0.5 rounded text-sm">cloudflare/claude-sessions/src/index.js</code> — hardcoded{" "}
              <code className="bg-slate-200 px-1.5 py-0.5 rounded text-sm">CHANGE_ME_TO_A_SECRET</code>.
              Use <code className="bg-slate-200 px-1.5 py-0.5 rounded text-sm">env.AUTH_TOKEN</code> (Cloudflare secret) instead.
              Set via <code className="bg-slate-200 px-1.5 py-0.5 rounded text-sm">wrangler secret put AUTH_TOKEN</code>.
            </p>
          </div>

          <div className="border border-amber-200 bg-amber-50 rounded-lg p-4">
            <div className="flex items-center gap-2">
              <span className="bg-amber-500 text-white text-xs font-bold px-2 py-0.5 rounded">MEDIUM</span>
              <strong className="text-slate-800">CORS wide open on Cloudflare Worker</strong>
            </div>
            <p className="text-slate-600 text-sm mt-1">
              <code className="bg-slate-200 px-1.5 py-0.5 rounded text-sm">Access-Control-Allow-Origin: &apos;*&apos;</code> lets any site call the API.
              Restrict to your actual domain(s).
            </p>
          </div>

          <div className="border border-amber-200 bg-amber-50 rounded-lg p-4">
            <div className="flex items-center gap-2">
              <span className="bg-amber-500 text-white text-xs font-bold px-2 py-0.5 rounded">MEDIUM</span>
              <strong className="text-slate-800">Gitleaks hook silently skips if not installed</strong>
            </div>
            <p className="text-slate-600 text-sm mt-1">
              <code className="bg-slate-200 px-1.5 py-0.5 rounded text-sm">.githooks/pre-commit</code> exits 0 when gitleaks is missing — commits proceed unscanned.
              Should exit 1 (fail-closed).
            </p>
          </div>

          <div className="border border-slate-200 bg-slate-50 rounded-lg p-4">
            <div className="flex items-center gap-2">
              <span className="bg-slate-400 text-white text-xs font-bold px-2 py-0.5 rounded">LOW</span>
              <strong className="text-slate-800">todo.html exposes remediation details publicly</strong>
            </div>
            <p className="text-slate-600 text-sm mt-1">
              Static <code className="bg-slate-200 px-1.5 py-0.5 rounded text-sm">todo.html</code> is served on GitHub Pages with Supabase project ref and key rotation details.
              Delete or gitignore once remediation is complete.
            </p>
          </div>

          <div className="border border-slate-200 bg-slate-50 rounded-lg p-4">
            <div className="flex items-center gap-2">
              <span className="bg-slate-400 text-white text-xs font-bold px-2 py-0.5 rounded">LOW</span>
              <strong className="text-slate-800">No client-side password complexity enforcement</strong>
            </div>
            <p className="text-slate-600 text-sm mt-1">
              <code className="bg-slate-200 px-1.5 py-0.5 rounded text-sm">shared/auth.js</code> — passwords go straight to Supabase (6-char minimum).
              Add client-side validation requiring 12+ characters.
            </p>
          </div>

          <div className="border border-slate-200 bg-slate-50 rounded-lg p-4">
            <div className="flex items-center gap-2">
              <span className="bg-slate-400 text-white text-xs font-bold px-2 py-0.5 rounded">LOW</span>
              <strong className="text-slate-800">Auth cache persists 7 days in localStorage</strong>
            </div>
            <p className="text-slate-600 text-sm mt-1">
              Cached auth state (role, identity) in <code className="bg-slate-200 px-1.5 py-0.5 rounded text-sm">shared/auth.js</code> lasts
              a week. Physical device access reveals cached identity. Intentional UX tradeoff — be aware on shared devices.
            </p>
          </div>
        </div>

        <p className="text-slate-400 text-sm mt-8">
          Generated: 2026-03-15 — GitGuardian incident response | Updated: 2026-03-16 — security posture review
        </p>
      </div>
    </div>
  );
}
