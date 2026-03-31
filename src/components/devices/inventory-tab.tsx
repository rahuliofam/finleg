"use client";

const HARDWARE = [
  {
    name: "Alpuca",
    type: "Home Server",
    model: "Mac mini M4",
    specs: "24 GB RAM, Apple M4, macOS Tahoe",
    ip: "192.168.1.200 (LAN) / 100.74.59.97 (Tailscale)",
    user: "paca",
    purpose: "Always-on home server: GLM-OCR, Ollama, rclone, Google Drive sync, RVAULT20",
    status: "active",
  },
  {
    name: "Hostinger VPS",
    type: "Cloud Server",
    model: "VPS KVM 2",
    specs: "Ubuntu, 4 vCPU, 8 GB RAM",
    ip: "93.188.164.224",
    user: "root",
    purpose: "Batch processing: statement parsing, metadata extraction, Claude CLI headless jobs",
    status: "active",
  },
];

const SOFTWARE = [
  {
    name: "GLM-OCR",
    version: "0.1.4",
    model: "glm-ocr:latest (0.9B params, 2.2 GB)",
    host: "Alpuca (Mac mini M4)",
    endpoint: "http://100.74.59.97:5002/ocr",
    launchd: "com.alpuca.glm-ocr",
    purpose: "First-pass OCR for all document processing. #1 on OmniDocBench V1.5 (94.62)",
    license: "Apache 2.0 (code) / MIT (model)",
    repo: "https://github.com/zai-org/GLM-OCR",
    installed: "2026-03-31",
    status: "active",
  },
  {
    name: "Ollama",
    version: "0.19.0",
    host: "Alpuca (Mac mini M4)",
    endpoint: "http://100.74.59.97:11434",
    purpose: "Local LLM inference server. Runs GLM-OCR, Gemma 3 27B, Qwen 3 8B",
    models: ["glm-ocr:latest (2.2 GB)", "gemma3:27b (17 GB)", "qwen3:8b (5.2 GB)"],
    status: "active",
  },
  {
    name: "Claude CLI (Headless)",
    version: "latest",
    host: "Hostinger VPS",
    purpose: "Second-pass enrichment: metadata extraction, document classification, statement parsing",
    models: ["Sonnet 4.6 (default)", "Opus 4.6 (complex docs)"],
    status: "active",
  },
  {
    name: "Gemini 2.5 Flash",
    version: "API",
    host: "Google Cloud (API)",
    purpose: "Backup OCR (~$0.0004/page), email statement classification",
    status: "active",
  },
  {
    name: "pdf-parse",
    version: "1.1.1",
    host: "Local / Hostinger",
    purpose: "Fast text extraction for digital (non-scanned) PDFs",
    status: "active",
  },
  {
    name: "Mammoth",
    version: "1.12.0",
    host: "Local / Hostinger",
    purpose: "DOCX text extraction",
    status: "active",
  },
];

const PIPELINE_STAGES = [
  { stage: "1. Upload", tool: "upload-r2-index.mjs", desc: "Batch upload files to Cloudflare R2, create document_index entries" },
  { stage: "2. Text Extract", tool: "extract-doc-text.mjs", desc: "pdf-parse (digital PDFs) + mammoth (DOCX) for fast text extraction" },
  { stage: "3. OCR (First Pass)", tool: "ocr-glm.mjs", desc: "GLM-OCR on Alpuca for scanned PDFs and images. Replaces Claude/Gemini OCR" },
  { stage: "4. Metadata (Second Pass)", tool: "extract-doc-metadata.mjs", desc: "Sonnet 4.6 via Claude CLI for structured metadata: type, parties, dates, amounts" },
  { stage: "5. Statement Parse", tool: "ingest-statements.mjs", desc: "Extract transactions, balances, fees from financial statements" },
];

function StatusBadge({ status }: { status: string }) {
  const colors = status === "active"
    ? "bg-emerald-100 text-emerald-800"
    : status === "deprecated"
    ? "bg-amber-100 text-amber-800"
    : "bg-slate-100 text-slate-600";
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors}`}>
      {status}
    </span>
  );
}

export function InventoryTab() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 mb-1">Software & Hardware Inventory</h1>
        <p className="text-sm text-slate-500">Infrastructure powering finleg.net document processing pipeline</p>
      </div>

      {/* Document Processing Pipeline */}
      <section>
        <h2 className="text-lg font-semibold text-slate-800 mb-3">Document Processing Pipeline</h2>
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-slate-600">Stage</th>
                <th className="text-left px-4 py-2 font-medium text-slate-600">Script</th>
                <th className="text-left px-4 py-2 font-medium text-slate-600">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {PIPELINE_STAGES.map((s) => (
                <tr key={s.stage} className="hover:bg-slate-50/50">
                  <td className="px-4 py-2.5 font-medium text-slate-800 whitespace-nowrap">{s.stage}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-600">{s.tool}</td>
                  <td className="px-4 py-2.5 text-slate-600">{s.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Software */}
      <section>
        <h2 className="text-lg font-semibold text-slate-800 mb-3">Software Services</h2>
        <div className="grid gap-4">
          {SOFTWARE.map((sw) => (
            <div key={sw.name} className="rounded-xl border border-slate-200 p-4">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <h3 className="font-semibold text-slate-900">{sw.name}</h3>
                  <p className="text-xs text-slate-500">
                    {sw.version} &middot; {sw.host}
                    {"endpoint" in sw && sw.endpoint && (
                      <> &middot; <span className="font-mono">{sw.endpoint}</span></>
                    )}
                  </p>
                </div>
                <StatusBadge status={sw.status} />
              </div>
              <p className="text-sm text-slate-600 mb-2">{sw.purpose}</p>
              {"models" in sw && sw.models && (
                <div className="flex flex-wrap gap-1.5">
                  {sw.models.map((m) => (
                    <span key={m} className="px-2 py-0.5 bg-slate-100 rounded text-xs text-slate-600 font-mono">{m}</span>
                  ))}
                </div>
              )}
              {"repo" in sw && sw.repo && (
                <a href={sw.repo} target="_blank" rel="noopener noreferrer"
                   className="text-xs text-brand-blue hover:underline mt-1 inline-block">
                  {sw.repo}
                </a>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Hardware */}
      <section>
        <h2 className="text-lg font-semibold text-slate-800 mb-3">Hardware</h2>
        <div className="grid gap-4">
          {HARDWARE.map((hw) => (
            <div key={hw.name} className="rounded-xl border border-slate-200 p-4">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <h3 className="font-semibold text-slate-900">{hw.name}</h3>
                  <p className="text-xs text-slate-500">{hw.type} &middot; {hw.model} &middot; {hw.specs}</p>
                </div>
                <StatusBadge status={hw.status} />
              </div>
              <p className="text-sm text-slate-600 mb-1">{hw.purpose}</p>
              <p className="text-xs text-slate-400 font-mono">{hw.user}@{hw.ip}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
