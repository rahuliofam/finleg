"use client";

interface SecretConfig {
  name: string;
  description: string;
  configurable: boolean;
  currentValue: string;
  options?: string;
}

interface VaultFolder {
  folder: string;
  items: number;
  category: string;
}

const SESSION_PARAMS: SecretConfig[] = [
  {
    name: "Session Storage",
    description: "BW_SESSION token cached to file for reuse across terminal tabs.",
    configurable: true,
    currentValue: "~/.bw-session (chmod 600)",
    options: "Change via BW_SESSION_FILE env var",
  },
  {
    name: "Session Duration",
    description: "Session remains valid until you run bw-lock or bw lock. No automatic timeout on the CLI.",
    configurable: false,
    currentValue: "Until manual lock or system restart",
    options: "Bitwarden web vault timeout is separate (configurable in Settings > Security)",
  },
  {
    name: "Re-auth Frequency",
    description: "CLI requires re-auth only after bw lock, machine reboot, or Bitwarden account password change.",
    configurable: false,
    currentValue: "Once per session (manual lock resets)",
  },
  {
    name: "Vault Sync",
    description: "bw sync pulls latest vault data from server. Auto-runs on unlock.",
    configurable: true,
    currentValue: "Manual (on unlock or bw sync)",
    options: "Run bw sync --session $BW_SESSION to force refresh",
  },
  {
    name: "Audit Log Location",
    description: "Every secret access logged with timestamp, action, field name, and caller.",
    configurable: true,
    currentValue: "~/.bw-audit.log",
    options: "Change via BW_AUDIT_LOG env var",
  },
  {
    name: "Vault Item Name",
    description: "The Bitwarden Secure Note that holds all .env.local secrets for Portsie.",
    configurable: true,
    currentValue: "Portsie Dev Env",
    options: "Change via BW_ITEM_NAME env var",
  },
  {
    name: "Master Password",
    description: "Required to unlock vault. Entered once per session via bw-unlock.",
    configurable: false,
    currentValue: "Set in Bitwarden account settings",
  },
  {
    name: "Two-Factor Auth",
    description: "Optional 2FA on Bitwarden account login (not on unlock). Recommended for account security.",
    configurable: true,
    currentValue: "Configurable in Bitwarden web vault > Security > Two-step login",
    options: "Authenticator app, email, YubiKey, or FIDO2",
  },
];

