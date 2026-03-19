-- Migration 025: Tax Field Registry
-- Adds a form/field metadata registry that makes the tax schema extensible to ANY form type
-- without requiring new DDL. New forms (706, 709, state returns, etc.) are added by inserting
-- rows into the registry, and values go into tax_return_line_items via FK.
--
-- Architecture:
--   tax_form_registry       → Catalog of all known IRS/state forms (one row per form-version)
--   tax_field_registry      → Every field on every form, with rich metadata for LLM analysis
--   tax_return_line_items   → Upgraded with FK to field registry
--   tax_all_fields (view)   → Unifying view that merges typed tables + EAV through the registry
--   tax_form_field_catalog  → Discovery view for LLMs to browse available forms/fields
--
-- Design decisions (from plan review):
--   - 2B: One form_registry row per form-version; stable field_key across versions
--   - 1A: Typed tables + EAV unified through a single view
--   - 3A: Add FK to existing tax_return_line_items (no data exists yet)

-- ============================================================================
-- FORM REGISTRY — What forms exist
-- ============================================================================

create table if not exists tax_form_registry (
  id uuid primary key default gen_random_uuid(),
  -- Form identity
  form_code text not null,             -- '1040', '1041', '706', '709', 'Schedule_A', 'CA_540'
  form_name text not null,             -- 'U.S. Individual Income Tax Return'
  form_category text not null check (form_category in (
    'individual',   -- 1040 and schedules
    'trust',        -- 1041 and schedules
    'estate',       -- 706
    'gift',         -- 709
    'partnership',  -- 1065
    'scorp',        -- 1120S
    'info',         -- W-2, 1099 variants
    'state',        -- CA-540, NY IT-201, etc.
    'credit',       -- Form 8962, 8995, etc.
    'depreciation', -- Form 4562
    'gains'         -- Schedule D, Form 8949
  )),
  -- Versioning: one row per form-version period
  -- field_key stays stable across versions; irs_line_number may change
  tax_year_start int not null,         -- First year this form definition applies
  tax_year_end int,                    -- NULL = still current
  irs_revision_date text,              -- e.g. '2024' from bottom of form
  -- Whether this form has a dedicated typed table in migration 024
  has_typed_table boolean default false,
  typed_table_name text,               -- e.g. 'tax_form_1040' — NULL if EAV-only
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(form_code, tax_year_start)
);

comment on table tax_form_registry is
  'Catalog of all known tax forms (IRS and state). One row per form per version period. '
  'form_code is the IRS form number (e.g. ''1040'', ''706''). '
  'has_typed_table indicates if migration 024 has a dedicated table for this form. '
  'New forms are added by inserting rows here — no DDL changes needed.';

-- ============================================================================
-- FIELD REGISTRY — What fields each form has
-- ============================================================================

create table if not exists tax_field_registry (
  id uuid primary key default gen_random_uuid(),
  form_registry_id uuid not null references tax_form_registry(id) on delete cascade,
  -- Field identity — stable across form versions
  field_key text not null,               -- 'adjusted_gross_income', 'line_1a_w2_wages'
  -- Metadata for LLM interpretation
  label text not null,                   -- Exact IRS label: 'Adjusted gross income'
  description text,                      -- Extended description for LLM context
  irs_line_number text,                  -- '11', '4a', 'Part II Line 3'
  irs_form_part text,                    -- 'Income', 'Deductions', 'Part II - Income Distribution'
  -- Data typing
  data_type text not null default 'numeric' check (data_type in (
    'numeric', 'text', 'boolean', 'date', 'enum', 'integer'
  )),
  enum_values text[],                    -- For enums: ARRAY['single','mfj','mfs','hoh','qss']
  unit text default 'usd' check (unit in (
    'usd', 'percent', 'count', 'days', 'text', 'boolean', 'date', 'ratio', 'miles'
  )),
  -- Relationships between fields
  parent_field_key text,                 -- For subtotals: points to the parent sum field
  computation_rule text,                 -- Human-readable: 'sum(line_1a through line_1h)'
  -- MeF mapping (for future e-file integration)
  mef_xpath text,                        -- '/Return/ReturnData/IRS1040/WagesAmt'
  -- For typed tables: which column in the typed table stores this field
  typed_table_column text,               -- 'line_11_adjusted_gross_income' — NULL for EAV-only fields
  -- Behavioral flags
  is_repeating boolean default false,    -- True for things like 8949 transactions, K-1 items
  is_computed boolean default false,     -- True if derived from other lines
  is_summary boolean default false,      -- True if this is a total/subtotal line
  sort_order int,                        -- Display order matching form layout
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(form_registry_id, field_key)
);

comment on table tax_field_registry is
  'Every field on every tax form, with rich metadata for LLM analysis. '
  'field_key is stable across form versions (e.g. ''adjusted_gross_income''). '
  'label matches the exact IRS form text. description provides extended context. '
  'typed_table_column maps to the column name in a dedicated typed table (if one exists). '
  'For EAV-only forms, values are stored in tax_return_line_items via field_registry_id FK.';

-- ============================================================================
-- UPGRADE tax_return_line_items — add FK to field registry
-- ============================================================================

alter table tax_return_line_items
  add column if not exists field_registry_id uuid references tax_field_registry(id);

comment on column tax_return_line_items.field_registry_id is
  'Optional FK to the field registry. When set, the field metadata (label, type, description) '
  'comes from the registry instead of inline columns. New rows should always use this.';

create index if not exists idx_tax_return_line_items_field_registry
  on tax_return_line_items(field_registry_id);

-- ============================================================================
-- EXPAND tax_returns.return_type to support new form types
-- ============================================================================

alter table tax_returns
  drop constraint if exists tax_returns_return_type_check;

alter table tax_returns
  add constraint tax_returns_return_type_check
  check (return_type in (
    '1040', '1041', '1065', '1120', '1120S',
    '706', '709', '990',
    'state'  -- state returns use this + a state_code column or notes
  ));

-- ============================================================================
-- INDEXES for registry queries
-- ============================================================================

create index if not exists idx_tax_form_registry_code on tax_form_registry(form_code);
create index if not exists idx_tax_form_registry_category on tax_form_registry(form_category);
create index if not exists idx_tax_field_registry_form on tax_field_registry(form_registry_id);
create index if not exists idx_tax_field_registry_key on tax_field_registry(field_key);
create index if not exists idx_tax_field_registry_typed_col on tax_field_registry(typed_table_column)
  where typed_table_column is not null;

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

alter table tax_form_registry enable row level security;
alter table tax_field_registry enable row level security;

-- Registry is reference data — readable by all authenticated users, writable by service role
create policy "authenticated_read_tax_form_registry"
  on tax_form_registry for select to authenticated using (true);
create policy "service_role_bypass_tax_form_registry"
  on tax_form_registry for all to service_role using (true) with check (true);

create policy "authenticated_read_tax_field_registry"
  on tax_field_registry for select to authenticated using (true);
create policy "service_role_bypass_tax_field_registry"
  on tax_field_registry for all to service_role using (true) with check (true);

-- ============================================================================
-- SEED: Form Registry — existing typed tables
-- ============================================================================

insert into tax_form_registry (form_code, form_name, form_category, tax_year_start, tax_year_end, has_typed_table, typed_table_name) values
  ('1040',         'U.S. Individual Income Tax Return',                          'individual',    2019, null, true,  'tax_form_1040'),
  ('1040_dep',     'Form 1040 Dependents',                                      'individual',    2019, null, true,  'tax_form_1040_dependents'),
  ('Schedule_1',   'Schedule 1 — Additional Income and Adjustments to Income',   'individual',    2019, null, true,  'tax_schedule_1'),
  ('Schedule_2',   'Schedule 2 — Additional Taxes',                              'individual',    2019, null, true,  'tax_schedule_2'),
  ('Schedule_C',   'Schedule C — Profit or Loss From Business',                  'individual',    2019, null, true,  'tax_schedule_c'),
  ('Schedule_D',   'Schedule D — Capital Gains and Losses',                      'gains',         2019, null, true,  'tax_schedule_d'),
  ('8949',         'Form 8949 — Sales and Dispositions of Capital Assets',       'gains',         2019, null, true,  'tax_form_8949_transactions'),
  ('Schedule_E',   'Schedule E — Supplemental Income and Loss',                  'individual',    2019, null, true,  'tax_schedule_e_rental_properties'),
  ('Schedule_SE',  'Schedule SE — Self-Employment Tax',                          'individual',    2019, null, true,  'tax_schedule_se'),
  ('4562',         'Form 4562 — Depreciation and Amortization',                  'depreciation',  2019, null, true,  'tax_form_4562'),
  ('8962',         'Form 8962 — Premium Tax Credit',                             'credit',        2019, null, true,  'tax_form_8962'),
  ('1041',         'U.S. Income Tax Return for Estates and Trusts',              'trust',         2019, null, true,  'tax_form_1041'),
  ('1041_B',       'Form 1041 Schedule B — Income Distribution Deduction',       'trust',         2019, null, true,  'tax_form_1041_schedule_b'),
  ('1041_G',       'Form 1041 Schedule G — Tax Computation and Payments',        'trust',         2019, null, true,  'tax_form_1041_schedule_g'),
  ('1041_I',       'Form 1041 Schedule I — Alternative Minimum Tax',             'trust',         2019, null, true,  'tax_form_1041_schedule_i'),
  ('1041_J',       'Form 1041 Schedule J — Accumulation Distribution',           'trust',         2019, null, true,  'tax_form_1041_schedule_j'),
  ('8995',         'Form 8995 — Qualified Business Income Deduction',            'credit',        2019, null, true,  'tax_form_8995'),
  ('K1',           'Schedule K-1 — Beneficiary/Partner Share of Income',         'individual',    2019, null, true,  'tax_schedule_k1')
