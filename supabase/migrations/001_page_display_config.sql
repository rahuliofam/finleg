-- Page Display Config table
-- Stores which tabs are visible in each intranet section
CREATE TABLE IF NOT EXISTS page_display_config (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  section TEXT NOT NULL,
  tab_key TEXT NOT NULL,
  tab_label TEXT NOT NULL,
  is_visible BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(section, tab_key)
);

-- Enable RLS
ALTER TABLE page_display_config ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read
CREATE POLICY "Authenticated users can read page_display_config"
  ON page_display_config FOR SELECT
  TO authenticated
  USING (true);

-- Authenticated users can update
CREATE POLICY "Authenticated users can update page_display_config"
  ON page_display_config FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Authenticated users can insert
CREATE POLICY "Authenticated users can insert page_display_config"
  ON page_display_config FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_page_display_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_page_display_config_updated_at
  BEFORE UPDATE ON page_display_config
  FOR EACH ROW
  EXECUTE FUNCTION update_page_display_updated_at();

-- Seed default data
INSERT INTO page_display_config (section, tab_key, tab_label, is_visible, sort_order) VALUES
  -- Admin section: Users, Releases, Brand ON; rest OFF
  ('admin', 'users', 'Users', true, 1),
  ('admin', 'passwords', 'Passwords', false, 2),
  ('admin', 'settings', 'Settings', false, 3),
  ('admin', 'releases', 'Releases', true, 4),
  ('admin', 'templates', 'Templates', false, 5),
  ('admin', 'brand', 'Brand', true, 6),
  ('admin', 'accounting', 'Accounting', false, 7),
  ('admin', 'life-of-pai', 'Life of PAI', false, 8),
  -- Devices section
  ('devices', 'inventory', 'Inventory', true, 1),
  ('devices', 'assignments', 'Assignments', true, 2),
  ('devices', 'maintenance', 'Maintenance', false, 3),
  ('devices', 'procurement', 'Procurement', false, 4),
  -- Residents section
  ('residents', 'directory', 'Directory', true, 1),
  ('residents', 'rooms', 'Rooms', true, 2),
  ('residents', 'check-in-out', 'Check In/Out', false, 3),
  ('residents', 'requests', 'Requests', false, 4),
  -- Associates section
  ('associates', 'directory', 'Directory', true, 1),
  ('associates', 'organizations', 'Organizations', true, 2),
  ('associates', 'donations', 'Donations', false, 3),
  ('associates', 'communications', 'Communications', false, 4),
  -- Staff section
  ('staff', 'directory', 'Directory', true, 1),
  ('staff', 'schedules', 'Schedules', true, 2),
  ('staff', 'roles', 'Roles', false, 3),
  ('staff', 'attendance', 'Attendance', false, 4)
ON CONFLICT (section, tab_key) DO NOTHING;
