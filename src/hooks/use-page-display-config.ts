"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import {
  DEFAULT_TABS,
  type IntranetSection,
  type TabConfig,
} from "@/types/intranet";

interface UsePageDisplayConfigReturn {
  config: Record<string, TabConfig[]>;
  loading: boolean;
  error: string | null;
  updateTabVisibility: (
    section: string,
    tabKey: string,
    isVisible: boolean
  ) => void;
  saveChanges: () => Promise<{ error: string | null }>;
  getVisibleTabs: (section: string) => TabConfig[];
}

function getDefaultConfig(): Record<string, TabConfig[]> {
  const config: Record<string, TabConfig[]> = {};
  for (const [section, tabs] of Object.entries(DEFAULT_TABS)) {
    config[section] = tabs.map((tab, i) => ({
      tab_key: tab.key,
      tab_label: tab.label,
      is_visible: tab.defaultVisible,
      sort_order: i + 1,
    }));
  }
  return config;
}

export function usePageDisplayConfig(): UsePageDisplayConfigReturn {
  const [config, setConfig] = useState<Record<string, TabConfig[]>>(
    getDefaultConfig
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchConfig() {
      try {
        const { data, error: fetchError } = await supabase
          .from("page_display_config")
          .select("section, tab_key, tab_label, is_visible, sort_order")
          .order("sort_order", { ascending: true });

        if (fetchError) {
          // Fall back to defaults if table doesn't exist or fetch fails
          console.warn("Failed to fetch page display config:", fetchError.message);
          setLoading(false);
          return;
        }

        if (data && data.length > 0) {
          const grouped: Record<string, TabConfig[]> = {};
          for (const row of data) {
            if (!grouped[row.section]) {
              grouped[row.section] = [];
            }
            grouped[row.section].push({
              tab_key: row.tab_key,
              tab_label: row.tab_label,
              is_visible: row.is_visible,
              sort_order: row.sort_order,
            });
          }
          // Merge with defaults for any sections not in the DB
          const defaults = getDefaultConfig();
          for (const section of Object.keys(defaults)) {
            if (!grouped[section]) {
              grouped[section] = defaults[section];
            }
          }
          setConfig(grouped);
        }
      } catch {
        console.warn("Failed to fetch page display config, using defaults");
      } finally {
        setLoading(false);
      }
    }

    fetchConfig();
  }, []);

  const updateTabVisibility = useCallback(
    (section: string, tabKey: string, isVisible: boolean) => {
      setConfig((prev) => {
        const sectionTabs = prev[section] || [];
        return {
          ...prev,
          [section]: sectionTabs.map((tab) =>
            tab.tab_key === tabKey ? { ...tab, is_visible: isVisible } : tab
          ),
        };
      });
    },
    []
  );

  const saveChanges = useCallback(async () => {
    try {
      const allTabs: Array<{
        section: string;
        tab_key: string;
        tab_label: string;
        is_visible: boolean;
        sort_order: number;
      }> = [];

      for (const [section, tabs] of Object.entries(config)) {
        for (const tab of tabs) {
          allTabs.push({
            section,
            tab_key: tab.tab_key,
            tab_label: tab.tab_label,
            is_visible: tab.is_visible,
            sort_order: tab.sort_order,
          });
        }
      }

      const { error: upsertError } = await supabase
        .from("page_display_config")
        .upsert(allTabs, { onConflict: "section,tab_key" });

      if (upsertError) {
        return { error: upsertError.message };
      }
      return { error: null };
    } catch {
      return { error: "Failed to save changes" };
    }
  }, [config]);

  const getVisibleTabs = useCallback(
    (section: string): TabConfig[] => {
      const sectionTabs = config[section] || [];
      return sectionTabs.filter((tab) => tab.is_visible);
    },
    [config]
  );

  return {
    config,
    loading,
    error,
    updateTabVisibility,
    saveChanges,
    getVisibleTabs,
  };
}
