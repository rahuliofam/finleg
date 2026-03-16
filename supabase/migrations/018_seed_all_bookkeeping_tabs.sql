-- Ensure all bookkeeping tabs exist in page_display_config
-- (migration 016 only inserted dashboard, tasks, tax-report)
INSERT INTO page_display_config (section, tab_key, tab_label, is_visible, sort_order)
VALUES
  ('bookkeeping', 'ledger-notes', 'Ledger Notes', true, 10),
  ('bookkeeping', 'statements', 'Statements', true, 20),
  ('bookkeeping', 'categorize', 'Categorize', true, 30),
  ('bookkeeping', 'receipts', 'Receipts', true, 40),
  ('bookkeeping', 'bookkeeper', 'Bookkeeper Queue', true, 50),
  ('bookkeeping', 'activity', 'Activity', true, 60)
ON CONFLICT (section, tab_key) DO NOTHING;

-- Fix sort_order for tabs from migration 016 to fit the sequence
UPDATE page_display_config SET sort_order = 0 WHERE section = 'bookkeeping' AND tab_key = 'dashboard';
UPDATE page_display_config SET sort_order = 55 WHERE section = 'bookkeeping' AND tab_key = 'tasks';
UPDATE page_display_config SET sort_order = 90 WHERE section = 'bookkeeping' AND tab_key = 'tax-report';
