"use client";

import { useEffect, useState } from "react";

const MANIFEST_URL = "https://alpacaplayhouse.com/infra/updates.json";
const STORAGE_KEY = "alpacapps_last_update_check";
const CHECK_INTERVAL_DAYS = 30;

interface Feature {
  id: string;
  name: string;
  date: string;
  description: string;
}

interface UpdateState {
  hasUpdates: boolean;
  features: Feature[];
  updatesPage: string;
}

export function UpdateBanner() {
  const [state, setState] = useState<UpdateState | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const lastChecked = localStorage.getItem(STORAGE_KEY);
    if (lastChecked) {
      const daysSince =
        (Date.now() - new Date(lastChecked).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince < CHECK_INTERVAL_DAYS) return;
    }

    fetch(MANIFEST_URL, { cache: "no-cache" })
      .then((res) => (res.ok ? res.json() : null))
      .then((manifest) => {
        if (!manifest) return;
        const lastDate = lastChecked ? new Date(lastChecked) : new Date(0);
        const newFeatures = manifest.features.filter(
          (f: Feature) => new Date(f.date) > lastDate
        );
        if (newFeatures.length > 0) {
          setState({
            hasUpdates: true,
            features: newFeatures,
            updatesPage: manifest.updatesPage,
          });
        }
      })
      .catch(() => {});
  }, []);

  if (!state?.hasUpdates || dismissed) return null;

  const count = state.features.length;
  const names = state.features.map((f) => f.name);
  const preview =
    names.length <= 3
      ? names.join(", ")
      : names.slice(0, 2).join(", ") + `, and ${names.length - 2} more`;

  const handleDismiss = () => {
    localStorage.setItem(
      STORAGE_KEY,
      new Date().toISOString().split("T")[0]
    );
    setDismissed(true);
  };

  return (
    <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-3 mb-4 flex items-start gap-3">
      <span className="text-lg mt-0.5">&#x2728;</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-indigo-900">
          {count} new template feature{count > 1 ? "s" : ""} available
        </p>
        <p className="text-xs text-indigo-700 mt-0.5">{preview}</p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <a
          href={state.updatesPage}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 rounded transition-colors"
        >
          View Updates
        </a>
        <button
          onClick={handleDismiss}
          className="text-xs text-indigo-400 hover:text-indigo-600 transition-colors"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