on conflict (form_code, tax_year_start) do nothing;

-- ============================================================================
-- SEED: Form Registry — new forms (EAV-only, no typed tables)
-- ============================================================================

insert into tax_form_registry (form_code, form_name, form_category, tax_year_start, tax_year_end, has_typed_table, typed_table_name) values
  ('706',          'United States Estate (and Generation-Skipping Transfer) Tax Return',  'estate',      2019, null, false, null),
  ('709',          'United States Gift (and Generation-Skipping Transfer) Tax Return',    'gift',        2019, null, false, null),
  ('Schedule_A',   'Schedule A — Itemized Deductions',                                    'individual',  2019, null, false, null),
  ('CA_540',       'California Resident Income Tax Return',                               'state',       2019, null, false, null),
  ('1065',         'U.S. Return of Partnership Income',                                   'partnership', 2019, null, false, null),
  ('1120S',        'U.S. Income Tax Return for an S Corporation',                         'scorp',       2019, null, false, null)
on conflict (form_code, tax_year_start) do nothing;

-- ============================================================================
-- SEED: Field Registry — Form 1040 (maps to typed table columns)
-- ============================================================================

-- Helper: get form_registry_id for a form_code
-- We use subselects to reference registry IDs

insert into tax_field_registry (form_registry_id, field_key, label, description, irs_line_number, irs_form_part, data_type, unit, typed_table_column, is_computed, is_summary, sort_order) values
  -- Filing status & checkboxes
  ((select id from tax_form_registry where form_code = '1040' and tax_year_start = 2019),
   'filing_status', 'Filing status', 'Single, MFJ, MFS, HOH, or QSS', null, 'Filing Status', 'enum', 'text', 'filing_status', false, false, 1),
  ((select id from tax_form_registry where form_code = '1040' and tax_year_start = 2019),
   'digital_assets_activity', 'Digital assets question', 'Did you receive, sell, or dispose of digital assets?', null, 'Digital Assets', 'boolean', 'boolean', 'digital_assets_activity', false, false, 2),

  -- Income lines 1a-1z
  ((select id from tax_form_registry where form_code = '1040' and tax_year_start = 2019),
   'w2_wages', 'Wages, salaries, tips (W-2)', 'Total W-2 box 1 wages, salaries, tips', '1a', 'Income', 'numeric', 'usd', 'line_1a_w2_wages', false, false, 10),
  ((select id from tax_form_registry where form_code = '1040' and tax_year_start = 2019),
   'household_employee_wages', 'Household employee income', 'Wages not on W-2', '1b', 'Income', 'numeric', 'usd', 'line_1b_household_employee_wages', false, false, 11),
  ((select id from tax_form_registry where form_code = '1040' and tax_year_start = 2019),
   'tip_income', 'Tip income not on W-2', 'Tip income not reported on line 1a', '1c', 'Income', 'numeric', 'usd', 'line_1c_tip_income', false, false, 12),
  ((select id from tax_form_registry where form_code = '1040' and tax_year_start = 2019),
   'medicaid_waiver', 'Medicaid waiver payments', 'Medicaid waiver payments not included in income', '1d', 'Income', 'numeric', 'usd', 'line_1d_medicaid_waiver', false, false, 13),
  ((select id from tax_form_registry where form_code = '1040' and tax_year_start = 2019),
   'dependent_care', 'Dependent care benefits', 'Employer-provided dependent care benefits', '1e', 'Income', 'numeric', 'usd', 'line_1e_dependent_care', false, false, 14),
  ((select id from tax_form_registry where form_code = '1040' and tax_year_start = 2019),
   'adoption_benefits', 'Adoption benefits', 'Employer-provided adoption benefits', '1f', 'Income', 'numeric', 'usd', 'line_1f_adoption_benefits', false, false, 15),
  ((select id from tax_form_registry where form_code = '1040' and tax_year_start = 2019),
   'form_8919_wages', 'Form 8919 wages', 'Wages from Form 8919 (uncollected SS/Medicare)', '1g', 'Income', 'numeric', 'usd', 'line_1g_form_8919_wages', false, false, 16),
  ((select id from tax_form_registry where form_code = '1040' and tax_year_start = 2019),
   'other_earned_income', 'Other earned income', 'Strike benefits, disability pensions, etc.', '1h', 'Income', 'numeric', 'usd', 'line_1h_other_earned_income', false, false, 17),
  ((select id from tax_form_registry where form_code = '1040' and tax_year_start = 2019),
   'nontaxable_combat_pay', 'Nontaxable combat pay', 'Nontaxable combat pay election', '1i', 'Income', 'numeric', 'usd', 'line_1i_nontaxable_combat_pay', false, false, 18),
  ((select id from tax_form_registry where form_code = '1040' and tax_year_start = 2019),
   'total_w2_income', 'Total from W-2 and wage lines', 'Sum of lines 1a through 1h', '1z', 'Income', 'numeric', 'usd', 'line_1z_total_w2_income', true, true, 19),

  -- Interest and dividends
  ((select id from tax_form_registry where form_code = '1040' and tax_year_start = 2019),
   'tax_exempt_interest', 'Tax-exempt interest', 'Tax-exempt interest (informational)', '2a', 'Income', 'numeric', 'usd', 'line_2a_tax_exempt_interest', false, false, 20),
  ((select id from tax_form_registry where form_code = '1040' and tax_year_start = 2019),
   'taxable_interest', 'Taxable interest', 'Taxable interest from Schedule B or 1099-INT', '2b', 'Income', 'numeric', 'usd', 'line_2b_taxable_interest', false, false, 21),
  ((select id from tax_form_registry where form_code = '1040' and tax_year_start = 2019),
   'qualified_dividends', 'Qualified dividends', 'Qualified dividends (taxed at capital gains rates)', '3a', 'Income', 'numeric', 'usd', 'line_3a_qualified_dividends', false, false, 22),
  ((select id from tax_form_registry where form_code = '1040' and tax_year_start = 2019),
   'ordinary_dividends', 'Ordinary dividends', 'Total ordinary dividends from Schedule B or 1099-DIV', '3b', 'Income', 'numeric', 'usd', 'line_3b_ordinary_dividends', false, false, 23),

  -- IRA, pensions, SS
  ((select id from tax_form_registry where form_code = '1040' and tax_year_start = 2019),
   'ira_distributions', 'IRA distributions', 'Total IRA distributions received', '4a', 'Income', 'numeric', 'usd', 'line_4a_ira_distributions', false, false, 24),
  ((select id from tax_form_registry where form_code = '1040' and tax_year_start = 2019),
   'ira_taxable', 'IRA distributions taxable amount', 'Taxable portion of IRA distributions', '4b', 'Income', 'numeric', 'usd', 'line_4b_ira_taxable', false, false, 25),
  ((select id from tax_form_registry where form_code = '1040' and tax_year_start = 2019),
   'pensions_annuities', 'Pensions and annuities', 'Total pensions and annuities received', '5a', 'Income', 'numeric', 'usd', 'line_5a_pensions_annuities', false, false, 26),
  ((select id from tax_form_registry where form_code = '1040' and tax_year_start = 2019),
   'pensions_taxable', 'Pensions taxable amount', 'Taxable portion of pensions and annuities', '5b', 'Income', 'numeric', 'usd', 'line_5b_pensions_taxable', false, false, 27),
  ((select id from tax_form_registry where form_code = '1040' and tax_year_start = 2019),
   'social_security', 'Social security benefits', 'Total social security benefits received', '6a', 'Income', 'numeric', 'usd', 'line_6a_social_security', false, false, 28),
  ((select id from tax_form_registry where form_code = '1040' and tax_year_start = 2019),
   'social_security_taxable', 'Social security taxable amount', 'Taxable portion of social security benefits', '6b', 'Income', 'numeric', 'usd', 'line_6b_social_security_taxable', false, false, 29),

  -- Summary income lines
  ((select id from tax_form_registry where form_code = '1040' and tax_year_start = 2019),
   'capital_gain_loss', 'Capital gain or (loss)', 'Net capital gain or loss from Schedule D', '7', 'Income', 'numeric', 'usd', 'line_7_capital_gain_loss', false, false, 30),
  ((select id from tax_form_registry where form_code = '1040' and tax_year_start = 2019),
   'schedule1_additional_income', 'Other income from Schedule 1', 'Additional income from Schedule 1, line 10', '8', 'Income', 'numeric', 'usd', 'line_8_schedule1_additional_income', true, false, 31),
  ((select id from tax_form_registry where form_code = '1040' and tax_year_start = 2019),
   'total_income', 'Total income', 'Sum of all income lines', '9', 'Income', 'numeric', 'usd', 'line_9_total_income', true, true, 32),
  ((select id from tax_form_registry where form_code = '1040' and tax_year_start = 2019),
   'schedule1_adjustments', 'Adjustments from Schedule 1', 'Total adjustments from Schedule 1, line 26', '10', 'Adjusted Gross Income', 'numeric', 'usd', 'line_10_schedule1_adjustments', true, false, 33),
  ((select id from tax_form_registry where form_code = '1040' and tax_year_start = 2019),
   'adjusted_gross_income', 'Adjusted gross income (AGI)', 'Total income minus above-the-line deductions. Key threshold for many tax provisions.', '11', 'Adjusted Gross Income', 'numeric', 'usd', 'line_11_adjusted_gross_income', true, true, 34),

  -- Deductions
  ((select id from tax_form_registry where form_code = '1040' and tax_year_start = 2019),
   'standard_or_itemized_deduction', 'Standard deduction or itemized deductions', 'Standard deduction amount or Schedule A total', '12', 'Deductions', 'numeric', 'usd', 'line_12_standard_or_itemized_deduction', false, false, 35),
  ((select id from tax_form_registry where form_code = '1040' and tax_year_start = 2019),
   'qbi_deduction', 'Qualified business income deduction', 'Section 199A QBI deduction from Form 8995', '13', 'Deductions', 'numeric', 'usd', 'line_13_qbi_deduction', true, false, 36),
  ((select id from tax_form_registry where form_code = '1040' and tax_year_start = 2019),
   'total_deductions', 'Total deductions', 'Standard/itemized + QBI deduction', '14', 'Deductions', 'numeric', 'usd', 'line_14_total_deductions', true, true, 37),
  ((select id from tax_form_registry where form_code = '1040' and tax_year_start = 2019),
   'taxable_income', 'Taxable income', 'AGI minus total deductions. Base for tax computation.', '15', 'Taxable Income', 'numeric', 'usd', 'line_15_taxable_income', true, true, 38),

  -- Tax and credits (lines 16-24)
  ((select id from tax_form_registry where form_code = '1040' and tax_year_start = 2019),
   'tax', 'Tax', 'Tax from tax tables, qualified dividends worksheet, or Schedule D worksheet', '16', 'Tax and Credits', 'numeric', 'usd', 'line_16_tax', true, false, 40),
  ((select id from tax_form_registry where form_code = '1040' and tax_year_start = 2019),
   'schedule2_amount', 'Amount from Schedule 2 Part I', 'AMT and excess PTC repayment', '17', 'Tax and Credits', 'numeric', 'usd', 'line_17_schedule2_amount', true, false, 41),
  ((select id from tax_form_registry where form_code = '1040' and tax_year_start = 2019),
   'child_tax_credit', 'Child tax credit / other dependent credit', 'From Schedule 8812', '19', 'Tax and Credits', 'numeric', 'usd', 'line_19_child_tax_credit', false, false, 43),
  ((select id from tax_form_registry where form_code = '1040' and tax_year_start = 2019),
   'total_tax', 'Total tax', 'All taxes including other taxes from Schedule 2', '24', 'Tax and Credits', 'numeric', 'usd', 'line_24_total_tax', true, true, 48),

  -- Payments (lines 25-33)
  ((select id from tax_form_registry where form_code = '1040' and tax_year_start = 2019),
   'w2_withholding', 'Federal tax withheld from W-2', 'Federal income tax withheld from W-2s', '25a', 'Payments', 'numeric', 'usd', 'line_25a_w2_withholding', false, false, 50),
  ((select id from tax_form_registry where form_code = '1040' and tax_year_start = 2019),
   '1099_withholding', 'Federal tax withheld from 1099', 'Federal income tax withheld from 1099s', '25b', 'Payments', 'numeric', 'usd', 'line_25b_1099_withholding', false, false, 51),
  ((select id from tax_form_registry where form_code = '1040' and tax_year_start = 2019),
   'total_withholding', 'Total federal tax withheld', 'Sum of all withholding', '25d', 'Payments', 'numeric', 'usd', 'line_25d_total_withholding', true, true, 53),
  ((select id from tax_form_registry where form_code = '1040' and tax_year_start = 2019),
   'estimated_payments', 'Estimated tax payments', 'Quarterly estimated tax payments made', '26', 'Payments', 'numeric', 'usd', 'line_26_estimated_payments', false, false, 54),
  ((select id from tax_form_registry where form_code = '1040' and tax_year_start = 2019),
   'eic', 'Earned income credit', 'Earned income credit (EIC)', '27', 'Payments', 'numeric', 'usd', 'line_27_eic', false, false, 55),
  ((select id from tax_form_registry where form_code = '1040' and tax_year_start = 2019),
   'total_payments', 'Total payments', 'All payments and credits', '33', 'Payments', 'numeric', 'usd', 'line_33_total_payments', true, true, 60),

  -- Refund / Amount owed
  ((select id from tax_form_registry where form_code = '1040' and tax_year_start = 2019),
   'overpaid', 'Amount overpaid', 'Total payments minus total tax (if positive)', '34', 'Refund', 'numeric', 'usd', 'line_34_overpaid', true, false, 61),
  ((select id from tax_form_registry where form_code = '1040' and tax_year_start = 2019),
   'refund', 'Refund', 'Amount to be refunded', '35a', 'Refund', 'numeric', 'usd', 'line_35a_refund', false, false, 62),
  ((select id from tax_form_registry where form_code = '1040' and tax_year_start = 2019),
   'amount_owed', 'Amount you owe', 'Total tax minus total payments (if positive)', '37', 'Amount You Owe', 'numeric', 'usd', 'line_37_amount_owed', true, false, 64),
  ((select id from tax_form_registry where form_code = '1040' and tax_year_start = 2019),
   'estimated_tax_penalty', 'Estimated tax penalty', 'Penalty for underpayment of estimated tax', '38', 'Amount You Owe', 'numeric', 'usd', 'line_38_estimated_tax_penalty', false, false, 65)
