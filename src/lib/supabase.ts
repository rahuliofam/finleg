import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://gjdvzzxsrzuorguwkaih.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdqZHZ6enhzcnp1b3JndXdrYWloIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0MzE5NTcsImV4cCI6MjA4OTAwNzk1N30.eZ6WVVb3e7HbT_LYG0YPbxl4btD6d-Hlmb657qmaOBY";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    flowType: "pkce",
  },
});

export { SUPABASE_URL };
