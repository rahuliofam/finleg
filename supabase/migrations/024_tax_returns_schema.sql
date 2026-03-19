-- Migration 024: Tax Returns Schema
-- Comprehensive schema for storing IRS tax return data across all form types.
-- Designed for AI analysis with rich metadata, LLM-friendly naming, and full lineage tracking.
--
-- Covers: Form 1040 (individual), Form 1041 (trusts/estates), all schedules (1, 2, 3, A-SE),
-- Forms 8949, 4562, 8962, 8995, K-1, and supporting worksheets.
--
-- Architecture:
--   tax_entities          → Who filed (person or trust)
--   tax_returns           → One row per filed return (the PDF/document)
--   tax_return_documents  → Links to source PDFs in document_index/R2
--   tax_form_*            → Structured data per IRS form, keyed to the return
--   tax_return_line_items → Catch-all for any form line not in a typed table

-- ============================================================================
-- ENTITY & RETURN ENVELOPE
-- ============================================================================

create table if not exists tax_entities (
  id uuid primary key default gen_random_uuid(),
  -- Human-readable label an LLM can reference: "Rahul Sonnad" or "Subhash Sonnad Rvoc Tr"
  display_name text not null,
  -- Discriminator: 'individual', 'trust', 'estate', 'partnership', 'corporation'
  entity_type text not null check (entity_type in (
    'individual', 'trust', 'estate', 'partnership', 'corporation'
  )),
  -- Tax ID (SSN or EIN) — stored hashed; display last-4 only in UI
  tax_id_last4 text,
  tax_id_hash text,
  -- For trusts/estates
  trust_name text,
  trust_ein text,
  trust_type text, -- 'simple', 'complex', 'grantor', 'qualified_disability', 'esbt_s_portion'
  date_entity_created date, -- e.g. trust creation date
  fiduciary_name text,
  fiduciary_title text,
  -- For individuals
  first_name text,
  middle_initial text,
  last_name text,
  date_of_birth date,
  -- Address (at time of most recent return)
  address_street text,
  address_city text,
  address_state text,
  address_zip text,
  -- Relationships
  -- e.g. Rahul is trustee of the Subhash Sonnad trust
  -- Modeled via tax_entity_relationships table below
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

comment on table tax_entities is
  'A person, trust, estate, or other entity that files tax returns. '
  'entity_type discriminates the kind of filer. '
  'For individuals: first_name/last_name. For trusts: trust_name/trust_ein.';

create table if not exists tax_entity_relationships (
  id uuid primary key default gen_random_uuid(),
  -- The entity in the relationship (e.g. the trust)
  entity_id uuid not null references tax_entities(id),
  -- The related entity (e.g. the individual trustee/beneficiary)
  related_entity_id uuid not null references tax_entities(id),
  -- 'trustee', 'beneficiary', 'grantor', 'spouse', 'dependent', 'preparer'
  relationship_type text not null,
  -- Optional: effective date range
  effective_from date,
  effective_to date,
  notes text,
  created_at timestamptz default now()
);

comment on table tax_entity_relationships is
  'Links entities to each other with a labeled relationship type. '
  'Examples: Rahul is trustee_of the Subhash Sonnad Trust; Hannah is dependent_of Rahul.';

-- One row per filed tax return (the submission, not the form)
create table if not exists tax_returns (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references tax_entities(id),
  -- Tax year (calendar year the return covers)
  tax_year int not null check (tax_year >= 1900 and tax_year <= 2100),
  -- Which IRS master form: '1040', '1041', '1065', '1120', '1120S'
  return_type text not null check (return_type in (
    '1040', '1041', '1065', '1120', '1120S'
  )),
  -- Filing metadata
  filing_status text, -- 'single', 'married_filing_jointly', 'married_filing_separately', 'head_of_household', 'qualifying_surviving_spouse'
  is_amended boolean default false,
  is_extended boolean default false,
  extension_filed_date date,
  date_filed date,
  date_signed date,
  -- Preparer info
  preparer_name text,
  preparer_firm text,
  preparer_ptin text,
  preparer_firm_ein text,
  -- Top-level summary numbers (denormalized for quick queries)
  total_income numeric(15,2),
  adjusted_gross_income numeric(15,2),
  taxable_income numeric(15,2),
  total_tax numeric(15,2),
  total_payments numeric(15,2),
  amount_owed numeric(15,2),
  refund_amount numeric(15,2),
  -- Processing metadata
  extraction_status text default 'pending' check (extraction_status in (
    'pending', 'in_progress', 'extracted', 'verified', 'error'
  )),
  extraction_model text, -- Which AI model extracted the data
  extraction_confidence numeric(5,4), -- 0.0000 to 1.0000
  extraction_notes text,
  verified_by text,
  verified_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(entity_id, tax_year, return_type, is_amended)
);

comment on table tax_returns is
  'One row per filed tax return. The envelope that contains all form data. '
  'return_type indicates the master form (1040 for individuals, 1041 for trusts). '
  'Summary fields (total_income, AGI, etc.) are denormalized from the form tables for quick AI queries.';

-- Link returns to their source PDF documents
create table if not exists tax_return_documents (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references tax_returns(id),
  -- Optional link to existing document_index table
  document_index_id uuid references document_index(id),
  -- Direct file reference
  file_path text,
  storage_url text,
  file_name text,
  file_size_bytes bigint,
  page_count int,
  -- What forms are contained in this document
  forms_contained text[], -- e.g. ARRAY['1040', 'Schedule 1', 'Schedule C']
  notes text,
  created_at timestamptz default now()
);

comment on table tax_return_documents is
  'Links a tax_return to its source PDF file(s). A single return may span multiple documents. '
  'forms_contained lists which IRS forms appear in the document for targeted extraction.';

-- ============================================================================
-- FORM 1040 — U.S. Individual Income Tax Return
-- ============================================================================

create table if not exists tax_form_1040 (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references tax_returns(id) unique,
  tax_year int not null,

  -- Filing Status (line at top)
  filing_status text, -- 'single', 'mfj', 'mfs', 'hoh', 'qss'
  spouse_first_name text,
  spouse_last_name text,

  -- Digital Assets question
  digital_assets_activity boolean,

  -- Standard Deduction checkboxes
  claimed_as_dependent boolean default false,
  spouse_claimed_as_dependent boolean default false,
  spouse_itemizes_separately boolean default false,
  you_born_before_cutoff boolean default false,
  you_are_blind boolean default false,
  spouse_born_before_cutoff boolean default false,
  spouse_is_blind boolean default false,

  -- Income (lines 1-15)
  line_1a_w2_wages numeric(15,2),            -- W-2 box 1 wages
  line_1b_household_employee_wages numeric(15,2),
  line_1c_tip_income numeric(15,2),
  line_1d_medicaid_waiver numeric(15,2),
  line_1e_dependent_care numeric(15,2),
  line_1f_adoption_benefits numeric(15,2),
  line_1g_form_8919_wages numeric(15,2),
  line_1h_other_earned_income numeric(15,2),
  line_1i_nontaxable_combat_pay numeric(15,2),
  line_1z_total_w2_income numeric(15,2),
  line_2a_tax_exempt_interest numeric(15,2),
  line_2b_taxable_interest numeric(15,2),
  line_3a_qualified_dividends numeric(15,2),
  line_3b_ordinary_dividends numeric(15,2),
  line_4a_ira_distributions numeric(15,2),
  line_4b_ira_taxable numeric(15,2),
  line_5a_pensions_annuities numeric(15,2),
  line_5b_pensions_taxable numeric(15,2),
  line_6a_social_security numeric(15,2),
  line_6b_social_security_taxable numeric(15,2),
  line_6c_lump_sum_election boolean default false,
  line_7_capital_gain_loss numeric(15,2),
  line_8_schedule1_additional_income numeric(15,2),
  line_9_total_income numeric(15,2),
  line_10_schedule1_adjustments numeric(15,2),
  line_11_adjusted_gross_income numeric(15,2),
  line_12_standard_or_itemized_deduction numeric(15,2),
  line_13_qbi_deduction numeric(15,2),
  line_14_total_deductions numeric(15,2),
  line_15_taxable_income numeric(15,2),

  -- Tax and Credits (lines 16-24)
  line_16_tax numeric(15,2),
  line_16_form_references text, -- e.g. '8814, 4972'
  line_17_schedule2_amount numeric(15,2),
  line_18_total_line16_17 numeric(15,2),
  line_19_child_tax_credit numeric(15,2),
  line_20_schedule3_amount numeric(15,2),
  line_21_total_line19_20 numeric(15,2),
  line_22_subtracted_credits numeric(15,2),
  line_23_other_taxes numeric(15,2),
  line_24_total_tax numeric(15,2),

  -- Payments (lines 25-33)
  line_25a_w2_withholding numeric(15,2),
  line_25b_1099_withholding numeric(15,2),
  line_25c_other_withholding numeric(15,2),
  line_25d_total_withholding numeric(15,2),
  line_26_estimated_payments numeric(15,2),
  line_27_eic numeric(15,2),
  line_28_additional_child_credit numeric(15,2),
  line_29_american_opportunity_credit numeric(15,2),
  line_31_schedule3_line15 numeric(15,2),
  line_32_total_other_payments numeric(15,2),
  line_33_total_payments numeric(15,2),

  -- Refund / Amount Owed (lines 34-38)
  line_34_overpaid numeric(15,2),
  line_35a_refund numeric(15,2),
  line_36_applied_to_next_year numeric(15,2),
  line_37_amount_owed numeric(15,2),
  line_38_estimated_tax_penalty numeric(15,2),

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

comment on table tax_form_1040 is
  'Form 1040 — U.S. Individual Income Tax Return. One row per return. '
  'Line numbers match the IRS form exactly (e.g. line_7_capital_gain_loss = Schedule D result). '
  'All monetary values in USD. Negative values represent losses shown in parentheses on the form.';

-- ============================================================================
-- FORM 1040 DEPENDENTS
-- ============================================================================

create table if not exists tax_form_1040_dependents (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references tax_returns(id),
  first_name text not null,
  last_name text not null,
  ssn_last4 text,
  relationship text, -- 'son', 'daughter', 'parent', etc.
  qualifies_child_tax_credit boolean default false,
  qualifies_other_dependent_credit boolean default false,
  created_at timestamptz default now()
);

comment on table tax_form_1040_dependents is
  'Dependents listed on Form 1040. One row per dependent per return.';

-- ============================================================================
-- SCHEDULE 1 — Additional Income and Adjustments to Income
-- ============================================================================

create table if not exists tax_schedule_1 (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references tax_returns(id) unique,
  tax_year int not null,

  -- Part I: Additional Income (lines 1-10)
  line_1_taxable_refunds numeric(15,2),
  line_2a_alimony_received numeric(15,2),
  line_3_business_income_schedule_c numeric(15,2),
  line_4_other_gains numeric(15,2),
  line_5_rental_royalty_schedule_e numeric(15,2),
  line_6_farm_income numeric(15,2),
  line_7_unemployment numeric(15,2),
  -- Line 8 sub-items (other income)
  line_8a_net_operating_loss numeric(15,2),
  line_8b_gambling numeric(15,2),
  line_8c_debt_cancellation numeric(15,2),
  line_8d_foreign_earned_income_exclusion numeric(15,2),
  line_8e_form_8853 numeric(15,2),
  line_8f_form_8889 numeric(15,2),
  line_8z_other_income numeric(15,2),
  line_8z_other_description text,
  line_9_total_other_income numeric(15,2),
  line_10_total_additional_income numeric(15,2),

  -- Part II: Adjustments to Income (lines 11-26)
  line_11_educator_expenses numeric(15,2),
  line_12_business_expenses numeric(15,2),
  line_13_hsa_deduction numeric(15,2),
  line_14_moving_expenses numeric(15,2),
  line_15_se_tax_deduction numeric(15,2),
  line_16_sep_simple numeric(15,2),
  line_17_se_health_insurance numeric(15,2),
  line_18_early_withdrawal_penalty numeric(15,2),
  line_19a_alimony_paid numeric(15,2),
  line_20_ira_deduction numeric(15,2),
  line_21_student_loan_interest numeric(15,2),
  line_23_archer_msa numeric(15,2),
  line_24z_other_adjustments numeric(15,2),
  line_24z_other_description text,
  line_25_total_other_adjustments numeric(15,2),
  line_26_total_adjustments numeric(15,2),

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

comment on table tax_schedule_1 is
  'Schedule 1 (Form 1040) — Additional Income and Adjustments to Income. '
  'Part I covers non-W2 income (business, rental, capital gains, etc.). '
  'Part II covers above-the-line deductions (SE tax, IRA, HSA, etc.).';

-- ============================================================================
-- SCHEDULE 2 — Additional Taxes
-- ============================================================================

create table if not exists tax_schedule_2 (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references tax_returns(id) unique,
  tax_year int not null,

  -- Part I: Tax (lines 1-3)
  line_1_amt numeric(15,2),
  line_2_excess_ptc_repayment numeric(15,2),
  line_3_total numeric(15,2),

  -- Part II: Other Taxes (lines 4-21)
  line_4_se_tax numeric(15,2),
  line_7_additional_ss_medicare numeric(15,2),
  line_8_additional_tax_ira numeric(15,2),
  line_9_household_employment numeric(15,2),
  line_10_first_time_homebuyer numeric(15,2),
  line_11_additional_medicare numeric(15,2),
  line_12_net_investment_income_tax numeric(15,2),
  line_17z_other_additional_taxes numeric(15,2),
  line_18_total_additional numeric(15,2),
  line_21_total_other_taxes numeric(15,2),

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

comment on table tax_schedule_2 is
  'Schedule 2 (Form 1040) — Additional Taxes. '
  'Part I: AMT and excess PTC repayment. '
  'Part II: Self-employment tax, net investment income tax, and other additional taxes.';

-- ============================================================================
-- SCHEDULE C — Profit or Loss From Business
-- ============================================================================

create table if not exists tax_schedule_c (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references tax_returns(id),
  tax_year int not null,
  -- A return can have multiple Schedule Cs (multiple businesses)
  business_sequence int default 1, -- 1st, 2nd, etc. business on this return

  -- Business identity
  proprietor_name text,
  business_name text,
  principal_activity text,
  business_code text, -- NAICS code
  employer_id text,
  business_address_street text,
  business_address_city_state_zip text,
  accounting_method text, -- 'cash', 'accrual', 'other'
  materially_participated boolean,
  started_in_tax_year boolean,

  -- Part I: Income (lines 1-7)
  line_1_gross_receipts numeric(15,2),
  line_2_returns_allowances numeric(15,2),
  line_3_net_receipts numeric(15,2),
  line_4_cogs numeric(15,2),
  line_5_gross_profit numeric(15,2),
  line_6_other_income numeric(15,2),
  line_7_gross_income numeric(15,2),

  -- Part II: Expenses (lines 8-30)
  line_8_advertising numeric(15,2),
  line_9_car_truck numeric(15,2),
  line_10_commissions numeric(15,2),
  line_11_contract_labor numeric(15,2),
  line_12_depletion numeric(15,2),
  line_13_depreciation numeric(15,2),
  line_14_employee_benefits numeric(15,2),
  line_15_insurance numeric(15,2),
  line_16a_mortgage_interest numeric(15,2),
  line_16b_other_interest numeric(15,2),
  line_17_legal_professional numeric(15,2),
  line_18_office_expense numeric(15,2),
  line_19_pension_profit_sharing numeric(15,2),
  line_20_rent_lease numeric(15,2),
  line_20a_vehicles_equipment numeric(15,2),
  line_20b_other_business_property numeric(15,2),
  line_21_repairs numeric(15,2),
  line_22_supplies numeric(15,2),
  line_23_taxes_licenses numeric(15,2),
  line_24a_travel numeric(15,2),
  line_24b_meals numeric(15,2),
  line_25_utilities numeric(15,2),
  line_26_wages numeric(15,2),
  line_27a_other_expenses numeric(15,2),
  line_28_total_expenses numeric(15,2),
  line_29_tentative_profit_loss numeric(15,2),
  line_30_home_business_expense numeric(15,2),
  line_31_net_profit_loss numeric(15,2),

  -- Investment at risk
  all_investment_at_risk boolean,

  -- Part IV: Vehicle info
  vehicle_date_in_service date,
  vehicle_business_miles numeric(10,1),
  vehicle_commuting_miles numeric(10,1),
  vehicle_other_miles numeric(10,1),

  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(return_id, business_sequence)
);

comment on table tax_schedule_c is
  'Schedule C (Form 1040 or 1041) — Profit or Loss From Business (Sole Proprietorship). '
  'A return may have multiple Schedule Cs; use business_sequence to distinguish. '
  'business_name + principal_activity identify the business across years.';

-- Schedule C other expenses detail
create table if not exists tax_schedule_c_other_expenses (
  id uuid primary key default gen_random_uuid(),
  schedule_c_id uuid not null references tax_schedule_c(id),
  description text not null,
  amount numeric(15,2) not null,
  created_at timestamptz default now()
);

comment on table tax_schedule_c_other_expenses is
  'Part V of Schedule C — itemized other expenses not captured in lines 8-26.';

-- ============================================================================
-- SCHEDULE D — Capital Gains and Losses
-- ============================================================================

create table if not exists tax_schedule_d (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references tax_returns(id) unique,
  tax_year int not null,

  -- Part I: Short-Term (lines 1-7)
  line_1a_st_reported_no_adj numeric(15,2), -- 1099-B basis reported, no adjustments
  line_1b_st_form8949_box_a numeric(15,2),
  line_2_st_form8949_box_b numeric(15,2),
  line_3_st_form8949_box_c numeric(15,2),
  line_4_st_from_other_forms numeric(15,2),
  line_5_st_from_k1 numeric(15,2),
  line_6_st_carryover numeric(15,2),
  line_7_net_short_term numeric(15,2),

  -- Part II: Long-Term (lines 8-15)
  line_8a_lt_reported_no_adj numeric(15,2),
  line_8b_lt_form8949_box_d numeric(15,2),
  line_9_lt_form8949_box_e numeric(15,2),
  line_10_lt_form8949_box_f numeric(15,2),
  line_11_lt_from_other_forms numeric(15,2),
  line_12_lt_from_k1 numeric(15,2),
  line_13_lt_distributions numeric(15,2),
  line_14_lt_carryover numeric(15,2),
  line_15_net_long_term numeric(15,2),

  -- Part III: Summary (lines 16-22)
  line_16_combined numeric(15,2),
  line_21_loss_limitation numeric(15,2),

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

comment on table tax_schedule_d is
  'Schedule D (Form 1040 or 1041) — Capital Gains and Losses. '
  'Part I = short-term (held <= 1 year). Part II = long-term (held > 1 year). '
  'line_7 and line_15 are the net short/long-term results. line_16 is the combined total.';

-- ============================================================================
-- FORM 8949 — Sales and Other Dispositions of Capital Assets
-- ============================================================================

create table if not exists tax_form_8949_transactions (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references tax_returns(id),
  tax_year int not null,

  -- Which part/box on Form 8949
  -- 'short_term_A' = basis reported to IRS, 'short_term_B' = basis NOT reported, 'short_term_C' = not on 1099-B
  -- 'long_term_D', 'long_term_E', 'long_term_F' = same for long-term
  holding_period text not null check (holding_period in ('short_term', 'long_term')),
  basis_reporting_box text not null check (basis_reporting_box in ('A','B','C','D','E','F')),

  -- Transaction detail
  description text not null, -- e.g. "100 sh XYZ Corp" or "Long Term Charles Schwab Stock"
  date_acquired date,
  date_acquired_text text, -- If "VARIOUS" or other non-date text
  date_sold date,
  date_sold_text text,
  proceeds numeric(15,2),
  cost_basis numeric(15,2),
  adjustment_code text, -- Column (f) code
  adjustment_amount numeric(15,2), -- Column (g)
  gain_or_loss numeric(15,2), -- Column (h)

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

comment on table tax_form_8949_transactions is
  'Form 8949 — Individual capital asset sale transactions. '
  'holding_period: short_term (<= 1 yr) or long_term (> 1 yr). '
  'basis_reporting_box: A-F per Form 8949 instructions. '
  'These feed into Schedule D totals.';

-- ============================================================================
-- SCHEDULE E — Supplemental Income and Loss
-- ============================================================================

-- Part I: Rental Real Estate and Royalties
create table if not exists tax_schedule_e_rental_properties (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references tax_returns(id),
  tax_year int not null,
  property_label text not null, -- 'A', 'B', 'C' as on the form
  property_address text,
  property_type int, -- 1=SFR, 2=Multi, 3=Vacation, 4=Commercial, 5=Land, 6=Royalties, 7=Self-Rental, 8=Other
  property_type_description text,
  fair_rental_days int,
  personal_use_days int,
  is_qjv boolean default false, -- Qualified Joint Venture

  -- Income
  line_3_rents_received numeric(15,2),
  line_4_royalties_received numeric(15,2),

  -- Expenses
  line_5_advertising numeric(15,2),
  line_6_auto_travel numeric(15,2),
  line_7_cleaning_maintenance numeric(15,2),
  line_8_commissions numeric(15,2),
  line_9_insurance numeric(15,2),
  line_10_legal_professional numeric(15,2),
  line_11_management_fees numeric(15,2),
  line_12_mortgage_interest numeric(15,2),
  line_13_other_interest numeric(15,2),
  line_14_repairs numeric(15,2),
  line_15_supplies numeric(15,2),
  line_16_taxes numeric(15,2),
  line_17_utilities numeric(15,2),
  line_18_depreciation numeric(15,2),
  line_19_other numeric(15,2),
  line_19_other_description text,
  line_20_total_expenses numeric(15,2),
  line_21_net_income_loss numeric(15,2),
  line_22_deductible_loss numeric(15,2),

  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(return_id, property_label)
);

comment on table tax_schedule_e_rental_properties is
  'Schedule E Part I — Rental Real Estate and Royalties. '
  'One row per property (A, B, C) per return. '
  'property_type codes: 1=Single Family, 2=Multi-Family, 3=Vacation/Short-Term, '
  '4=Commercial, 5=Land, 6=Royalties, 7=Self-Rental, 8=Other.';

-- Part II: Partnerships and S Corps
create table if not exists tax_schedule_e_partnerships (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references tax_returns(id),
  tax_year int not null,
  entity_label text, -- 'A', 'B', 'C', 'D'
  entity_name text not null,
  is_partnership boolean, -- true = partnership, false = S corp
  is_foreign boolean default false,
  employer_id text,
  basis_computation_required boolean default false,
  amount_not_at_risk boolean default false,

  -- Passive Income and Loss
  passive_loss_allowed numeric(15,2),
  passive_income numeric(15,2),
  -- Nonpassive Income and Loss
  nonpassive_deduction_loss numeric(15,2),
  nonpassive_section_179 numeric(15,2),
  nonpassive_income numeric(15,2),

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

comment on table tax_schedule_e_partnerships is
  'Schedule E Part II — Income or Loss From Partnerships and S Corporations. '
  'Amounts flow from Schedule K-1 forms received from each entity.';

-- Part III: Estates and Trusts (from beneficiary perspective)
create table if not exists tax_schedule_e_estates_trusts (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references tax_returns(id),
  tax_year int not null,
  entity_label text, -- 'A', 'B'
  entity_name text not null,
  employer_id text,

  -- Passive
  passive_deduction_loss numeric(15,2),
  passive_income numeric(15,2),
  -- Nonpassive
  nonpassive_deduction_loss numeric(15,2),
  nonpassive_income numeric(15,2),

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

comment on table tax_schedule_e_estates_trusts is
  'Schedule E Part III — Income or Loss From Estates and Trusts (beneficiary side). '
  'Shows K-1 distributions received from trusts/estates.';

-- Schedule E Summary
create table if not exists tax_schedule_e_summary (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references tax_returns(id) unique,
  tax_year int not null,

  -- Part I totals
  line_23a_total_rents numeric(15,2),
  line_23b_total_royalties numeric(15,2),
  line_23c_total_mortgage_interest numeric(15,2),
  line_23d_total_depreciation numeric(15,2),
  line_23e_total_expenses numeric(15,2),
  line_24_income numeric(15,2),
  line_25_losses numeric(15,2),
  line_26_total_rental_royalty numeric(15,2),

  -- Part II-V totals
  line_32_partnership_scorp_total numeric(15,2),
  line_37_estate_trust_total numeric(15,2),
  line_39_remic_total numeric(15,2),
  line_40_farm_rental numeric(15,2),
  line_41_total_schedule_e numeric(15,2),

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

comment on table tax_schedule_e_summary is
  'Schedule E totals/summary lines. line_41 flows to Schedule 1, line 5.';

-- ============================================================================
-- SCHEDULE SE — Self-Employment Tax
-- ============================================================================

create table if not exists tax_schedule_se (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references tax_returns(id) unique,
  tax_year int not null,

  line_1a_farm_profit numeric(15,2),
  line_1b_social_security_reserve numeric(15,2),
  line_2_net_profit numeric(15,2), -- From Schedule C line 31
  line_3_combined numeric(15,2),
  line_4a_se_earnings numeric(15,2),
  line_6_se_earnings_total numeric(15,2),
  line_7_max_combined_wages numeric(15,2), -- SS wage base limit
  line_8a_total_ss_wages numeric(15,2),
  line_8d_total_wages numeric(15,2),
  line_9_subtract numeric(15,2),
  line_10_ss_tax numeric(15,2),
  line_11_medicare_tax numeric(15,2),
  line_12_se_tax numeric(15,2), -- Total SE tax → Schedule 2
  line_13_deduction_half_se numeric(15,2), -- → Schedule 1, line 15

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

comment on table tax_schedule_se is
  'Schedule SE — Self-Employment Tax. '
  'line_12 = total SE tax (flows to Schedule 2, line 4). '
  'line_13 = deductible half of SE tax (flows to Schedule 1, line 15).';

-- ============================================================================
-- FORM 4562 — Depreciation and Amortization
-- ============================================================================

create table if not exists tax_form_4562 (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references tax_returns(id),
  tax_year int not null,
  -- Which business/activity this depreciation relates to
  business_or_activity text, -- e.g. "East Lost Lake" or "Alpaca Farm"
  business_sequence int default 1,

  -- Part I: Section 179
  line_1_max_amount numeric(15,2),
  line_2_cost_placed_in_service numeric(15,2),
  line_8_total_elected_cost numeric(15,2),
  line_9_tentative_deduction numeric(15,2),
  line_12_section_179_expense numeric(15,2),

  -- Part II: Special Depreciation (Bonus)
  line_14_special_depreciation numeric(15,2),

  -- Part III: MACRS
  line_17_macrs_prior_years numeric(15,2),

  -- Summary
  line_22_total_depreciation numeric(15,2), -- Total → flows to Schedule C/E

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

comment on table tax_form_4562 is
  'Form 4562 — Depreciation and Amortization. '
  'One row per business/activity per return. '
  'line_22 is the total depreciation that flows to Schedule C line 13 or Schedule E line 18.';

-- Individual depreciable assets
create table if not exists tax_form_4562_assets (
  id uuid primary key default gen_random_uuid(),
  form_4562_id uuid not null references tax_form_4562(id),
  -- Section on the form
  form_section text, -- 'section_179', 'special_depreciation', 'macrs_section_b', 'macrs_section_c'
  classification text, -- '3-year', '5-year', '7-year', '15-year', '27.5-year residential', etc.
  description text,
  date_placed_in_service date,
  cost_or_basis numeric(15,2),
  recovery_period text,
  convention text, -- 'HY', 'MM', 'MQ'
  method text, -- 'DB', 'S/L', '200DB', '150DB'
  depreciation_deduction numeric(15,2),
  created_at timestamptz default now()
);

comment on table tax_form_4562_assets is
  'Individual depreciable assets listed on Form 4562. '
  'classification maps to the MACRS property class (3-year, 5-year, etc.). '
  'Tracks cost basis, method, and annual depreciation for each asset.';

-- ============================================================================
-- FORM 8962 — Premium Tax Credit
-- ============================================================================

create table if not exists tax_form_8962 (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references tax_returns(id) unique,
  tax_year int not null,

  -- Part I: Annual Calculation
  line_1_family_size int,
  line_2a_modified_agi numeric(15,2),
  line_2b_dependents_modified_agi numeric(15,2),
  line_3_household_income numeric(15,2),
  line_4_federal_poverty_line numeric(15,2),
  line_5_poverty_percentage numeric(8,2), -- e.g. 401
  line_7_applicable_figure numeric(8,4),
  line_8a_annual_contribution numeric(15,2),
  line_8b_monthly_contribution numeric(15,2),

  -- Part II totals
  line_24_total_ptc numeric(15,2),
  line_25_advance_ptc numeric(15,2),
  line_26_net_ptc numeric(15,2),

  -- Part III: Repayment
  line_27_excess_advance numeric(15,2),
  line_28_repayment_limitation numeric(15,2),
  line_29_excess_repayment numeric(15,2), -- → Schedule 2, line 2

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

comment on table tax_form_8962 is
  'Form 8962 — Premium Tax Credit (ACA/marketplace health insurance). '
  'Calculates PTC based on income as % of federal poverty line. '
  'line_29 excess repayment flows to Schedule 2, line 2.';

-- Monthly PTC detail
create table if not exists tax_form_8962_monthly (
  id uuid primary key default gen_random_uuid(),
  form_8962_id uuid not null references tax_form_8962(id),
  month int not null check (month >= 1 and month <= 12),
  enrollment_premium numeric(15,2),
  slcsp_premium numeric(15,2),
  contribution_amount numeric(15,2),
  max_premium_assistance numeric(15,2),
  premium_tax_credit numeric(15,2),
  advance_ptc numeric(15,2),
  created_at timestamptz default now(),
  unique(form_8962_id, month)
);

comment on table tax_form_8962_monthly is
  'Monthly breakdown of Form 8962 Premium Tax Credit (lines 12-23).';

-- ============================================================================
-- FORM 1041 — U.S. Income Tax Return for Estates and Trusts
-- ============================================================================

create table if not exists tax_form_1041 (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references tax_returns(id) unique,
  tax_year int not null,

  -- Trust/Estate identification
  trust_name text,
  fiduciary_name text,
  fiduciary_title text,
  trust_ein text,
  date_entity_created date,
  trust_type text, -- 'simple', 'complex', 'decedent_estate', etc.
  is_section_645_election boolean default false,
  num_k1s_attached int,

  -- Checkboxes
  is_initial_return boolean default false,
  is_final_return boolean default false,
  is_amended boolean default false,
  is_change_fiduciary boolean default false,
  is_change_name boolean default false,
  is_change_address boolean default false,
  has_net_operating_loss_carryback boolean default false,

  -- Income (lines 1-9)
  line_1_interest_income numeric(15,2),
  line_2a_ordinary_dividends numeric(15,2),
  line_2b_qualified_dividends numeric(15,2),
  line_3_business_income numeric(15,2),
  line_4_capital_gain_loss numeric(15,2),
  line_5_rents_royalties numeric(15,2),
  line_6_farm_income numeric(15,2),
  line_7_ordinary_gain numeric(15,2),
  line_8_other_income numeric(15,2),
  line_8_other_description text,
  line_9_total_income numeric(15,2),

  -- Deductions (lines 10-22)
  line_10_interest numeric(15,2),
  line_11_taxes numeric(15,2),
  line_12_fiduciary_fees numeric(15,2),
  line_13_charitable_deduction numeric(15,2),
  line_14_attorney_accountant_fees numeric(15,2),
  line_15a_other_deductions numeric(15,2),
  line_15b_nol_deduction numeric(15,2),
  line_16_total_deductions numeric(15,2),
  line_17_adjusted_total_income numeric(15,2),
  line_18_income_distribution_deduction numeric(15,2),
  line_19_estate_tax_deduction numeric(15,2),
  line_20_qbi_deduction numeric(15,2),
  line_21_exemption numeric(15,2),
  line_22_total_deductions numeric(15,2),
  line_23_taxable_income numeric(15,2),

  -- Tax and Payments (Schedule G)
  line_24_total_tax numeric(15,2),
  line_26_total_payments numeric(15,2),
  line_28_tax_due numeric(15,2),
  line_29_overpayment numeric(15,2),

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

comment on table tax_form_1041 is
  'Form 1041 — U.S. Income Tax Return for Estates and Trusts. '
  'One row per trust/estate return. '
  'line_18 = income distribution deduction (amounts distributed to beneficiaries via K-1). '
  'line_23 = taxable income retained in the trust.';

-- Form 1041 Schedule B — Income Distribution Deduction
create table if not exists tax_form_1041_schedule_b (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references tax_returns(id) unique,
  tax_year int not null,

  line_1_adjusted_total_income numeric(15,2),
  line_2_adjusted_tax_exempt_interest numeric(15,2),
  line_3_net_gain_schedule_d numeric(15,2),
  line_7_distributable_net_income numeric(15,2),
  line_9_required_distributions numeric(15,2),
  line_10_other_distributions numeric(15,2),
  line_11_total_distributions numeric(15,2),
  line_13_tentative_idd numeric(15,2),
  line_14_tentative_idd_from_line2 numeric(15,2),
  line_15_income_distribution_deduction numeric(15,2), -- → Form 1041, line 18

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

comment on table tax_form_1041_schedule_b is
  'Form 1041 Schedule B — Income Distribution Deduction. '
  'Calculates how much of the trust income was distributed to beneficiaries (deductible by trust). '
  'line_15 flows to Form 1041, line 18.';

-- Form 1041 Schedule G — Tax Computation and Payments
create table if not exists tax_form_1041_schedule_g (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references tax_returns(id) unique,
  tax_year int not null,

  -- Part I: Tax Computation
  line_1a_tax_on_taxable_income numeric(15,2),
  line_1b_lump_sum numeric(15,2),
  line_1c_amt numeric(15,2),
  line_1d_total_tax numeric(15,2),
  line_2e_total_credits numeric(15,2),
  line_3_net_tax numeric(15,2),
  line_4_esbt_tax numeric(15,2),
  line_5_niit numeric(15,2),
  line_9_total_tax numeric(15,2),

  -- Part II: Payments
  line_10_estimated_payments numeric(15,2),
  line_11_estimated_allocated_beneficiaries numeric(15,2),
  line_12_subtract numeric(15,2),
  line_13_form_7004 numeric(15,2),
  line_14_federal_withholding numeric(15,2),
  line_19_total_payments numeric(15,2),

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

comment on table tax_form_1041_schedule_g is
  'Form 1041 Schedule G — Tax Computation and Payments for trusts/estates.';

-- Schedule I (Form 1041) — Alternative Minimum Tax
create table if not exists tax_form_1041_schedule_i (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references tax_returns(id) unique,
  tax_year int not null,

  -- Part I
  line_1_adjusted_total_income numeric(15,2),
  line_6_nol_deduction numeric(15,2),
  line_22_alternative_nol numeric(15,2),
  line_23_adjusted_amt_income numeric(15,2),

  -- Part II
  line_35_distributable_amt_income numeric(15,2),
  line_40_tentative_idd_amt numeric(15,2),
  line_42_idd_on_amt_basis numeric(15,2),

  -- Part III
  line_43_exemption_amount numeric(15,2),
  line_44_line27 numeric(15,2),
  line_45_phaseout numeric(15,2),
  line_52_tentative_minimum_tax numeric(15,2),
  line_53_regular_tax numeric(15,2),
  line_54_amt numeric(15,2), -- → Schedule G, line 1c

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

comment on table tax_form_1041_schedule_i is
  'Schedule I (Form 1041) — Alternative Minimum Tax for Estates and Trusts. '
  'line_54 = AMT amount flowing to Schedule G, line 1c.';

-- Schedule J (Form 1041) — Accumulation Distribution
create table if not exists tax_form_1041_schedule_j (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references tax_returns(id) unique,
  tax_year int not null,

  -- Part I
  line_1_amounts_distributed numeric(15,2),
  line_2_distributable_net_income numeric(15,2),
  line_3_required_distributions numeric(15,2),
  line_4_subtract numeric(15,2),
  line_5_accumulation_distribution numeric(15,2),

  -- Part II
  line_6_distributable_net_income_hist numeric(15,2),
  line_7_distributions numeric(15,2),
  line_8_undistributed numeric(15,2),
  line_10_undistributed_net_income numeric(15,2),
  line_12_remaining numeric(15,2),

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

comment on table tax_form_1041_schedule_j is
  'Schedule J (Form 1041) — Accumulation Distribution for Certain Complex Trusts. '
  'Calculates throwback tax on accumulated income not distributed in prior years.';

-- ============================================================================
-- FORM 8995 — Qualified Business Income Deduction
-- ============================================================================

create table if not exists tax_form_8995 (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references tax_returns(id) unique,
  tax_year int not null,

  line_2_total_qbi numeric(15,2),
  line_3_prior_year_carryforward numeric(15,2),
  line_4_total_qbi_income numeric(15,2),
  line_5_qbi_component numeric(15,2),
  line_6_reit_ptp_income numeric(15,2),
  line_7_prior_year_reit_carryforward numeric(15,2),
  line_8_total_reit_ptp numeric(15,2),
  line_9_reit_ptp_component numeric(15,2),
  line_10_total_before_limitation numeric(15,2),
  line_11_taxable_income_before_qbi numeric(15,2),
  line_14_income_limitation numeric(15,2),
  line_15_qbi_deduction numeric(15,2), -- → Form 1040 line 13 or Form 1041 line 20
  line_16_total_qbi_carryforward numeric(15,2),
  line_17_total_reit_carryforward numeric(15,2),

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

comment on table tax_form_8995 is
  'Form 8995 — Qualified Business Income Deduction (Simplified). '
  'Calculates the 20% QBI deduction under Section 199A. '
  'line_15 flows to Form 1040 line 13 or Form 1041 line 20.';

-- QBI detail per business
create table if not exists tax_form_8995_businesses (
  id uuid primary key default gen_random_uuid(),
  form_8995_id uuid not null references tax_form_8995(id),
  business_sequence int not null, -- i, ii, iii, iv, v
  trade_business_name text not null,
  taxpayer_id text,
  qualified_business_income numeric(15,2),
  created_at timestamptz default now()
);

comment on table tax_form_8995_businesses is
  'Individual qualified businesses listed on Form 8995 line 1.';

-- ============================================================================
-- SCHEDULE K-1 — Beneficiary/Partner Share of Income
-- ============================================================================

create table if not exists tax_schedule_k1 (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references tax_returns(id),
  tax_year int not null,

  -- Which type of K-1
  source_form text not null check (source_form in ('1041', '1065', '1120S')),
  -- The entity issuing the K-1
  issuing_entity_name text,
  issuing_entity_ein text,
  -- The recipient
  recipient_name text,
  recipient_tin_last4 text,
  -- For 1041 K-1s
  is_final_k1 boolean default false,
  beneficiary_type text, -- 'domestic', 'foreign'

  -- Income/deduction items (key line items across K-1 types)
  interest_income numeric(15,2),
  ordinary_dividends numeric(15,2),
  qualified_dividends numeric(15,2),
  net_short_term_capital_gain numeric(15,2),
  net_long_term_capital_gain numeric(15,2),
  other_portfolio_income numeric(15,2),
  ordinary_business_income numeric(15,2),
  net_rental_income numeric(15,2),
  guaranteed_payments numeric(15,2),
  section_179_deduction numeric(15,2),
  other_deductions numeric(15,2),
  tax_exempt_interest numeric(15,2),
  -- Distributions
  distributions numeric(15,2),
  -- For trust K-1s specifically
  directly_apportioned_deductions numeric(15,2),
  estate_tax_deduction numeric(15,2),

  -- Full raw line items as JSONB for any line not captured above
  all_line_items jsonb,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

comment on table tax_schedule_k1 is
  'Schedule K-1 — Partner/Shareholder/Beneficiary share of income, deductions, credits. '
  'source_form: 1041 (trust/estate), 1065 (partnership), 1120S (S corp). '
  'Common income items are in typed columns; all_line_items JSONB captures everything.';

-- ============================================================================
-- GENERIC LINE ITEM CATCH-ALL
-- For forms/schedules not yet given dedicated tables, or for supplemental detail
-- ============================================================================

create table if not exists tax_return_line_items (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references tax_returns(id),
  tax_year int not null,

  -- Form identification (LLM-friendly)
  form_name text not null, -- e.g. 'Form 1040', 'Schedule A', 'Form 4868', 'Form 8879'
  form_part text, -- e.g. 'Part I', 'Part II', 'Section B'
  line_number text not null, -- e.g. '1a', '17z', '43'
  line_description text not null, -- Human-readable: "Alternative minimum tax"

  -- Value
  amount numeric(15,2),
  text_value text, -- For non-numeric fields (checkboxes, descriptions)
  is_checkbox boolean, -- True if this is a yes/no field
  checkbox_value boolean,

  -- Metadata for AI disambiguation
  -- Tags help LLMs understand what category this line belongs to
  category_tags text[], -- e.g. ARRAY['income', 'passive', 'rental']
  notes text,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

comment on table tax_return_line_items is
  'Catch-all table for any tax form line item not stored in a dedicated typed table. '
  'Use for: Schedule A (itemized deductions), Schedule 3, Form 4868 (extension), '
  'Form 8879 (e-file auth), state returns, or any supplemental forms. '
  'category_tags provides LLM-friendly classification for AI analysis.';

-- ============================================================================
-- COST SEGREGATION / DEPRECIATION SCHEDULES
-- For detailed property-level depreciation tracking across years
-- ============================================================================

create table if not exists tax_property_depreciation_schedules (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references tax_entities(id),
  -- Property identification
  property_name text not null, -- "22003 East Lost Lake Rd" or "160 Still Forest Dr"
  property_address text,
  property_type text, -- 'residential_rental', 'commercial', 'mixed_use', 'land'
  date_acquired date,
  original_cost_basis numeric(15,2),
  land_value numeric(15,2),
  depreciable_basis numeric(15,2),

  -- If cost segregation study was performed
  has_cost_segregation_study boolean default false,
  cost_seg_study_date date,
  cost_seg_firm text,

  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

comment on table tax_property_depreciation_schedules is
  'Master record for a depreciable property, tracking its cost basis and seg study status. '
  'Individual asset components are in tax_property_depreciation_components. '
  'Annual depreciation amounts are in tax_form_4562_assets.';

create table if not exists tax_property_depreciation_components (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references tax_property_depreciation_schedules(id),
  -- Component from cost segregation
  component_description text not null, -- "5-year personal property", "15-year land improvements", "27.5-year building"
  asset_class text, -- MACRS class: '5', '7', '15', '27.5', '39'
  cost_basis numeric(15,2),
  recovery_period_years numeric(4,1),
  depreciation_method text, -- '200DB', '150DB', 'SL'
  convention text, -- 'HY', 'MM'
  placed_in_service date,
  -- Cumulative tracking
  accumulated_depreciation numeric(15,2),
  remaining_basis numeric(15,2),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

comment on table tax_property_depreciation_components is
  'Individual depreciable components of a property (from cost segregation study). '
  'Each component has its own MACRS class, recovery period, and depreciation method.';

-- ============================================================================
-- INDEXES for common query patterns
-- ============================================================================

create index if not exists idx_tax_returns_entity_year on tax_returns(entity_id, tax_year);
create index if not exists idx_tax_returns_year_type on tax_returns(tax_year, return_type);
create index if not exists idx_tax_form_1040_return on tax_form_1040(return_id);
create index if not exists idx_tax_form_1041_return on tax_form_1041(return_id);
create index if not exists idx_tax_schedule_c_return on tax_schedule_c(return_id);
create index if not exists idx_tax_schedule_d_return on tax_schedule_d(return_id);
create index if not exists idx_tax_schedule_e_rental_return on tax_schedule_e_rental_properties(return_id);
create index if not exists idx_tax_form_8949_return on tax_form_8949_transactions(return_id);
create index if not exists idx_tax_schedule_k1_return on tax_schedule_k1(return_id);
create index if not exists idx_tax_return_line_items_return on tax_return_line_items(return_id);
create index if not exists idx_tax_return_line_items_form on tax_return_line_items(form_name, line_number);
create index if not exists idx_tax_entity_relationships_entity on tax_entity_relationships(entity_id);
create index if not exists idx_tax_entity_relationships_related on tax_entity_relationships(related_entity_id);

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

alter table tax_entities enable row level security;
alter table tax_entity_relationships enable row level security;
alter table tax_returns enable row level security;
alter table tax_return_documents enable row level security;
alter table tax_form_1040 enable row level security;
alter table tax_form_1040_dependents enable row level security;
alter table tax_schedule_1 enable row level security;
alter table tax_schedule_2 enable row level security;
alter table tax_schedule_c enable row level security;
alter table tax_schedule_c_other_expenses enable row level security;
alter table tax_schedule_d enable row level security;
alter table tax_form_8949_transactions enable row level security;
alter table tax_schedule_e_rental_properties enable row level security;
alter table tax_schedule_e_partnerships enable row level security;
alter table tax_schedule_e_estates_trusts enable row level security;
alter table tax_schedule_e_summary enable row level security;
alter table tax_schedule_se enable row level security;
alter table tax_form_4562 enable row level security;
alter table tax_form_4562_assets enable row level security;
alter table tax_form_8962 enable row level security;
alter table tax_form_8962_monthly enable row level security;
alter table tax_form_1041 enable row level security;
alter table tax_form_1041_schedule_b enable row level security;
alter table tax_form_1041_schedule_g enable row level security;
alter table tax_form_1041_schedule_i enable row level security;
alter table tax_form_1041_schedule_j enable row level security;
alter table tax_form_8995 enable row level security;
alter table tax_form_8995_businesses enable row level security;
alter table tax_schedule_k1 enable row level security;
alter table tax_return_line_items enable row level security;
alter table tax_property_depreciation_schedules enable row level security;
alter table tax_property_depreciation_components enable row level security;

-- Service role bypass for all tax tables
do $$
declare
  tbl text;
begin
  for tbl in
    select unnest(array[
      'tax_entities', 'tax_entity_relationships', 'tax_returns', 'tax_return_documents',
      'tax_form_1040', 'tax_form_1040_dependents', 'tax_schedule_1', 'tax_schedule_2',
      'tax_schedule_c', 'tax_schedule_c_other_expenses', 'tax_schedule_d',
      'tax_form_8949_transactions', 'tax_schedule_e_rental_properties',
      'tax_schedule_e_partnerships', 'tax_schedule_e_estates_trusts', 'tax_schedule_e_summary',
      'tax_schedule_se', 'tax_form_4562', 'tax_form_4562_assets',
      'tax_form_8962', 'tax_form_8962_monthly',
      'tax_form_1041', 'tax_form_1041_schedule_b', 'tax_form_1041_schedule_g',
      'tax_form_1041_schedule_i', 'tax_form_1041_schedule_j',
      'tax_form_8995', 'tax_form_8995_businesses', 'tax_schedule_k1',
      'tax_return_line_items', 'tax_property_depreciation_schedules',
      'tax_property_depreciation_components'
    ])
  loop
    execute format(
      'create policy "service_role_bypass_%s" on %I for all to service_role using (true) with check (true)',
      tbl, tbl
    );
  end loop;
end$$;

-- ============================================================================
-- HELPER VIEWS for AI analysis
-- ============================================================================

-- Cross-year income comparison per entity
create or replace view tax_income_summary_by_year as
select
  e.display_name as entity_name,
  e.entity_type,
  r.tax_year,
  r.return_type,
  r.filing_status,
  r.total_income,
  r.adjusted_gross_income,
  r.taxable_income,
  r.total_tax,
  r.total_payments,
  r.amount_owed,
  r.refund_amount,
  -- Effective tax rate
  case when r.taxable_income > 0
    then round((r.total_tax / r.taxable_income) * 100, 2)
    else 0
  end as effective_tax_rate_pct
from tax_returns r
join tax_entities e on e.id = r.entity_id
order by e.display_name, r.tax_year;

comment on view tax_income_summary_by_year is
  'AI-friendly view: shows each entity''s key tax numbers across all years. '
  'Includes effective tax rate calculation. Use for trend analysis and cross-entity comparisons.';

-- Rental property performance across years
create or replace view tax_rental_property_summary as
select
  e.display_name as entity_name,
  r.tax_year,
  p.property_label,
  p.property_address,
  p.property_type,
  p.fair_rental_days,
  p.personal_use_days,
  p.line_3_rents_received as rental_income,
  p.line_20_total_expenses as total_expenses,
  p.line_18_depreciation as depreciation,
  p.line_21_net_income_loss as net_income_loss,
  -- Cash flow (before depreciation)
  (coalesce(p.line_3_rents_received, 0) - coalesce(p.line_20_total_expenses, 0) + coalesce(p.line_18_depreciation, 0))
    as cash_flow_before_depreciation
from tax_schedule_e_rental_properties p
join tax_returns r on r.id = p.return_id
join tax_entities e on e.id = r.entity_id
order by e.display_name, p.property_address, r.tax_year;

comment on view tax_rental_property_summary is
  'AI-friendly view: rental property income, expenses, and cash flow by year. '
  'Useful for analyzing property-level ROI and expense trends.';

-- Business income across years (Schedule C)
create or replace view tax_business_income_summary as
select
  e.display_name as entity_name,
  r.tax_year,
  c.business_name,
  c.principal_activity,
  c.line_7_gross_income as gross_income,
  c.line_28_total_expenses as total_expenses,
  c.line_31_net_profit_loss as net_profit_loss,
  -- Profit margin
  case when c.line_7_gross_income > 0
    then round((c.line_31_net_profit_loss / c.line_7_gross_income) * 100, 2)
    else null
  end as profit_margin_pct
from tax_schedule_c c
join tax_returns r on r.id = c.return_id
join tax_entities e on e.id = r.entity_id
order by e.display_name, c.business_name, r.tax_year;

comment on view tax_business_income_summary is
  'AI-friendly view: Schedule C business income/expenses/profit across years. '
  'Includes profit margin calculation. Useful for business performance trends.';

-- Capital gains/losses across years
create or replace view tax_capital_gains_summary as
select
  e.display_name as entity_name,
  r.tax_year,
  d.line_7_net_short_term as net_short_term,
  d.line_15_net_long_term as net_long_term,
  d.line_16_combined as total_gain_loss,
  d.line_6_st_carryover as st_loss_carryover_used,
  d.line_14_lt_carryover as lt_loss_carryover_used
from tax_schedule_d d
join tax_returns r on r.id = d.return_id
join tax_entities e on e.id = r.entity_id
order by e.display_name, r.tax_year;

comment on view tax_capital_gains_summary is
  'AI-friendly view: capital gains and losses by year with loss carryover tracking.';