on conflict (form_registry_id, field_key) do nothing;

-- ============================================================================
-- SEED: Field Registry — Form 1041 (maps to typed table)
-- ============================================================================

insert into tax_field_registry (form_registry_id, field_key, label, description, irs_line_number, irs_form_part, data_type, unit, typed_table_column, is_computed, is_summary, sort_order) values
  ((select id from tax_form_registry where form_code = '1041' and tax_year_start = 2019),
   'interest_income', 'Interest income', 'Taxable interest income', '1', 'Income', 'numeric', 'usd', 'line_1_interest_income', false, false, 1),
  ((select id from tax_form_registry where form_code = '1041' and tax_year_start = 2019),
   'ordinary_dividends', 'Ordinary dividends', 'Total ordinary dividends', '2a', 'Income', 'numeric', 'usd', 'line_2a_ordinary_dividends', false, false, 2),
  ((select id from tax_form_registry where form_code = '1041' and tax_year_start = 2019),
   'qualified_dividends', 'Qualified dividends', 'Qualified dividends (taxed at capital gains rates)', '2b', 'Income', 'numeric', 'usd', 'line_2b_qualified_dividends', false, false, 3),
  ((select id from tax_form_registry where form_code = '1041' and tax_year_start = 2019),
   'business_income', 'Business income or loss', 'Net profit/loss from Schedule C or business activity', '3', 'Income', 'numeric', 'usd', 'line_3_business_income', false, false, 4),
  ((select id from tax_form_registry where form_code = '1041' and tax_year_start = 2019),
   'capital_gain_loss', 'Capital gain or (loss)', 'Net capital gain or loss from Schedule D', '4', 'Income', 'numeric', 'usd', 'line_4_capital_gain_loss', false, false, 5),
  ((select id from tax_form_registry where form_code = '1041' and tax_year_start = 2019),
   'rents_royalties', 'Rents, royalties, partnerships', 'Income from Schedule E', '5', 'Income', 'numeric', 'usd', 'line_5_rents_royalties', false, false, 6),
  ((select id from tax_form_registry where form_code = '1041' and tax_year_start = 2019),
   'other_income', 'Other income', 'Other income not categorized above', '8', 'Income', 'numeric', 'usd', 'line_8_other_income', false, false, 8),
  ((select id from tax_form_registry where form_code = '1041' and tax_year_start = 2019),
   'total_income', 'Total income', 'Sum of all trust/estate income lines', '9', 'Income', 'numeric', 'usd', 'line_9_total_income', true, true, 9),
  -- Deductions
  ((select id from tax_form_registry where form_code = '1041' and tax_year_start = 2019),
   'fiduciary_fees', 'Fiduciary fees', 'Trustee/executor compensation', '12', 'Deductions', 'numeric', 'usd', 'line_12_fiduciary_fees', false, false, 12),
  ((select id from tax_form_registry where form_code = '1041' and tax_year_start = 2019),
   'charitable_deduction', 'Charitable deduction', 'Amounts permanently set aside for charitable purposes', '13', 'Deductions', 'numeric', 'usd', 'line_13_charitable_deduction', false, false, 13),
  ((select id from tax_form_registry where form_code = '1041' and tax_year_start = 2019),
   'income_distribution_deduction', 'Income distribution deduction', 'Amounts distributed to beneficiaries (from Schedule B line 15)', '18', 'Deductions', 'numeric', 'usd', 'line_18_income_distribution_deduction', true, false, 18),
  ((select id from tax_form_registry where form_code = '1041' and tax_year_start = 2019),
   'qbi_deduction', 'Qualified business income deduction', 'Section 199A deduction from Form 8995', '20', 'Deductions', 'numeric', 'usd', 'line_20_qbi_deduction', true, false, 20),
  ((select id from tax_form_registry where form_code = '1041' and tax_year_start = 2019),
   'taxable_income', 'Taxable income', 'Trust/estate taxable income after all deductions', '23', 'Taxable Income', 'numeric', 'usd', 'line_23_taxable_income', true, true, 23),
  ((select id from tax_form_registry where form_code = '1041' and tax_year_start = 2019),
   'total_tax', 'Total tax', 'Total tax from Schedule G', '24', 'Tax and Payments', 'numeric', 'usd', 'line_24_total_tax', true, true, 24),
  ((select id from tax_form_registry where form_code = '1041' and tax_year_start = 2019),
   'total_payments', 'Total payments', 'Estimated payments, withholding, extension payments', '26', 'Tax and Payments', 'numeric', 'usd', 'line_26_total_payments', true, true, 26),
  ((select id from tax_form_registry where form_code = '1041' and tax_year_start = 2019),
   'tax_due', 'Tax due', 'Amount owed if tax exceeds payments', '28', 'Tax and Payments', 'numeric', 'usd', 'line_28_tax_due', true, false, 28),
  ((select id from tax_form_registry where form_code = '1041' and tax_year_start = 2019),
   'overpayment', 'Overpayment', 'Refund if payments exceed tax', '29', 'Tax and Payments', 'numeric', 'usd', 'line_29_overpayment', true, false, 29)
