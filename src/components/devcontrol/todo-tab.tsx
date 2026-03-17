"use client";

export function TodoTab() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 mb-1">Security Remediation</h1>
        <p className="text-sm text-slate-500">GitGuardian secret exposure — remediation checklist</p>
      </div>

      <div className="border border-red-200 bg-red-50 rounded-xl p-4">
        <p className="text-sm font-semibold text-red-700">
          Secrets are in git history forever. Removing from code is not enough — you must rotate.
        </p>
      </div>

      {/* Step 1 */}
      <div className="border border-slate-200 rounded-xl p-5 bg-white">
        <h2 className="text-base font-semibold text-slate-800 mb-3">1. Rotate Supabase Service Role Key</h2>
        <ol className="list-decimal pl-5 space-y-2 text-sm text-slate-700 leading-relaxed">
          <li>Go to <a href="https://supabase.com/dashboard/project/gjdvzzxsrzuorguwkaih/settings/api" target="_blank" className="text-blue-600 hover:underline">Supabase Dashboard → Settings → API</a></li>
          <li>Under <strong>service_role key</strong>, click <strong>Regenerate</strong></li>
          <li>Copy the new key</li>
          <li>Update your local <code className="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded text-xs">.env</code> file: <code className="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded text-xs">SUPABASE_SERVICE_ROLE_KEY=new-key-here</code></li>
          <li>Update the key on Hostinger VPS (for batch jobs)</li>
        </ol>
      </div>

      {/* Step 2 */}
      <div className="border border-slate-200 rounded-xl p-5 bg-white">
        <h2 className="text-base font-semibold text-slate-800 mb-3">2. Rotate Cloudflare R2 API Token</h2>
        <ol className="list-decimal pl-5 space-y-2 text-sm text-slate-700 leading-relaxed">
          <li>Go to <a href="https://dash.cloudflare.com/?to=/:account/r2/api-tokens" target="_blank" className="text-blue-600 hover:underline">Cloudflare Dashboard → R2 → Manage R2 API Tokens</a></li>
          <li><strong>Revoke</strong> the existing token</li>
          <li>Create a new token with the same permissions</li>
          <li>Update <code className="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded text-xs">wrangler</code> auth: run <code className="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded text-xs">wrangler login</code> or update <code className="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded text-xs">~/.wrangler/config/default.toml</code></li>
        </ol>
      </div>

      {/* Step 3 */}
      <div className="border border-slate-200 rounded-xl p-5 bg-white">
        <h2 className="text-base font-semibold text-slate-800 mb-3">3. Create your <code className="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded text-xs">.env</code> file</h2>
        <ol className="list-decimal pl-5 space-y-2 text-sm text-slate-700 leading-relaxed">
          <li>Copy the template: <code className="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded text-xs">cp .env.example .env</code></li>
          <li>Paste the <strong>new</strong> rotated keys (from steps 1 &amp; 2 above)</li>
          <li>Verify scripts work: <code className="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded text-xs">node scripts/verify-index.mjs</code></li>
        </ol>
      </div>

      {/* Already done */}
      <div className="border border-green-200 bg-green-50 rounded-xl p-5">
        <p className="text-sm font-semibold text-green-800 mb-2">Already done by Claude:</p>
        <ul className="list-disc pl-5 space-y-1 text-sm text-slate-700">
          <li>All 5 scripts updated to use <code className="bg-white text-slate-800 px-1.5 py-0.5 rounded text-xs">process.env</code> + <code className="bg-white text-slate-800 px-1.5 py-0.5 rounded text-xs">dotenv</code> (no more hardcoded keys)</li>
          <li><code className="bg-white text-slate-800 px-1.5 py-0.5 rounded text-xs">.env.example</code> created with placeholder keys</li>
          <li><code className="bg-white text-slate-800 px-1.5 py-0.5 rounded text-xs">.env</code> already in <code className="bg-white text-slate-800 px-1.5 py-0.5 rounded text-xs">.gitignore</code></li>
          <li>Gitleaks pre-commit hook installed (<code className="bg-white text-slate-800 px-1.5 py-0.5 rounded text-xs">.githooks/pre-commit</code>)</li>
          <li><code className="bg-white text-slate-800 px-1.5 py-0.5 rounded text-xs">npm prepare</code> script auto-configures hooks for new clones</li>
        </ul>
      </div>

      <p className="text-xs text-slate-400">Generated: 2026-03-15 — GitGuardian incident response</p>
    </div>
  );
}
