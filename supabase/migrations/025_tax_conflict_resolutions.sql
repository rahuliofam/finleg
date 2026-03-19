-- Track individual conflict field resolutions from email-based voting
CREATE TABLE IF NOT EXISTS tax_conflict_resolutions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id   UUID NOT NULL REFERENCES tax_returns(id) ON DELETE CASCADE,
  token       TEXT NOT NULL,  -- groups all conflicts for one extraction run
  field       TEXT NOT NULL,  -- e.g. "summary.adjusted_gross_income"
  gemini_value TEXT,
  claude_value TEXT,
  chosen_source TEXT,          -- 'gemini' | 'claude' | null (pending)
  chosen_value  TEXT,
  resolved_at   TIMESTAMPTZ,
  total_conflicts INT NOT NULL DEFAULT 1,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (token, field)
);

CREATE INDEX idx_tax_conflict_resolutions_token ON tax_conflict_resolutions(token);
CREATE INDEX idx_tax_conflict_resolutions_return ON tax_conflict_resolutions(return_id);