on conflict (form_registry_id, field_key) do nothing;

-- ============================================================================
-- SEED: Field Registry — Schedule A (Itemized Deductions) — EAV only
-- ============================================================================

insert into tax_field_registry (form_registry_id, field_key, label, description, irs_line_number, irs_form_part, data_type, unit, is_computed, is_summary, sort_order) values
  ((select id from tax_form_registry where form_code = 'Schedule_A' and tax_year_start = 2019),
   'medical_dental_expenses', 'Medical and dental expenses', 'Unreimbursed medical/dental expenses', '1', 'Medical and Dental Expenses', 'numeric', 'usd', false, false, 1),
  ((select id from tax_form_registry where form_code = 'Schedule_A' and tax_year_start = 2019),
   'medical_agi_threshold', 'AGI threshold for medical', '7.5% of AGI (Form 1040 line 11)', '3', 'Medical and Dental Expenses', 'numeric', 'usd', true, false, 3),
  ((select id from tax_form_registry where form_code = 'Schedule_A' and tax_year_start = 2019),
   'medical_deduction', 'Medical deduction', 'Medical expenses exceeding 7.5% AGI threshold', '4', 'Medical and Dental Expenses', 'numeric', 'usd', true, false, 4),
  ((select id from tax_form_registry where form_code = 'Schedule_A' and tax_year_start = 2019),
   'state_local_income_tax', 'State and local income taxes', 'State/local income or sales taxes paid', '5a', 'Taxes You Paid', 'numeric', 'usd', false, false, 5),
  ((select id from tax_form_registry where form_code = 'Schedule_A' and tax_year_start = 2019),
   'state_local_sales_tax', 'State and local sales taxes', 'General sales taxes (if elected instead of income tax)', '5b', 'Taxes You Paid', 'numeric', 'usd', false, false, 6),
  ((select id from tax_form_registry where form_code = 'Schedule_A' and tax_year_start = 2019),
   'real_estate_taxes', 'Real estate taxes', 'State/local/foreign real estate taxes', '5c', 'Taxes You Paid', 'numeric', 'usd', false, false, 7),
  ((select id from tax_form_registry where form_code = 'Schedule_A' and tax_year_start = 2019),
   'personal_property_taxes', 'Personal property taxes', 'State and local personal property taxes', '5d', 'Taxes You Paid', 'numeric', 'usd', false, false, 8),
  ((select id from tax_form_registry where form_code = 'Schedule_A' and tax_year_start = 2019),
   'salt_deduction', 'SALT deduction (capped at $10,000)', 'State and local tax deduction, subject to $10K TCJA cap', '5e', 'Taxes You Paid', 'numeric', 'usd', true, true, 9),
  ((select id from tax_form_registry where form_code = 'Schedule_A' and tax_year_start = 2019),
   'other_taxes', 'Other taxes', 'Other deductible taxes', '6', 'Taxes You Paid', 'numeric', 'usd', false, false, 10),
  ((select id from tax_form_registry where form_code = 'Schedule_A' and tax_year_start = 2019),
   'total_taxes_paid', 'Total taxes paid', 'Sum of SALT + other taxes', '7', 'Taxes You Paid', 'numeric', 'usd', true, true, 11),
  ((select id from tax_form_registry where form_code = 'Schedule_A' and tax_year_start = 2019),
   'home_mortgage_interest', 'Home mortgage interest', 'Home mortgage interest from Form 1098', '8a', 'Interest You Paid', 'numeric', 'usd', false, false, 12),
  ((select id from tax_form_registry where form_code = 'Schedule_A' and tax_year_start = 2019),
   'mortgage_points', 'Points not reported on 1098', 'Deductible mortgage points', '8c', 'Interest You Paid', 'numeric', 'usd', false, false, 14),
  ((select id from tax_form_registry where form_code = 'Schedule_A' and tax_year_start = 2019),
   'investment_interest', 'Investment interest', 'Investment interest expense deduction', '9', 'Interest You Paid', 'numeric', 'usd', false, false, 15),
  ((select id from tax_form_registry where form_code = 'Schedule_A' and tax_year_start = 2019),
   'total_interest', 'Total interest paid', 'Sum of mortgage + investment interest', '10', 'Interest You Paid', 'numeric', 'usd', true, true, 16),
  ((select id from tax_form_registry where form_code = 'Schedule_A' and tax_year_start = 2019),
   'charitable_cash', 'Gifts by cash or check', 'Charitable contributions paid in cash', '12', 'Gifts to Charity', 'numeric', 'usd', false, false, 17),
  ((select id from tax_form_registry where form_code = 'Schedule_A' and tax_year_start = 2019),
   'charitable_noncash', 'Other than by cash or check', 'Charitable contributions of property', '13', 'Gifts to Charity', 'numeric', 'usd', false, false, 18),
  ((select id from tax_form_registry where form_code = 'Schedule_A' and tax_year_start = 2019),
   'total_charitable', 'Total gifts to charity', 'Sum of cash + noncash contributions', '14', 'Gifts to Charity', 'numeric', 'usd', true, true, 19),
  ((select id from tax_form_registry where form_code = 'Schedule_A' and tax_year_start = 2019),
   'casualty_theft_losses', 'Casualty and theft losses', 'From Form 4684 (federally declared disaster only)', '15', 'Casualty and Theft Losses', 'numeric', 'usd', false, false, 20),
  ((select id from tax_form_registry where form_code = 'Schedule_A' and tax_year_start = 2019),
   'other_itemized', 'Other itemized deductions', 'Gambling losses, unrecovered pension basis, etc.', '16', 'Other Itemized Deductions', 'numeric', 'usd', false, false, 21),
  ((select id from tax_form_registry where form_code = 'Schedule_A' and tax_year_start = 2019),
   'total_itemized_deductions', 'Total itemized deductions', 'Sum of all Schedule A deductions. Compared to standard deduction.', '17', 'Total', 'numeric', 'usd', true, true, 22)
on conflict (form_registry_id, field_key) do nothing;

-- ============================================================================
-- SEED: Field Registry — Form 706 (Estate Tax) — EAV only
-- ============================================================================