const VAULT_FOLDERS: VaultFolder[] = [
  // Financial & Banking
  { folder: "Bank", items: 6, category: "Financial" },
  { folder: "Banking", items: 5, category: "Financial" },
  { folder: "Brokerage", items: 1, category: "Financial" },
  { folder: "Credit-card", items: 4, category: "Financial" },
  { folder: "Credit-report", items: 4, category: "Financial" },
  { folder: "Finances", items: 1, category: "Financial" },
  { folder: "Financial", items: 1, category: "Financial" },
  { folder: "Investment", items: 3, category: "Financial" },
  { folder: "Loan", items: 5, category: "Financial" },
  { folder: "Payments", items: 8, category: "Financial" },
  { folder: "Payroll", items: 1, category: "Financial" },
  { folder: "Retirement", items: 1, category: "Financial" },
  // Business & Work
  { folder: "Accounting", items: 2, category: "Business" },
  { folder: "Business", items: 1, category: "Business" },
  { folder: "Crm", items: 1, category: "Business" },
  { folder: "EDD", items: 1, category: "Business" },
  { folder: "Esignature", items: 1, category: "Business" },
  { folder: "Franchise", items: 1, category: "Business" },
  { folder: "Freelance", items: 1, category: "Business" },
  { folder: "Legal", items: 1, category: "Business" },
  { folder: "Listing", items: 2, category: "Business" },
  { folder: "Marketing", items: 2, category: "Business" },
  { folder: "Project-management", items: 1, category: "Business" },
  { folder: "Rental", items: 6, category: "Business" },
  // Development & DevOps
  { folder: "Ai", items: 3, category: "Dev" },
  { folder: "Automation", items: 1, category: "Dev" },
  { folder: "Bot", items: 2, category: "Dev" },
  { folder: "Cloudflare", items: 1, category: "Dev" },
  { folder: "Core", items: 2, category: "Dev" },
  { folder: "Development", items: 1, category: "Dev" },
  { folder: "Domains", items: 3, category: "Dev" },
  { folder: "Oauth", items: 1, category: "Dev" },
  { folder: "Openrouter", items: 1, category: "Dev" },
  { folder: "Resend", items: 1, category: "Dev" },
  { folder: "Ssh", items: 1, category: "Dev" },
  { folder: "Starter Kit", items: 3, category: "Dev" },
  { folder: "Storage", items: 1, category: "Dev" },
  { folder: "Telnyx", items: 1, category: "Dev" },
  { folder: "Workers", items: 1, category: "Dev" },
  // Infrastructure & Devices
  { folder: "Device", items: 3, category: "Infra" },
  { folder: "Iot", items: 7, category: "Infra" },
  { folder: "Remote-access", items: 1, category: "Infra" },
  { folder: "Smart-home", items: 2, category: "Infra" },
  // Personal & Identity
  { folder: "Access-code", items: 2, category: "Personal" },
  { folder: "Admin", items: 1, category: "Personal" },
  { folder: "Austin", items: 13, category: "Personal" },
  { folder: "Auto", items: 4, category: "Personal" },
  { folder: "Benefits", items: 1, category: "Personal" },
  { folder: "California", items: 2, category: "Personal" },
  { folder: "Dental", items: 1, category: "Personal" },
  { folder: "Drive", items: 1, category: "Personal" },
  { folder: "Email", items: 2, category: "Personal" },
  { folder: "Government", items: 4, category: "Personal" },
  { folder: "Health", items: 1, category: "Personal" },
  { folder: "Identity", items: 7, category: "Personal" },
  { folder: "Medical", items: 2, category: "Personal" },
  { folder: "Messaging", items: 1, category: "Personal" },
  { folder: "Music", items: 1, category: "Personal" },
  { folder: "Property", items: 2, category: "Personal" },
  { folder: "Shopping", items: 4, category: "Personal" },
  { folder: "Social-media", items: 2, category: "Personal" },
  { folder: "SS", items: 1, category: "Personal" },
  { folder: "Washington", items: 5, category: "Personal" },
  { folder: "Weather", items: 1, category: "Personal" },
  // Inactive / Other
  { folder: "Anova", items: 1, category: "Other" },
  { folder: "Arm", items: 1, category: "Other" },
  { folder: "Deprecated", items: 1, category: "Other" },
  { folder: "Inactive", items: 2, category: "Other" },
  { folder: "Local", items: 1, category: "Other" },
];

const CATEGORY_META: Record<string, { label: string; color: string }> = {
  Financial: { label: "Financial & Banking", color: "bg-emerald-100 text-emerald-700" },
  Business: { label: "Business & Work", color: "bg-blue-100 text-blue-700" },
  Dev: { label: "Development & DevOps", color: "bg-purple-100 text-purple-700" },
  Infra: { label: "Infrastructure & Devices", color: "bg-amber-100 text-amber-700" },
  Personal: { label: "Personal & Identity", color: "bg-slate-200 text-slate-600" },
  Other: { label: "Inactive / Other", color: "bg-red-100 text-red-600" },
};

const COMMANDS = [
  { cmd: "bw-unlock", desc: "Unlock vault (one-time password prompt, session cached)", scope: "All projects" },
  { cmd: "bw-lock", desc: "Lock vault and destroy session", scope: "All projects" },
  { cmd: "bw-status", desc: "Check if vault is unlocked", scope: "All projects" },
  { cmd: "bw-read \"Item\" \"Field\"", desc: "Get a secret (password or custom field)", scope: "All projects" },
  { cmd: "bw-env", desc: "Generate .env.local from vault", scope: "Portsie" },
  { cmd: "bw-get FIELD_NAME", desc: "Get a single env var from Portsie Dev Env", scope: "Portsie" },
  { cmd: "bw-audit [N]", desc: "Show last N audit log entries (default: 20)", scope: "All projects" },
  { cmd: "bw-audit-search Q", desc: "Search audit log for a query string", scope: "All projects" },
  { cmd: "bw-help", desc: "Show all available commands", scope: "All projects" },
  { cmd: "portsie-env", desc: "Shortcut: bw-unlock + bw-env in one step", scope: "Portsie" },
];

function SectionCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="mb-8 border border-slate-200 rounded-lg overflow-hidden">
      <div className="bg-slate-800 px-5 py-3 flex items-center justify-between">
        <h2 className="text-base font-bold text-white">{title}</h2>
        {subtitle && <span className="text-xs text-slate-400">{subtitle}</span>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

export default function SecurityPage() {
  return (
    <div className="max-w-4xl mx-auto">
      {/* Migration Banner */}
      <div className="mb-6 p-4 bg-emerald-50 rounded-lg border border-emerald-200">
        <div className="flex items-center gap-2 mb-1">
          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-200 text-emerald-800">Active</span>
          <span className="font-semibold text-sm text-emerald-900">Bitwarden Password Manager</span>
        </div>
        <p className="text-xs text-emerald-700">
          270 items across 69 folders (231 logins, 7 identities, 31 secure notes).
          CLI-based with session caching &mdash; no repeated unlock prompts.
        </p>
      </div>

      {/* How It Works */}
      <SectionCard title="How Bitwarden Works" subtitle="Architecture overview">
        <div className="space-y-4">
          <div className="p-4 bg-slate-50 rounded-lg">
            <pre className="text-xs text-slate-700 font-mono whitespace-pre overflow-x-auto">{`~/.zshrc
  └─ source ~/Documents/CodingProjects/portsie/scripts/bw-profile.sh
       └─ source scripts/bw-secrets.sh   (loads bw-* functions)
       └─ restores BW_SESSION from ~/.bw-session (if still valid)

bw-unlock  →  master password (once)  →  BW_SESSION token  →  ~/.bw-session
bw-read    →  reads ~/.bw-session     →  bw get item/password  →  logs to ~/.bw-audit.log
bw-env     →  reads "Portsie Dev Env" →  writes .env.local     →  logs each var`}</pre>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 bg-blue-50 rounded-lg text-center">
              <div className="text-lg font-bold text-blue-900">270</div>
              <div className="text-[10px] text-blue-600">Items in Vault</div>
            </div>
            <div className="p-3 bg-blue-50 rounded-lg text-center">
              <div className="text-lg font-bold text-blue-900">69</div>
              <div className="text-[10px] text-blue-600">Folders</div>
            </div>
            <div className="p-3 bg-blue-50 rounded-lg text-center">
              <div className="text-lg font-bold text-blue-900">3</div>
              <div className="text-[10px] text-blue-600">Projects Using It</div>
            </div>
          </div>
        </div>
      </SectionCard>

      {/* Configuration Parameters */}
      <SectionCard title="Configuration" subtitle="Parameters & tunables">
        <div className="space-y-3">
          {SESSION_PARAMS.map((param) => (
            <div key={param.name} className="p-3 bg-slate-50 rounded-lg">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-semibold text-sm text-slate-900">{param.name}</span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                  param.configurable
                    ? "bg-amber-100 text-amber-700"
                    : "bg-slate-200 text-slate-500"
                }`}>
                  {param.configurable ? "Configurable" : "Fixed"}
                </span>
              </div>
              <p className="text-xs text-slate-600 mb-1">{param.description}</p>
              <div className="flex items-center gap-2 text-[11px]">
                <span className="text-slate-400">Current:</span>
                <code className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-700">{param.currentValue}</code>
              </div>
              {param.options && (
                <div className="flex items-center gap-2 text-[11px] mt-1">
                  <span className="text-slate-400">Change:</span>
                  <span className="text-slate-500">{param.options}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </SectionCard>

      {/* CLI Commands */}
      <SectionCard title="CLI Commands" subtitle="All available bw-* functions">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left py-2 pr-4 text-slate-500 font-medium">Command</th>
                <th className="text-left py-2 pr-4 text-slate-500 font-medium">Description</th>
                <th className="text-left py-2 text-slate-500 font-medium">Scope</th>
              </tr>
            </thead>
            <tbody>
              {COMMANDS.map((c) => (
                <tr key={c.cmd} className="border-b border-slate-100">
                  <td className="py-2 pr-4">
                    <code className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-800 font-mono text-[11px]">{c.cmd}</code>
                  </td>
                  <td className="py-2 pr-4 text-slate-600">{c.desc}</td>
                  <td className="py-2">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                      c.scope === "All projects"
                        ? "bg-blue-100 text-blue-700"
                        : "bg-purple-100 text-purple-700"
                    }`}>
                      {c.scope}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* Vault Structure */}
      <SectionCard title="Vault Structure" subtitle={`${VAULT_FOLDERS.length} folders \u00b7 270 items (+ 110 unfiled)`}>
        <div className="space-y-6">
          {Object.entries(CATEGORY_META).map(([cat, meta]) => {
            const folders = VAULT_FOLDERS.filter((f) => f.category === cat);
            if (folders.length === 0) return null;
            const totalItems = folders.reduce((sum, f) => sum + f.items, 0);
            return (
              <div key={cat}>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${meta.color}`}>
                    {meta.label}
                  </span>
                  <span className="text-[10px] text-slate-400">
                    {folders.length} folders &middot; {totalItems} items
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {folders.map((f) => (
                    <span
                      key={f.folder}
                      className="inline-flex items-center gap-1 px-2 py-1 bg-slate-50 rounded text-xs text-slate-700 border border-slate-100"
                    >
                      {f.folder}
                      <span className="text-[10px] text-slate-400">({f.items})</span>
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </SectionCard>

      {/* Key Files */}
      <SectionCard title="Key Files" subtitle="Source code & config">
        <div className="space-y-2">
          {[
            { file: "~/Documents/CodingProjects/portsie/scripts/bw-secrets.sh", desc: "Core wrapper: session mgmt, bw-read, bw-get, bw-env, audit logging" },
            { file: "~/Documents/CodingProjects/portsie/scripts/bw-import-env.sh", desc: "One-time import of .env.local into Bitwarden Secure Note" },
            { file: "~/Documents/CodingProjects/portsie/scripts/bw-profile.sh", desc: "Shell profile integration (sourced from ~/.zshrc)" },
            { file: "~/.bw-session", desc: "Cached BW_SESSION token (chmod 600)" },
            { file: "~/.bw-audit.log", desc: "Audit trail of all secret accesses" },
          ].map((f) => (
            <div key={f.file} className="flex items-start gap-3 p-2 bg-slate-50 rounded">
              <code className="text-[11px] text-slate-700 font-mono bg-slate-100 px-1.5 py-0.5 rounded shrink-0">{f.file}</code>
              <span className="text-xs text-slate-500">{f.desc}</span>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Setup Guide */}
      <SectionCard title="First-Time Setup" subtitle="New machine or new developer">
        <div className="space-y-3">
          {[
            { step: "1", label: "Install CLI", cmd: "brew install bitwarden-cli" },
            { step: "2", label: "Login", cmd: "bw login" },
            { step: "3", label: "Add to shell", cmd: "echo 'source ~/Documents/CodingProjects/portsie/scripts/bw-profile.sh' >> ~/.zshrc" },
            { step: "4", label: "Unlock vault", cmd: "source ~/.zshrc && bw-unlock" },
            { step: "5", label: "Generate .env.local", cmd: "bw-env" },
          ].map((s) => (
            <div key={s.step} className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg">
              <span className="w-6 h-6 rounded-full bg-slate-800 text-white text-xs font-bold flex items-center justify-center shrink-0">
                {s.step}
              </span>
              <div>
                <div className="font-semibold text-sm text-slate-900">{s.label}</div>
                <code className="text-[11px] text-slate-600 font-mono">{s.cmd}</code>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Vault Details */}
      <SectionCard title="Vault Details" subtitle="Bitwarden inventory">
        <div className="p-3 bg-slate-50 rounded-lg">
          <div className="space-y-2 text-xs text-slate-600">
            <div className="flex justify-between">
              <span>Total items</span>
              <span className="text-slate-900 font-medium">270 (231 logins, 7 identities, 31 secure notes)</span>
            </div>
            <div className="flex justify-between">
              <span>Folders</span>
              <span className="text-slate-900 font-medium">69</span>
            </div>
            <div className="flex justify-between">
              <span>Plan</span>
              <span className="text-slate-900 font-medium">Premium ($10/yr, upgradeable to Family $40/yr)</span>
            </div>
            <div className="flex justify-between">
              <span>CLI integration</span>
              <span className="text-slate-900 font-medium">Session caching via bw-read</span>
            </div>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
