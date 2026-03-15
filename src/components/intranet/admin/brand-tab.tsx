"use client";

import { useState } from "react";

const BRAND_COLORS = [
  { name: "Brand Green", var: "--brand-green", hex: "#1B6B3A", usage: "Primary brand color, buttons, links" },
  { name: "Brand Green Dark", var: "--brand-green-dark", hex: "#145530", usage: "Hover states, emphasis" },
  { name: "Brand Green Light", var: "--brand-green-light", hex: "#e8f5ec", usage: "Backgrounds, highlights" },
  { name: "Brand Blue", var: "--brand-blue", hex: "#2196c8", usage: "Accent, secondary actions" },
];

const NAV_COLORS = [
  { name: "Nav Background", hex: "#1e293b", usage: "Intranet header (slate-800)" },
  { name: "Active Tab", hex: "#d97706", usage: "Active tab underline (amber-600)" },
  { name: "Tab Hover", hex: "#f59e0b", usage: "Tab hover state (amber-500)" },
];

const LOGO_ASSETS = [
  { name: "Logo (Transparent)", src: "/finleg-logo-transparent.png", bg: "bg-slate-100" },
  { name: "Logo (Original)", src: "/finleg-logo.png", bg: "bg-white" },
  { name: "Wordmark (Transparent)", src: "/finleg-wordmark-transparent.png", bg: "bg-slate-100" },
  { name: "Wordmark (White)", src: "/finleg-wordmark-white.png", bg: "bg-slate-800" },
  { name: "Wordmark (Original)", src: "/finleg-wordmark.png", bg: "bg-white" },
];

const FONT_FAMILIES = [
  { name: "Geist Sans", var: "--font-sans", sample: "The quick brown fox jumps over the lazy dog", usage: "Body text, UI elements" },
  { name: "Geist Mono", var: "--font-mono", sample: "v260314.13 9:46p", usage: "Version numbers, code, data" },
  { name: "Playfair Display", var: "--font-display", sample: "Finleg Intranet", usage: "Display headings, hero text" },
];

function ColorSwatch({ name, hex, usage }: { name: string; hex: string; usage: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(hex);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-4 p-3 rounded-lg border border-slate-200 hover:border-slate-300 transition-colors w-full text-left cursor-pointer"
    >
      <div
        className="w-12 h-12 rounded-lg shrink-0 border border-slate-200"
        style={{ backgroundColor: hex }}
      />
      <div className="min-w-0">
        <div className="text-sm font-medium text-slate-900">{name}</div>
        <div className="text-xs font-mono text-slate-500">
          {copied ? "Copied!" : hex}
        </div>
        <div className="text-xs text-slate-400 mt-0.5">{usage}</div>
      </div>
    </button>
  );
}

export function BrandTab() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Brand</h1>
        <p className="text-sm text-slate-500 mt-1">
          Brand assets, colors, and typography for Finleg.
        </p>
      </div>

      {/* Logos */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Logos & Wordmarks</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {LOGO_ASSETS.map((asset) => (
            <div
              key={asset.name}
              className="rounded-xl border border-slate-200 overflow-hidden"
            >
              <div className={`${asset.bg} p-6 flex items-center justify-center min-h-[120px]`}>
                <img
                  src={asset.src}
                  alt={asset.name}
                  className="max-h-24 w-auto object-contain"
                />
              </div>
              <div className="px-4 py-3 border-t border-slate-200">
                <div className="text-sm font-medium text-slate-900">{asset.name}</div>
                <div className="text-xs text-slate-500 font-mono">{asset.src}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Brand Colors */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Brand Colors</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {BRAND_COLORS.map((color) => (
            <ColorSwatch key={color.var} {...color} />
          ))}
        </div>
      </section>

      {/* UI Colors */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Navigation Colors</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {NAV_COLORS.map((color) => (
            <ColorSwatch key={color.hex + color.name} name={color.name} hex={color.hex} usage={color.usage} />
          ))}
        </div>
      </section>

      {/* Typography */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Typography</h2>
        <div className="space-y-4">
          {FONT_FAMILIES.map((font) => (
            <div
              key={font.var}
              className="rounded-xl border border-slate-200 p-5"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-medium text-slate-900">{font.name}</div>
                <div className="text-xs text-slate-400">{font.usage}</div>
              </div>
              <div
                className="text-2xl text-slate-700 mb-1"
                style={{
                  fontFamily: font.var === "--font-mono"
                    ? "var(--font-geist-mono), monospace"
                    : font.var === "--font-display"
                    ? "var(--font-playfair), serif"
                    : "var(--font-geist), sans-serif",
                }}
              >
                {font.sample}
              </div>
              <div className="text-xs text-slate-500 font-mono">
                var({font.var})
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Usage Guidelines */}
      <section>
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Usage Guidelines</h2>
        <div className="rounded-xl border border-slate-200 p-5 space-y-3 text-sm text-slate-700">
          <div className="flex gap-2">
            <span className="text-slate-400 shrink-0">1.</span>
            <span>Use <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">brand-green</code> for primary actions and links.</span>
          </div>
          <div className="flex gap-2">
            <span className="text-slate-400 shrink-0">2.</span>
            <span>Use <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">brand-green-dark</code> for hover states on green elements.</span>
          </div>
          <div className="flex gap-2">
            <span className="text-slate-400 shrink-0">3.</span>
            <span>Logo should always have adequate spacing and contrast against its background.</span>
          </div>
          <div className="flex gap-2">
            <span className="text-slate-400 shrink-0">4.</span>
            <span>Use the transparent logo on colored backgrounds. Use the white wordmark on dark backgrounds.</span>
          </div>
          <div className="flex gap-2">
            <span className="text-slate-400 shrink-0">5.</span>
            <span>Geist Sans is the primary UI font. Playfair Display is for display/hero headings only.</span>
          </div>
        </div>
      </section>
    </div>
  );
}