insert into tax_field_registry (form_registry_id, field_key, label, description, irs_line_number, irs_form_part, data_type, unit, is_computed, is_summary, sort_order) values
  -- Part 1: Decedent and Executor
  ((select id from tax_form_registry where form_code = '706' and tax_year_start = 2019),
   'decedent_name', 'Name of decedent', 'Full legal name of the deceased', '1', 'Part 1', 'text', 'text', false, false, 1),
  ((select id from tax_form_registry where form_code = '706' and tax_year_start = 2019),
   'date_of_death', 'Date of death', 'Date the decedent died', '1', 'Part 1', 'date', 'date', false, false, 2),
  ((select id from tax_form_registry where form_code = '706' and tax_year_start = 2019),
   'domicile_at_death', 'Domicile at time of death', 'State and county of legal domicile', '2', 'Part 1', 'text', 'text', false, false, 3),

  -- Part 2: Tax Computation
  ((select id from tax_form_registry where form_code = '706' and tax_year_start = 2019),
   'gross_estate', 'Total gross estate', 'Sum of all estate assets at fair market value', '1', 'Part 2 - Tax Computation', 'numeric', 'usd', true, true, 10),
  ((select id from tax_form_registry where form_code = '706' and tax_year_start = 2019),
   'schedule_a_real_estate', 'Real estate', 'Value of real estate owned at death (Schedule A)', '1a', 'Part 2 - Tax Computation', 'numeric', 'usd', false, false, 11),
  ((select id from tax_form_registry where form_code = '706' and tax_year_start = 2019),
   'schedule_b_stocks_bonds', 'Stocks and bonds', 'Value of stocks and bonds (Schedule B)', '1b', 'Part 2 - Tax Computation', 'numeric', 'usd', false, false, 12),
  ((select id from tax_form_registry where form_code = '706' and tax_year_start = 2019),
   'schedule_c_mortgages_notes', 'Mortgages, notes, and cash', 'Mortgages, notes receivable, and cash (Schedule C)', '1c', 'Part 2 - Tax Computation', 'numeric', 'usd', false, false, 13),
  ((select id from tax_form_registry where form_code = '706' and tax_year_start = 2019),
   'schedule_d_insurance', 'Insurance on decedent life', 'Life insurance proceeds (Schedule D)', '1d', 'Part 2 - Tax Computation', 'numeric', 'usd', false, false, 14),
  ((select id from tax_form_registry where form_code = '706' and tax_year_start = 2019),
   'schedule_e_joint_interests', 'Jointly owned property', 'Value of jointly owned property (Schedule E)', '1e', 'Part 2 - Tax Computation', 'numeric', 'usd', false, false, 15),
  ((select id from tax_form_registry where form_code = '706' and tax_year_start = 2019),
   'schedule_f_other_misc', 'Other miscellaneous property', 'Other property not listed elsewhere (Schedule F)', '1f', 'Part 2 - Tax Computation', 'numeric', 'usd', false, false, 16),
  ((select id from tax_form_registry where form_code = '706' and tax_year_start = 2019),
   'schedule_g_transfers', 'Transfers during life', 'Lifetime transfers includable in estate (Schedule G)', '1g', 'Part 2 - Tax Computation', 'numeric', 'usd', false, false, 17),
  ((select id from tax_form_registry where form_code = '706' and tax_year_start = 2019),
   'schedule_h_powers', 'Powers of appointment', 'Property over which decedent had power (Schedule H)', '1h', 'Part 2 - Tax Computation', 'numeric', 'usd', false, false, 18),
  ((select id from tax_form_registry where form_code = '706' and tax_year_start = 2019),
   'schedule_i_annuities', 'Annuities', 'Annuity values includable in estate (Schedule I)', '1i', 'Part 2 - Tax Computation', 'numeric', 'usd', false, false, 19),

  -- Deductions
  ((select id from tax_form_registry where form_code = '706' and tax_year_start = 2019),
   'total_deductions', 'Total allowable deductions', 'Funeral expenses, debts, admin expenses, charitable, marital', '2', 'Part 2 - Tax Computation', 'numeric', 'usd', true, true, 20),
  ((select id from tax_form_registry where form_code = '706' and tax_year_start = 2019),
   'funeral_expenses', 'Funeral expenses', 'Funeral and burial costs (Schedule J)', null, 'Deductions', 'numeric', 'usd', false, false, 21),
  ((select id from tax_form_registry where form_code = '706' and tax_year_start = 2019),
   'debts_of_decedent', 'Debts of the decedent', 'Outstanding debts at time of death (Schedule K)', null, 'Deductions', 'numeric', 'usd', false, false, 22),
  ((select id from tax_form_registry where form_code = '706' and tax_year_start = 2019),
   'admin_expenses', 'Administration expenses', 'Attorney fees, executor fees, appraisal costs', null, 'Deductions', 'numeric', 'usd', false, false, 23),
  ((select id from tax_form_registry where form_code = '706' and tax_year_start = 2019),
   'marital_deduction', 'Marital deduction', 'Property passing to surviving spouse (Schedule M)', null, 'Deductions', 'numeric', 'usd', false, false, 24),
  ((select id from tax_form_registry where form_code = '706' and tax_year_start = 2019),
   'charitable_deduction', 'Charitable deduction', 'Property passing to qualified charities (Schedule O)', null, 'Deductions', 'numeric', 'usd', false, false, 25),

  -- Tax computation
  ((select id from tax_form_registry where form_code = '706' and tax_year_start = 2019),
   'taxable_estate', 'Taxable estate', 'Gross estate minus deductions', '3', 'Part 2 - Tax Computation', 'numeric', 'usd', true, true, 30),
  ((select id from tax_form_registry where form_code = '706' and tax_year_start = 2019),
   'adjusted_taxable_gifts', 'Adjusted taxable gifts', 'Post-1976 taxable gifts not included in gross estate', '4', 'Part 2 - Tax Computation', 'numeric', 'usd', false, false, 31),
  ((select id from tax_form_registry where form_code = '706' and tax_year_start = 2019),
   'tentative_tax', 'Tentative tax', 'Tax on combined taxable estate and adjusted taxable gifts', '7', 'Part 2 - Tax Computation', 'numeric', 'usd', true, false, 34),
  ((select id from tax_form_registry where form_code = '706' and tax_year_start = 2019),
   'applicable_credit', 'Applicable credit amount (unified credit)', 'Basic exclusion amount credit ($12.92M for 2023)', '9a', 'Part 2 - Tax Computation', 'numeric', 'usd', false, false, 36),
  ((select id from tax_form_registry where form_code = '706' and tax_year_start = 2019),
   'portability_credit', 'DSUE amount from predeceased spouse', 'Deceased spousal unused exclusion amount', '9b', 'Part 2 - Tax Computation', 'numeric', 'usd', false, false, 37),
  ((select id from tax_form_registry where form_code = '706' and tax_year_start = 2019),
   'net_estate_tax', 'Net estate tax', 'Estate tax after all credits', '12', 'Part 2 - Tax Computation', 'numeric', 'usd', true, true, 40),
  ((select id from tax_form_registry where form_code = '706' and tax_year_start = 2019),
   'gstt', 'Generation-skipping transfer tax', 'GSTT from Schedule R', '13', 'Part 2 - Tax Computation', 'numeric', 'usd', false, false, 41),
  ((select id from tax_form_registry where form_code = '706' and tax_year_start = 2019),
   'total_transfer_taxes', 'Total transfer taxes', 'Net estate tax + GSTT', '15', 'Part 2 - Tax Computation', 'numeric', 'usd', true, true, 43),
  ((select id from tax_form_registry where form_code = '706' and tax_year_start = 2019),
   'prior_payments', 'Prior payments and credits', 'Previously paid taxes and credits', '16', 'Part 2 - Tax Computation', 'numeric', 'usd', false, false, 44),
  ((select id from tax_form_registry where form_code = '706' and tax_year_start = 2019),
   'balance_due', 'Balance due', 'Net amount owed', '18', 'Part 2 - Tax Computation', 'numeric', 'usd', true, false, 46)
on conflict (form_registry_id, field_key) do nothing;

-- ============================================================================
-- SEED: Field Registry — Form 709 (Gift Tax) — EAV only
-- ============================================================================

