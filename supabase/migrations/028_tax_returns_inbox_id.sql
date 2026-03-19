-- Link tax_returns back to statement_inbox for source tracing
ALTER TABLE tax_returns ADD COLUMN inbox_id UUID REFERENCES statement_inbox(id);
CREATE INDEX idx_tax_returns_inbox_id ON tax_returns(inbox_id);
