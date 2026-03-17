-- Track daily context window token usage for the devcontrol dashboard
CREATE TABLE IF NOT EXISTS context_snapshots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  snapshot_date date NOT NULL DEFAULT CURRENT_DATE,
  always_loaded_tokens integer NOT NULL,
  total_tokens integer NOT NULL,
  breakdown jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (snapshot_date)
);

-- RLS: allow anon read/insert for the dashboard
ALTER TABLE context_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_read_context_snapshots"
  ON context_snapshots FOR SELECT
  TO anon USING (true);

CREATE POLICY "anon_insert_context_snapshots"
  ON context_snapshots FOR INSERT
  TO anon WITH CHECK (true);

-- Allow upsert (update on conflict)
CREATE POLICY "anon_update_context_snapshots"
  ON context_snapshots FOR UPDATE
  TO anon USING (true) WITH CHECK (true);