insert into tax_field_registry (form_registry_id, field_key, label, description, irs_line_number, irs_form_part, data_type, unit, is_computed, is_summary, sort_order) values
  -- Part 1: General Information
  ((select id from tax_form_registry where form_code = '709' and tax_year_start = 2019),
   'donor_name', 'Donor name', 'Name of person making the gift', null, 'Part 1', 'text', 'text', false, false, 1),
  ((select id from tax_form_registry where form_code = '709' and tax_year_start = 2019),
   'donor_ssn', 'Donor SSN', 'Social security number of donor', null, 'Part 1', 'text', 'text', false, false, 2),
  ((select id from tax_form_registry where form_code = '709' and tax_year_start = 2019),
   'consented_spouse', 'Consenting spouse name', 'Spouse who consents to gift-splitting', null, 'Part 1', 'text', 'text', false, false, 3),
  ((select id from tax_form_registry where form_code = '709' and tax_year_start = 2019),
   'gift_splitting_elected', 'Gift splitting elected', 'Whether gift splitting under Section 2513 is elected', null, 'Part 1', 'boolean', 'boolean', false, false, 4),

  -- Part 2: Tax Computation
  ((select id from tax_form_registry where form_code = '709' and tax_year_start = 2019),
   'total_gifts_current_period', 'Total gifts for current period', 'Total value of all gifts made during the tax year', '1', 'Part 2 - Tax Computation', 'numeric', 'usd', true, true, 10),
  ((select id from tax_form_registry where form_code = '709' and tax_year_start = 2019),
   'annual_exclusions', 'Annual exclusions', 'Annual gift tax exclusion amounts ($17K per donee for 2023)', '2', 'Part 2 - Tax Computation', 'numeric', 'usd', true, false, 11),
  ((select id from tax_form_registry where form_code = '709' and tax_year_start = 2019),
   'marital_deduction', 'Marital deduction', 'Gifts to spouse qualifying for unlimited marital deduction', '4', 'Part 2 - Tax Computation', 'numeric', 'usd', false, false, 12),
  ((select id from tax_form_registry where form_code = '709' and tax_year_start = 2019),
   'charitable_deduction', 'Charitable deduction', 'Gifts to qualified charities', '5', 'Part 2 - Tax Computation', 'numeric', 'usd', false, false, 13),
  ((select id from tax_form_registry where form_code = '709' and tax_year_start = 2019),
   'total_deductions', 'Total deductions', 'Sum of exclusions, marital, and charitable deductions', '7', 'Part 2 - Tax Computation', 'numeric', 'usd', true, true, 14),
  ((select id from tax_form_registry where form_code = '709' and tax_year_start = 2019),
   'taxable_gifts_current', 'Taxable gifts for current period', 'Total gifts minus deductions for current year', '8', 'Part 2 - Tax Computation', 'numeric', 'usd', true, true, 15),
  ((select id from tax_form_registry where form_code = '709' and tax_year_start = 2019),
   'taxable_gifts_prior', 'Taxable gifts from prior periods', 'Cumulative taxable gifts from all prior years', '9', 'Part 2 - Tax Computation', 'numeric', 'usd', false, false, 16),
  ((select id from tax_form_registry where form_code = '709' and tax_year_start = 2019),
   'total_taxable_gifts', 'Total taxable gifts', 'Current + prior period taxable gifts', '10', 'Part 2 - Tax Computation', 'numeric', 'usd', true, true, 17),
  ((select id from tax_form_registry where form_code = '709' and tax_year_start = 2019),
   'tentative_tax_total', 'Tax on total taxable gifts', 'Tentative tax computed on all cumulative gifts', '11', 'Part 2 - Tax Computation', 'numeric', 'usd', true, false, 18),
  ((select id from tax_form_registry where form_code = '709' and tax_year_start = 2019),
   'tentative_tax_prior', 'Tax on prior period gifts', 'Tax that would have been due on prior gifts alone', '12', 'Part 2 - Tax Computation', 'numeric', 'usd', true, false, 19),
  ((select id from tax_form_registry where form_code = '709' and tax_year_start = 2019),
   'tentative_tax_current', 'Tentative tax on current gifts', 'Incremental tax due to current year gifts', '13', 'Part 2 - Tax Computation', 'numeric', 'usd', true, false, 20),
  ((select id from tax_form_registry where form_code = '709' and tax_year_start = 2019),
   'applicable_credit', 'Applicable credit (unified credit)', 'Lifetime gift tax unified credit used', '15', 'Part 2 - Tax Computation', 'numeric', 'usd', false, false, 22),
  ((select id from tax_form_registry where form_code = '709' and tax_year_start = 2019),
   'credit_used_prior', 'Credit used in prior periods', 'Portion of unified credit already consumed', '16', 'Part 2 - Tax Computation', 'numeric', 'usd', false, false, 23),
  ((select id from tax_form_registry where form_code = '709' and tax_year_start = 2019),
   'remaining_credit', 'Credit remaining', 'Unified credit available for current gifts', '17', 'Part 2 - Tax Computation', 'numeric', 'usd', true, false, 24),
  ((select id from tax_form_registry where form_code = '709' and tax_year_start = 2019),
   'gift_tax_due', 'Gift tax due', 'Net gift tax payable after applying credit', '19', 'Part 2 - Tax Computation', 'numeric', 'usd', true, true, 26),

  -- Schedule A: Gifts detail
  ((select id from tax_form_registry where form_code = '709' and tax_year_start = 2019),
   'gift_donee_name', 'Donee name', 'Name of the person/entity receiving the gift', null, 'Schedule A', 'text', 'text', false, false, 30),
  ((select id from tax_form_registry where form_code = '709' and tax_year_start = 2019),
   'gift_description', 'Description of gift', 'What was given (cash, real estate, trust interest, etc.)', null, 'Schedule A', 'text', 'text', false, false, 31),
  ((select id from tax_form_registry where form_code = '709' and tax_year_start = 2019),
   'gift_value', 'Value of gift', 'Fair market value of the gift at date of transfer', null, 'Schedule A', 'numeric', 'usd', false, false, 32)
on conflict (form_registry_id, field_key) do nothing;

-- ============================================================================
-- SEED: Field Registry — CA-540 (California) — EAV only
-- ============================================================================

insert into tax_field_registry (form_registry_id, field_key, label, description, irs_line_number, irs_form_part, data_type, unit, is_computed, is_summary, sort_order) values
  ((select id from tax_form_registry where form_code = 'CA_540' and tax_year_start = 2019),
   'filing_status', 'Filing status', 'California filing status (same options as federal)', null, 'Filing Information', 'enum', 'text', false, false, 1),
  ((select id from tax_form_registry where form_code = 'CA_540' and tax_year_start = 2019),
   'federal_agi', 'Federal AGI', 'Adjusted gross income from federal Form 1040', '13', 'Income', 'numeric', 'usd', false, false, 10),
  ((select id from tax_form_registry where form_code = 'CA_540' and tax_year_start = 2019),
   'ca_additions', 'California additions to income', 'Income items taxed by CA but not federally', '14', 'Income', 'numeric', 'usd', false, false, 11),
  ((select id from tax_form_registry where form_code = 'CA_540' and tax_year_start = 2019),
   'ca_subtractions', 'California subtractions from income', 'Income items not taxed by CA (e.g. SS benefits)', '16', 'Income', 'numeric', 'usd', false, false, 12),
  ((select id from tax_form_registry where form_code = 'CA_540' and tax_year_start = 2019),
   'ca_agi', 'California adjusted gross income', 'Federal AGI + CA additions - CA subtractions', '17', 'Income', 'numeric', 'usd', true, true, 13),
  ((select id from tax_form_registry where form_code = 'CA_540' and tax_year_start = 2019),
   'ca_deduction', 'California deduction', 'California standard or itemized deduction', '18', 'Deductions', 'numeric', 'usd', false, false, 14),
  ((select id from tax_form_registry where form_code = 'CA_540' and tax_year_start = 2019),
   'ca_taxable_income', 'California taxable income', 'CA AGI minus deductions and exemptions', '19', 'Taxable Income', 'numeric', 'usd', true, true, 15),
  ((select id from tax_form_registry where form_code = 'CA_540' and tax_year_start = 2019),
   'ca_tax', 'California tax', 'Tax from California tax rate schedule', '31', 'Tax', 'numeric', 'usd', true, false, 20),
  ((select id from tax_form_registry where form_code = 'CA_540' and tax_year_start = 2019),
   'ca_exemption_credits', 'Exemption credits', 'Personal and dependent exemption credits', '32', 'Tax', 'numeric', 'usd', false, false, 21),
  ((select id from tax_form_registry where form_code = 'CA_540' and tax_year_start = 2019),
   'ca_mental_health_tax', 'Mental Health Services Tax', '1% surcharge on income over $1M', '62', 'Tax', 'numeric', 'usd', false, false, 25),
  ((select id from tax_form_registry where form_code = 'CA_540' and tax_year_start = 2019),
   'ca_total_tax', 'Total California tax', 'Total CA tax after all credits', '64', 'Tax', 'numeric', 'usd', true, true, 26),
  ((select id from tax_form_registry where form_code = 'CA_540' and tax_year_start = 2019),
   'ca_withholding', 'California tax withheld', 'State income tax withheld from W-2/1099', '71', 'Payments', 'numeric', 'usd', false, false, 30),
  ((select id from tax_form_registry where form_code = 'CA_540' and tax_year_start = 2019),
   'ca_estimated_payments', 'California estimated payments', 'Quarterly estimated CA tax payments', '72', 'Payments', 'numeric', 'usd', false, false, 31),
  ((select id from tax_form_registry where form_code = 'CA_540' and tax_year_start = 2019),
   'ca_total_payments', 'Total California payments', 'All CA tax payments and credits', '74', 'Payments', 'numeric', 'usd', true, true, 32),
  ((select id from tax_form_registry where form_code = 'CA_540' and tax_year_start = 2019),
   'ca_amount_owed', 'Amount owed to California', 'CA tax minus CA payments (if positive)', '91', 'Amount Owed', 'numeric', 'usd', true, false, 40),
  ((select id from tax_form_registry where form_code = 'CA_540' and tax_year_start = 2019),
   'ca_overpayment', 'California overpayment', 'CA payments minus CA tax (if positive)', '93', 'Refund', 'numeric', 'usd', true, false, 41),
  ((select id from tax_form_registry where form_code = 'CA_540' and tax_year_start = 2019),
   'ca_refund', 'California refund', 'Amount to be refunded from CA', '95', 'Refund', 'numeric', 'usd', false, false, 42)
on conflict (form_registry_id, field_key) do nothing;

-- ============================================================================
-- SEED: Field Registry — Form 1065 (Partnership) — EAV stubs
-- ============================================================================

