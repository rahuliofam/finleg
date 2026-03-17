-- Schwab Integration Setup
-- Seeds institution, registers brokerage tab in bookkeeping
-- ============================================================

-- Seed Charles Schwab as an institution
INSERT INTO institutions (name, institution_type, website, metadata)
VALUES ('Charles Schwab', 'brokerage', 'https://www.schwab.com', '{"api_base": "https://api.schwabapi.com"}')
ON CONFLICT (name) DO NOTHING;

-- Register brokerage tab under bookkeeping section
INSERT INTO page_display_config (section, tab_key, tab_label, is_visible, sort_order)
VALUES ('bookkeeping', 'brokerage', 'Brokerage', true, 95)
ON CONFLICT (section, tab_key) DO NOTHING;
