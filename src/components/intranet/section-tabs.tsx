"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SECTIONS } from "@/types/intranet";

export function SectionTabs() {
  const pathname = usePathname();

  const getActiveSection = () => {
    for (const section of SECTIONS) {
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
          {SECTIONS.map((section) => (
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
