"use client";

interface SecretConfig {
  name: string;
  description: string;
  configurable: boolean;
  currentValue: string;
  options?: string;
}

interface VaultItem {
  folder: string;
  items: string[];
  project: string;
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

const VAULT_STRUCTURE: VaultItem[] = [
  {
    folder: "DevOps-portsie",
    items: ["Portsie Dev Env (21 env vars as custom fields)"],
    project: "Portsie",
  },
  {
    folder: "DevOps-alpacapps",
    items: [
      "Hostinger VPS \u2014 OpenClaw Server",
      "Alpaca Mac \u2014 Local Machine",
      "Supabase \u2014 AlpacApps Project",
    ],
    project: "AlpacApps",
  },
  {
    folder: "DevOps-finleg",
    items: ["Cloudflare R2 \u2014 Finleg Object Storage"],
    project: "Finleg",
  },
  {
    folder: "DevOps-shared",
    items: ["Cloudflare R2 \u2014 Object Storage (wingsiebird)"],
    project: "Shared",
  },
  {
    folder: "Family Tax",
    items: ["QuickBooks Dev - ClaudeCoded"],
    project: "Finleg",
  },
  {
    folder: "Rahul General",
    items: ["141 personal logins"],
    project: "Personal",
  },
  {
    folder: "Rahul Financial",
    items: ["18 financial institution logins"],
    project: "Personal",
  },
  {
    folder: "Kathy Financial",
    items: ["5 financial logins"],
    project: "Personal",
  },
];

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
          Migrated from 1Password on 2026-03-17. All 269 items imported (231 logins, 7 identities, 31 secure notes, 69 folders).
          CLI-based with session caching &mdash; no repeated Touch ID prompts.
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
              <div className="text-lg font-bold text-blue-900">269</div>
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
      <SectionCard title="Vault Structure" subtitle="Folders & items by project">
        <div className="space-y-3">
          {VAULT_STRUCTURE.map((v) => (
            <div key={v.folder} className="p-3 bg-slate-50 rounded-lg">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-semibold text-sm text-slate-900">{v.folder}</span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                  v.project === "Portsie" ? "bg-purple-100 text-purple-700" :
                  v.project === "AlpacApps" ? "bg-blue-100 text-blue-700" :
                  v.project === "Finleg" ? "bg-amber-100 text-amber-700" :
                  v.project === "Shared" ? "bg-green-100 text-green-700" :
                  "bg-slate-200 text-slate-500"
                }`}>
                  {v.project}
                </span>
              </div>
              <ul className="space-y-0.5">
                {v.items.map((item) => (
                  <li key={item} className="text-xs text-slate-600 flex items-center gap-1.5">
                    <span className="text-slate-300">&bull;</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
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

      {/* Migration History */}
      <SectionCard title="Migration History" subtitle="1Password to Bitwarden">
        <div className="p-3 bg-slate-50 rounded-lg">
          <div className="space-y-2 text-xs text-slate-600">
            <div className="flex justify-between">
              <span>Migration date</span>
              <span className="text-slate-900 font-medium">2026-03-17</span>
            </div>
            <div className="flex justify-between">
              <span>Items migrated</span>
              <span className="text-slate-900 font-medium">269 (231 logins, 7 identities, 31 secure notes)</span>
            </div>
            <div className="flex justify-between">
              <span>Folders created</span>
              <span className="text-slate-900 font-medium">69</span>
            </div>
            <div className="flex justify-between">
              <span>Export format</span>
              <span className="text-slate-900 font-medium">1Password .1pux</span>
            </div>
            <div className="flex justify-between">
              <span>1Password subscription</span>
              <span className="text-amber-600 font-medium">Expiring (let lapse)</span>
            </div>
            <div className="flex justify-between">
              <span>Bitwarden plan</span>
              <span className="text-slate-900 font-medium">Premium ($10/yr, upgradeable to Family $40/yr)</span>
            </div>
            <div className="flex justify-between">
              <span>Why migrated</span>
              <span className="text-slate-900 font-medium">1Password CLI required Touch ID on every op read call</span>
            </div>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
