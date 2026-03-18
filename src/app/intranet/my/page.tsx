"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { supabase } from "@/lib/supabase";

export default function MyDashboardPage() {
  const { user } = useAuth();
  const [firstName, setFirstName] = useState<string>("");

  useEffect(() => {
    if (!user) return;
    supabase
      .from("app_users")
      .select("first_name, display_name")
      .eq("auth_user_id", user.id)
      .single()
      .then(({ data }) => {
        if (data) {
          setFirstName(data.first_name || data.display_name?.split(" ")[0] || "");
        }
      });
  }, [user]);

  const label = firstName ? `${firstName} Dashboard` : "My Dashboard";

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 mb-4">{label}</h1>
      <p className="text-slate-600 mb-6">
        Select a tab above to view your personal information.
      </p>
      <div className="rounded-xl border border-slate-200 p-8 text-center text-slate-500">
        <p>Your personal dashboard items will appear here.</p>
      </div>
    </div>
  );
}