insert into tax_field_registry (form_registry_id, field_key, label, description, irs_line_number, irs_form_part, data_type, unit, is_computed, is_summary, sort_order) values
  ((select id from tax_form_registry where form_code = '1065' and tax_year_start = 2019),
   'gross_receipts', 'Gross receipts or sales', 'Total gross receipts or sales', '1a', 'Income', 'numeric', 'usd', false, false, 1),
  ((select id from tax_form_registry where form_code = '1065' and tax_year_start = 2019),
   'cost_of_goods_sold', 'Cost of goods sold', 'From Schedule A', '2', 'Income', 'numeric', 'usd', false, false, 2),
  ((select id from tax_form_registry where form_code = '1065' and tax_year_start = 2019),
   'gross_profit', 'Gross profit', 'Gross receipts minus COGS', '3', 'Income', 'numeric', 'usd', true, false, 3),
  ((select id from tax_form_registry where form_code = '1065' and tax_year_start = 2019),
   'ordinary_business_income', 'Ordinary business income', 'Net trade or business income', '4', 'Income', 'numeric', 'usd', false, false, 4),
  ((select id from tax_form_registry where form_code = '1065' and tax_year_start = 2019),
   'net_rental_income', 'Net rental real estate income', 'From Form 8825', '5', 'Income', 'numeric', 'usd', false, false, 5),
  ((select id from tax_form_registry where form_code = '1065' and tax_year_start = 2019),
   'total_income', 'Total income (loss)', 'Sum of all partnership income', '8', 'Income', 'numeric', 'usd', true, true, 8),
  ((select id from tax_form_registry where form_code = '1065' and tax_year_start = 2019),
   'total_deductions', 'Total deductions', 'Sum of all partnership deductions', '21', 'Deductions', 'numeric', 'usd', true, true, 21),
  ((select id from tax_form_registry where form_code = '1065' and tax_year_start = 2019),
   'ordinary_income_loss', 'Ordinary business income (loss)', 'Net income/loss flowing to partners via K-1', '22', 'Income/Loss', 'numeric', 'usd', true, true, 22),
  ((select id from tax_form_registry where form_code = '1065' and tax_year_start = 2019),
   'guaranteed_payments', 'Guaranteed payments to partners', 'Payments for services or use of capital', null, 'Schedule K', 'numeric', 'usd', false, false, 30),
  ((select id from tax_form_registry where form_code = '1065' and tax_year_start = 2019),
   'net_rental_income_k', 'Net rental real estate income (loss)', 'Schedule K rental income', null, 'Schedule K', 'numeric', 'usd', false, false, 31),
  ((select id from tax_form_registry where form_code = '1065' and tax_year_start = 2019),
   'interest_income_k', 'Interest income', 'Schedule K interest', null, 'Schedule K', 'numeric', 'usd', false, false, 32),
  ((select id from tax_form_registry where form_code = '1065' and tax_year_start = 2019),
   'dividends_k', 'Ordinary dividends', 'Schedule K dividends', null, 'Schedule K', 'numeric', 'usd', false, false, 33),
  ((select id from tax_form_registry where form_code = '1065' and tax_year_start = 2019),
   'net_st_capital_gain_k', 'Net short-term capital gain (loss)', 'Schedule K ST capital gain', null, 'Schedule K', 'numeric', 'usd', false, false, 34),
  ((select id from tax_form_registry where form_code = '1065' and tax_year_start = 2019),
   'net_lt_capital_gain_k', 'Net long-term capital gain (loss)', 'Schedule K LT capital gain', null, 'Schedule K', 'numeric', 'usd', false, false, 35),
  ((select id from tax_form_registry where form_code = '1065' and tax_year_start = 2019),
   'section_179_deduction_k', 'Section 179 deduction', 'Schedule K Section 179 expense', null, 'Schedule K', 'numeric', 'usd', false, false, 36)
on conflict (form_registry_id, field_key) do nothing;

-- ============================================================================
-- SEED: Field Registry — Form 1120S (S Corp) — EAV stubs
-- ============================================================================

insert into tax_field_registry (form_registry_id, field_key, label, description, irs_line_number, irs_form_part, data_type, unit, is_computed, is_summary, sort_order) values
  ((select id from tax_form_registry where form_code = '1120S' and tax_year_start = 2019),
   'gross_receipts', 'Gross receipts or sales', 'Total gross receipts or sales', '1a', 'Income', 'numeric', 'usd', false, false, 1),
  ((select id from tax_form_registry where form_code = '1120S' and tax_year_start = 2019),
   'cost_of_goods_sold', 'Cost of goods sold', 'From Schedule A', '2', 'Income', 'numeric', 'usd', false, false, 2),
  ((select id from tax_form_registry where form_code = '1120S' and tax_year_start = 2019),
   'gross_profit', 'Gross profit', 'Gross receipts minus COGS', '3', 'Income', 'numeric', 'usd', true, false, 3),
  ((select id from tax_form_registry where form_code = '1120S' and tax_year_start = 2019),
   'net_rental_income', 'Net rental real estate income', 'From Form 8825', '4', 'Income', 'numeric', 'usd', false, false, 4),
  ((select id from tax_form_registry where form_code = '1120S' and tax_year_start = 2019),
   'total_income', 'Total income (loss)', 'Sum of all S corp income', '6', 'Income', 'numeric', 'usd', true, true, 6),
  ((select id from tax_form_registry where form_code = '1120S' and tax_year_start = 2019),
   'compensation_officers', 'Compensation of officers', 'Salaries paid to officer-shareholders', '7', 'Deductions', 'numeric', 'usd', false, false, 7),
  ((select id from tax_form_registry where form_code = '1120S' and tax_year_start = 2019),
   'salaries_wages', 'Salaries and wages', 'Non-officer employee salaries', '8', 'Deductions', 'numeric', 'usd', false, false, 8),
  ((select id from tax_form_registry where form_code = '1120S' and tax_year_start = 2019),
   'total_deductions', 'Total deductions', 'Sum of all S corp deductions', '20', 'Deductions', 'numeric', 'usd', true, true, 20),
  ((select id from tax_form_registry where form_code = '1120S' and tax_year_start = 2019),
   'ordinary_income_loss', 'Ordinary business income (loss)', 'Net income/loss flowing to shareholders via K-1', '21', 'Income/Loss', 'numeric', 'usd', true, true, 21),
  ((select id from tax_form_registry where form_code = '1120S' and tax_year_start = 2019),
   'net_rental_income_k', 'Net rental real estate income (loss)', 'Schedule K rental income', null, 'Schedule K', 'numeric', 'usd', false, false, 30),
  ((select id from tax_form_registry where form_code = '1120S' and tax_year_start = 2019),
   'interest_income_k', 'Interest income', 'Schedule K interest', null, 'Schedule K', 'numeric', 'usd', false, false, 31),
  ((select id from tax_form_registry where form_code = '1120S' and tax_year_start = 2019),
   'dividends_k', 'Ordinary dividends', 'Schedule K dividends', null, 'Schedule K', 'numeric', 'usd', false, false, 32),
  ((select id from tax_form_registry where form_code = '1120S' and tax_year_start = 2019),
   'net_st_capital_gain_k', 'Net short-term capital gain (loss)', 'Schedule K ST capital gain', null, 'Schedule K', 'numeric', 'usd', false, false, 33),
  ((select id from tax_form_registry where form_code = '1120S' and tax_year_start = 2019),
   'net_lt_capital_gain_k', 'Net long-term capital gain (loss)', 'Schedule K LT capital gain', null, 'Schedule K', 'numeric', 'usd', false, false, 34),
  ((select id from tax_form_registry where form_code = '1120S' and tax_year_start = 2019),
   'section_179_deduction_k', 'Section 179 deduction', 'Schedule K Section 179 expense', null, 'Schedule K', 'numeric', 'usd', false, false, 35)
on conflict (form_registry_id, field_key) do nothing;

-- ============================================================================
-- VIEW: tax_form_field_catalog — LLM discovery of all available forms and fields
-- ============================================================================

create or replace view tax_form_field_catalog as
select
  fr.form_code,
  fr.form_name,
  fr.form_category,
  fr.tax_year_start,
  fr.tax_year_end,
  fr.has_typed_table,
  fr.typed_table_name,
  fld.field_key,
  fld.label,
  fld.description,
  fld.irs_line_number,
  fld.irs_form_part,
  fld.data_type,
  fld.unit,
  fld.typed_table_column,
  fld.is_computed,
  fld.is_summary,
  fld.is_repeating,
  fld.computation_rule,
  fld.sort_order
from tax_form_registry fr
join tax_field_registry fld on fld.form_registry_id = fr.id
order by fr.form_code, fld.sort_order;

comment on view tax_form_field_catalog is
  'AI discovery view: browse all registered tax forms and their fields with full metadata. '
  'Use this to understand what data is available before querying. '
  'Example: SELECT * FROM tax_form_field_catalog WHERE form_code = ''706'' to see all estate tax fields.';

-- ============================================================================
-- VIEW: tax_all_fields — Unifying view merging typed tables + EAV
-- Maps typed table columns through the registry for a single query surface
-- ============================================================================

