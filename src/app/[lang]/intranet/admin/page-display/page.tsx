"use client";

import { useState } from "react";
import { usePageDisplayConfig } from "@/hooks/use-page-display-config";
import { SECTIONS, type IntranetSection } from "@/types/intranet";

export default function PageDisplayPage() {
  const { config, loading, updateTabVisibility, saveChanges } =
    usePageDisplayConfig();
  const [selectedSection, setSelectedSection] = useState<IntranetSection>(
    "admin"
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    const { error } = await saveChanges();
    setSaving(false);
    if (error) {
      setMessage({ type: "error", text: error });
    } else {
      setMessage({ type: "success", text: "Changes saved successfully." });
    }
  };

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-slate-900 mb-4">
          Page Display
        </h1>
        <p className="text-slate-500">Loading configuration...</p>
      </div>
    );
  }

  const sectionTabs = config[selectedSection] || [];

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 mb-6">Page Display</h1>
      <p className="text-slate-600 mb-6">
        Configure which tabs are displayed in each section.
      </p>

      <div className="mb-6">
        <label
          htmlFor="section-select"
          className="block text-sm font-medium text-slate-700 mb-2"
        >
          Section
        </label>
        <select
          id="section-select"
          value={selectedSection}
          onChange={(e) =>
            setSelectedSection(e.target.value as IntranetSection)
          }
          className="rounded-lg border border-slate-300 px-4 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
        >
          {SECTIONS.map((section) => (
            <option key={section.key} value={section.key}>
              {section.label}
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-xl border border-slate-200 overflow-hidden mb-6">
        <table className="w-full">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="text-left text-sm font-medium text-slate-700 px-6 py-3">
                Tab Name
              </th>
              <th className="text-center text-sm font-medium text-slate-700 px-6 py-3 w-24">
                Visible
              </th>
            </tr>
          </thead>
          <tbody>
            {sectionTabs.map((tab) => (
              <tr
                key={tab.tab_key}
                className="border-b border-slate-100 last:border-b-0"
              >
                <td className="px-6 py-3 text-sm text-slate-900">
                  {tab.tab_label}
                </td>
                <td className="px-6 py-3 text-center">
                  <input
                    type="checkbox"
                    checked={tab.is_visible}
                    onChange={(e) =>
                      updateTabVisibility(
                        selectedSection,
                        tab.tab_key,
                        e.target.checked
                      )
                    }
                    className="h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedSection === "admin" && (
        <p className="text-xs text-slate-400 mb-4">
          The &quot;Page Display&quot; tab is always shown and cannot be
          disabled.
        </p>
      )}

      {message && (
        <div
          className={`mb-4 text-sm rounded-lg px-4 py-3 ${
            message.type === "success"
              ? "bg-green-50 border border-green-200 text-green-700"
              : "bg-red-50 border border-red-200 text-red-700"
          }`}
        >
          {message.text}
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={saving}
        className="px-6 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
      >
        {saving ? "Saving..." : "Save Changes"}
      </button>
    </div>
  );
}
