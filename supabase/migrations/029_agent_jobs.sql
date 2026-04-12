-- Agent Jobs: email-triggered Claude Code automation queue
CREATE TABLE IF NOT EXISTS agent_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_email text NOT NULL,
  sender_name text,
  subject text,
  prompt text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  result text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);

-- Index for the runner to poll pending jobs efficiently
CREATE INDEX idx_agent_jobs_status ON agent_jobs (status) WHERE status = 'pending';

-- RLS: only service role can access (no browser access needed)
ALTER TABLE agent_jobs ENABLE ROW LEVEL SECURITY;
