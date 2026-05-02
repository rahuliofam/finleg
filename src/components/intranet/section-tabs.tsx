"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SECTIONS, type SectionDefinition } from "@/types/intranet";
import { useAuth } from "@/contexts/auth-context";
import { supabase } from "@/lib/supabase";

/**
 * Top-level intranet section tabs. Injects a dynamic personal tab (keyed `my`,
 * labeled with the user's first name) at the far right — placed before the
 * Admin tab for admins, and hiding the Admin tab entirely for non-admins.
 */
export function SectionTabs() {
  const pathname = usePathname();
  const { user } = useAuth();
  const [firstName, setFirstName] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("app_users")
      .select("first_name, display_name, role")
      .eq("auth_user_id", user.id)
      .single()
      .then(({ data }) => {
        if (data) {
          setFirstName(data.first_name || data.display_name?.split(" ")[0] || null);
          setUserRole(data.role);
        }
      });
  }, [user]);

  const sections: SectionDefinition[] = (() => {
    if (!firstName) return SECTIONS;

    const isAdmin = userRole === "admin";
    const personalTab: SectionDefinition = {
      key: "my",
      label: firstName,
    };

    if (isAdmin) {
      // Insert personal tab before admin (last item)
      const withoutAdmin = SECTIONS.filter((s) => s.key !== "admin");
      return [...withoutAdmin, personalTab, { key: "admin", label: "Admin" }];
    } else {
      // Append to far right (exclude admin tab for non-admins)
      const withoutAdmin = SECTIONS.filter((s) => s.key !== "admin");
      return [...withoutAdmin, personalTab];
    }
  })();

  const getActiveSection = () => {
    for (const section of sections) {
      if (pathname.includes(`/intranet/${section.key}`)) {
        return section.key;
      }
    }
    return null;
  };

  const activeSection = getActiveSection();

  return (
    <div className="bg-[#145530]">
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex items-center gap-1 overflow-x-auto">
          {sections.map((section) => (
            <Link
              key={section.key}
              href={`/intranet/${section.key}`}
              className={`px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors ${
                activeSection === section.key
                  ? "text-white bg-[#1B6B3A] rounded-t-lg"
                  : "text-green-200/60 hover:text-white"
              }`}
            >
              {section.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