create or replace view tax_all_fields as

-- ---- Form 1040 typed table ----
select
  r.id as return_id,
  r.entity_id,
  r.tax_year,
  r.return_type,
  e.display_name as entity_name,
  fr.form_code,
  fr.form_name,
  fld.field_key,
  fld.label,
  fld.description,
  fld.irs_line_number,
  fld.irs_form_part,
  fld.data_type,
  fld.unit,
  fld.is_summary,
  case fld.typed_table_column
    when 'line_1a_w2_wages' then f.line_1a_w2_wages
    when 'line_1b_household_employee_wages' then f.line_1b_household_employee_wages
    when 'line_1c_tip_income' then f.line_1c_tip_income
    when 'line_1d_medicaid_waiver' then f.line_1d_medicaid_waiver
    when 'line_1e_dependent_care' then f.line_1e_dependent_care
    when 'line_1f_adoption_benefits' then f.line_1f_adoption_benefits
    when 'line_1g_form_8919_wages' then f.line_1g_form_8919_wages
    when 'line_1h_other_earned_income' then f.line_1h_other_earned_income
    when 'line_1i_nontaxable_combat_pay' then f.line_1i_nontaxable_combat_pay
    when 'line_1z_total_w2_income' then f.line_1z_total_w2_income
    when 'line_2a_tax_exempt_interest' then f.line_2a_tax_exempt_interest
    when 'line_2b_taxable_interest' then f.line_2b_taxable_interest
    when 'line_3a_qualified_dividends' then f.line_3a_qualified_dividends
    when 'line_3b_ordinary_dividends' then f.line_3b_ordinary_dividends
    when 'line_4a_ira_distributions' then f.line_4a_ira_distributions
    when 'line_4b_ira_taxable' then f.line_4b_ira_taxable
    when 'line_5a_pensions_annuities' then f.line_5a_pensions_annuities
    when 'line_5b_pensions_taxable' then f.line_5b_pensions_taxable
    when 'line_6a_social_security' then f.line_6a_social_security
    when 'line_6b_social_security_taxable' then f.line_6b_social_security_taxable
    when 'line_7_capital_gain_loss' then f.line_7_capital_gain_loss
    when 'line_8_schedule1_additional_income' then f.line_8_schedule1_additional_income
    when 'line_9_total_income' then f.line_9_total_income
    when 'line_10_schedule1_adjustments' then f.line_10_schedule1_adjustments
    when 'line_11_adjusted_gross_income' then f.line_11_adjusted_gross_income
    when 'line_12_standard_or_itemized_deduction' then f.line_12_standard_or_itemized_deduction
    when 'line_13_qbi_deduction' then f.line_13_qbi_deduction
    when 'line_14_total_deductions' then f.line_14_total_deductions
    when 'line_15_taxable_income' then f.line_15_taxable_income
    when 'line_16_tax' then f.line_16_tax
    when 'line_17_schedule2_amount' then f.line_17_schedule2_amount
    when 'line_19_child_tax_credit' then f.line_19_child_tax_credit
    when 'line_24_total_tax' then f.line_24_total_tax
    when 'line_25a_w2_withholding' then f.line_25a_w2_withholding
    when 'line_25b_1099_withholding' then f.line_25b_1099_withholding
    when 'line_25d_total_withholding' then f.line_25d_total_withholding
    when 'line_26_estimated_payments' then f.line_26_estimated_payments
    when 'line_27_eic' then f.line_27_eic
    when 'line_33_total_payments' then f.line_33_total_payments
    when 'line_34_overpaid' then f.line_34_overpaid
    when 'line_35a_refund' then f.line_35a_refund
    when 'line_37_amount_owed' then f.line_37_amount_owed
    when 'line_38_estimated_tax_penalty' then f.line_38_estimated_tax_penalty
  end as value_numeric,
  case fld.typed_table_column
    when 'filing_status' then f.filing_status
  end as value_text,
  case fld.typed_table_column
    when 'digital_assets_activity' then f.digital_assets_activity
  end as value_boolean,
  0 as group_index,
  'typed_table' as source
from tax_form_1040 f
join tax_returns r on r.id = f.return_id
join tax_entities e on e.id = r.entity_id
join tax_form_registry fr on fr.form_code = '1040'
  and f.tax_year between fr.tax_year_start and coalesce(fr.tax_year_end, 2099)
join tax_field_registry fld on fld.form_registry_id = fr.id
  and fld.typed_table_column is not null
where fld.data_type in ('numeric', 'enum', 'boolean')

union all

-- ---- Form 1041 typed table ----
select
  r.id as return_id,
  r.entity_id,
  r.tax_year,
  r.return_type,
  e.display_name as entity_name,
  fr.form_code,
  fr.form_name,
  fld.field_key,
  fld.label,
  fld.description,
  fld.irs_line_number,
  fld.irs_form_part,
  fld.data_type,
  fld.unit,
  fld.is_summary,
  case fld.typed_table_column
    when 'line_1_interest_income' then f.line_1_interest_income
    when 'line_2a_ordinary_dividends' then f.line_2a_ordinary_dividends
    when 'line_2b_qualified_dividends' then f.line_2b_qualified_dividends
    when 'line_3_business_income' then f.line_3_business_income
    when 'line_4_capital_gain_loss' then f.line_4_capital_gain_loss
    when 'line_5_rents_royalties' then f.line_5_rents_royalties
    when 'line_8_other_income' then f.line_8_other_income
    when 'line_9_total_income' then f.line_9_total_income
    when 'line_12_fiduciary_fees' then f.line_12_fiduciary_fees
    when 'line_13_charitable_deduction' then f.line_13_charitable_deduction
    when 'line_18_income_distribution_deduction' then f.line_18_income_distribution_deduction
    when 'line_20_qbi_deduction' then f.line_20_qbi_deduction
    when 'line_23_taxable_income' then f.line_23_taxable_income
    when 'line_24_total_tax' then f.line_24_total_tax
    when 'line_26_total_payments' then f.line_26_total_payments
    when 'line_28_tax_due' then f.line_28_tax_due
    when 'line_29_overpayment' then f.line_29_overpayment
  end as value_numeric,
  null::text as value_text,
  null::boolean as value_boolean,
  0 as group_index,
  'typed_table' as source
from tax_form_1041 f
join tax_returns r on r.id = f.return_id
join tax_entities e on e.id = r.entity_id
join tax_form_registry fr on fr.form_code = '1041'
  and f.tax_year between fr.tax_year_start and coalesce(fr.tax_year_end, 2099)
join tax_field_registry fld on fld.form_registry_id = fr.id
  and fld.typed_table_column is not null

union all

-- ---- EAV: tax_return_line_items with registry FK ----
select
  r.id as return_id,
  r.entity_id,
  r.tax_year,
  r.return_type,
  e.display_name as entity_name,
  fr.form_code,
  fr.form_name,
  fld.field_key,
  fld.label,
  coalesce(fld.description, li.line_description) as description,
  coalesce(fld.irs_line_number, li.line_number) as irs_line_number,
  coalesce(fld.irs_form_part, li.form_part) as irs_form_part,
  coalesce(fld.data_type, 'numeric') as data_type,
  coalesce(fld.unit, 'usd') as unit,
  coalesce(fld.is_summary, false) as is_summary,
  li.amount as value_numeric,
  li.text_value as value_text,
  li.checkbox_value as value_boolean,
  0 as group_index,
  'eav' as source
from tax_return_line_items li
join tax_returns r on r.id = li.return_id
join tax_entities e on e.id = r.entity_id
left join tax_field_registry fld on fld.id = li.field_registry_id
left join tax_form_registry fr on fr.id = fld.form_registry_id

union all

-- ---- EAV: tax_return_line_items WITHOUT registry FK (legacy/inline) ----
select
  r.id as return_id,
  r.entity_id,
  r.tax_year,
  r.return_type,
  e.display_name as entity_name,
  li.form_name as form_code,
  li.form_name as form_name,
  li.line_number as field_key,
  li.line_description as label,
  li.line_description as description,
  li.line_number as irs_line_number,
  li.form_part as irs_form_part,
  case when li.is_checkbox then 'boolean'
       when li.text_value is not null then 'text'
       else 'numeric'
  end as data_type,
  'usd' as unit,
  false as is_summary,
  li.amount as value_numeric,
  li.text_value as value_text,
  li.checkbox_value as value_boolean,
  0 as group_index,
  'legacy_eav' as source
from tax_return_line_items li
join tax_returns r on r.id = li.return_id
join tax_entities e on e.id = r.entity_id
where li.field_registry_id is null;

comment on view tax_all_fields is
  'Unified view of ALL tax data across typed tables and EAV storage. '
  'Single query surface for AI analysis — no need to know which storage path a form uses. '
  'source column indicates data origin: typed_table, eav (registry-backed), or legacy_eav (inline). '
  'Example: SELECT * FROM tax_all_fields WHERE entity_name = ''Rahul Sonnad'' AND tax_year = 2023 ORDER BY form_code, irs_line_number';
