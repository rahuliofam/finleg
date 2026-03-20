-- ============================================================
-- 026: Populate all Schwab accounts with display names, correct types,
-- account holder info, and metadata (debit cards, routing numbers)
-- Source: "Family Banking and Brokerage Account #'s - Schwab etc..."
-- ============================================================

-- Get the Schwab institution ID
DO $$
DECLARE
  schwab_id UUID;
BEGIN
  SELECT id INTO schwab_id FROM institutions WHERE name = 'Charles Schwab';
  IF schwab_id IS NULL THEN
    RAISE EXCEPTION 'Charles Schwab institution not found';
  END IF;

  -- ============================================================
  -- 1. UPDATE existing API-synced accounts (9 accounts)
  -- ============================================================

  -- Rahul Mercer IRA (****0095) — mapped from "07100001359385380057100095"
  UPDATE accounts SET
    display_name = 'Rahul Mercer IRA',
    account_type = 'ira',
    account_holder = 'Rahul Sonnad',
    account_subtype = 'mercer_rollover'
  WHERE account_number_masked = '****0095' AND institution_id = schwab_id;

  -- Rahul Brokerage (****0566) — "6434-0566"
  UPDATE accounts SET
    display_name = 'Rahul Brokerage',
    account_type = 'brokerage',
    account_holder = 'Rahul Sonnad'
  WHERE account_number_masked = '****0566' AND institution_id = schwab_id;

  -- Venmo Checking AAP (****1046) — "440052831102"
  -- This is the Schwab Bank checking for Venmo/Playhouse matters
  UPDATE accounts SET
    display_name = 'Venmo Checking (AAP)',
    account_type = 'checking',
    account_holder = 'Rahul Sonnad',
    account_subtype = 'venmo_playhouse',
    metadata = jsonb_build_object(
      'routing_number', '121202211',
      'full_account_number_last4', '1102'
    )
  WHERE account_number_masked = '****1046' AND institution_id = schwab_id;

  -- SubTrust Brokerage (****2028) — "7320-2028"
  UPDATE accounts SET
    display_name = 'SubTrust Brokerage',
    account_type = 'brokerage',
    account_holder = 'Revocable Trust of Subhash Sonnad'
  WHERE account_number_masked = '****2028' AND institution_id = schwab_id;

  -- Rahul Trading (****2192) — "5306-2192"
  UPDATE accounts SET
    display_name = 'Rahul Trading',
    account_type = 'brokerage',
    account_holder = 'Rahul Sonnad',
    account_subtype = 'trading'
  WHERE account_number_masked = '****2192' AND institution_id = schwab_id;

  -- Rahul Trad IRA (****3902) — "8076-3902"
  UPDATE accounts SET
    display_name = 'Rahul Trad IRA',
    account_type = 'ira',
    account_holder = 'Rahul Sonnad',
    account_subtype = 'traditional'
  WHERE account_number_masked = '****3902' AND institution_id = schwab_id;

  -- Rahul Roth IRA (****4441) — "2628-4441"
  UPDATE accounts SET
    display_name = 'Rahul Roth IRA',
    account_type = 'roth_ira',
    account_holder = 'Rahul Sonnad'
  WHERE account_number_masked = '****4441' AND institution_id = schwab_id;

  -- Rahul Inh Trad IRA (****5874) — "6342-5874"
  UPDATE accounts SET
    display_name = 'Rahul Inh Trad IRA',
    account_type = 'ira',
    account_holder = 'Rahul Sonnad',
    account_subtype = 'inherited_traditional'
  WHERE account_number_masked = '****5874' AND institution_id = schwab_id;

  -- Unknown account ****8782 — need to identify
  -- Based on Schwab API type=CASH, possibly a cash account
  UPDATE accounts SET
    display_name = 'Schwab Cash Account',
    account_holder = 'Rahul Sonnad'
  WHERE account_number_masked = '****8782' AND institution_id = schwab_id;

  -- ============================================================
  -- 2. INSERT missing Schwab accounts (not returned by Trader API)
  -- ============================================================

  -- Rahul Checking — "440031963711"
  INSERT INTO accounts (institution_id, display_name, account_type, account_number_masked, account_holder, connection_type, metadata)
  VALUES (schwab_id, 'Rahul Checking', 'checking', '****3711', 'Rahul Sonnad', 'manual',
    jsonb_build_object(
      'routing_number', '121202211',
      'full_account_number_last4', '3711',
      'debit_card_last4', '0831',
      'debit_card_expiry', '03/29',
      'debit_card_security_code_hint', '756',
      'linked_card_note', 'Account ending 3711 is linked to card ending 831'
    ))
  ON CONFLICT (institution_id, external_account_id) DO NOTHING;

  -- SubTrust Checking — "440042890044"
  INSERT INTO accounts (institution_id, display_name, account_type, account_number_masked, account_holder, connection_type, metadata)
  VALUES (schwab_id, 'SubTrust Checking', 'checking', '****0044', 'Revocable Trust of Subhash Sonnad', 'manual',
    jsonb_build_object(
      'routing_number', '121202211',
      'full_account_number_last4', '0044',
      'debit_card_last4', '4767',
      'debit_card_expiry', '08/25',
      'debit_card_security_code_hint', '815',
      'linked_card_note', 'Account ending 0044 is linked to card ending 767'
    ))
  ON CONFLICT (institution_id, external_account_id) DO NOTHING;

  -- Kathy Checking — "440032358408"
  INSERT INTO accounts (institution_id, display_name, account_type, account_number_masked, account_holder, connection_type, metadata)
  VALUES (schwab_id, 'Kathy Checking', 'checking', '****8408', 'Kathy Sonnad', 'manual',
    jsonb_build_object('routing_number', '121202211', 'full_account_number_last4', '8408'))
  ON CONFLICT (institution_id, external_account_id) DO NOTHING;

  -- Kathy Brokerage — "3664-4708"
  INSERT INTO accounts (institution_id, display_name, account_type, account_number_masked, account_holder, connection_type)
  VALUES (schwab_id, 'Kathy Brokerage', 'brokerage', '****4708', 'Kathy Sonnad', 'manual')
  ON CONFLICT (institution_id, external_account_id) DO NOTHING;

  -- Kathy Trad IRA — "6602-1843"
  INSERT INTO accounts (institution_id, display_name, account_type, account_number_masked, account_holder, connection_type)
  VALUES (schwab_id, 'Kathy Trad IRA', 'ira', '****1843', 'Kathy Sonnad', 'manual')
  ON CONFLICT (institution_id, external_account_id) DO NOTHING;

  -- Kathy Roth IRA — "3497-3678"
  INSERT INTO accounts (institution_id, display_name, account_type, account_number_masked, account_holder, connection_type)
  VALUES (schwab_id, 'Kathy Roth IRA', 'roth_ira', '****3678', 'Kathy Sonnad', 'manual')
  ON CONFLICT (institution_id, external_account_id) DO NOTHING;

  -- SubTrust Roth IRA — "2233-0486"
  INSERT INTO accounts (institution_id, display_name, account_type, account_number_masked, account_holder, connection_type)
  VALUES (schwab_id, 'SubTrust Roth IRA', 'roth_ira', '****0486', 'Revocable Trust of Subhash Sonnad', 'manual')
  ON CONFLICT (institution_id, external_account_id) DO NOTHING;

  -- SubTrust Trad IRA — "6448-3403"
  INSERT INTO accounts (institution_id, display_name, account_type, account_number_masked, account_holder, connection_type)
  VALUES (schwab_id, 'SubTrust Trad IRA', 'ira', '****3403', 'Revocable Trust of Subhash Sonnad', 'manual')
  ON CONFLICT (institution_id, external_account_id) DO NOTHING;

  -- Dina Voronina Joint Account — "1507-5535"
  INSERT INTO accounts (institution_id, display_name, account_type, account_number_masked, account_holder, connection_type, is_joint)
  VALUES (schwab_id, 'Dina Voronina Joint', 'brokerage', '****5535', 'Dina Voronina', 'manual', true)
  ON CONFLICT (institution_id, external_account_id) DO NOTHING;

  -- ============================================================
  -- 3. Trust IRA accounts (Haydn, Hannah, Emina)
  -- ============================================================

  -- Haydn RothTrust — "3243-8163"
  INSERT INTO accounts (institution_id, display_name, account_type, account_number_masked, account_holder, connection_type, account_subtype)
  VALUES (schwab_id, 'Haydn RothTrust', 'roth_ira', '****8163', 'Haydn Sonnad', 'manual', 'trust')
  ON CONFLICT (institution_id, external_account_id) DO NOTHING;

  -- Haydn TradTrust — "7380-9661"
  INSERT INTO accounts (institution_id, display_name, account_type, account_number_masked, account_holder, connection_type, account_subtype)
  VALUES (schwab_id, 'Haydn TradTrust', 'ira', '****9661', 'Haydn Sonnad', 'manual', 'trust')
  ON CONFLICT (institution_id, external_account_id) DO NOTHING;

  -- Hannah RothTrust — "3781-9342"
  INSERT INTO accounts (institution_id, display_name, account_type, account_number_masked, account_holder, connection_type, account_subtype)
  VALUES (schwab_id, 'Hannah RothTrust', 'roth_ira', '****9342', 'Hannah Sonnad', 'manual', 'trust')
  ON CONFLICT (institution_id, external_account_id) DO NOTHING;

  -- Hannah TradTrust — "7706-6811"
  INSERT INTO accounts (institution_id, display_name, account_type, account_number_masked, account_holder, connection_type, account_subtype)
  VALUES (schwab_id, 'Hannah TradTrust', 'ira', '****6811', 'Hannah Sonnad', 'manual', 'trust')
  ON CONFLICT (institution_id, external_account_id) DO NOTHING;

  -- Emina RothTrust — "8373-8945"
  INSERT INTO accounts (institution_id, display_name, account_type, account_number_masked, account_holder, connection_type, account_subtype)
  VALUES (schwab_id, 'Emina RothTrust', 'roth_ira', '****8945', 'Emina Sonnad', 'manual', 'trust')
  ON CONFLICT (institution_id, external_account_id) DO NOTHING;

  -- Emina TradTrust — "4055-9200"
  INSERT INTO accounts (institution_id, display_name, account_type, account_number_masked, account_holder, connection_type, account_subtype)
  VALUES (schwab_id, 'Emina TradTrust', 'ira', '****9200', 'Emina Sonnad', 'manual', 'trust')
  ON CONFLICT (institution_id, external_account_id) DO NOTHING;

  -- ============================================================
  -- 4. Kids' personal accounts (non-trust)
  -- ============================================================

  -- Haydn Roth IRA — "4180-9797"
  INSERT INTO accounts (institution_id, display_name, account_type, account_number_masked, account_holder, connection_type)
  VALUES (schwab_id, 'Haydn Roth IRA', 'roth_ira', '****9797', 'Haydn Sonnad', 'manual')
  ON CONFLICT (institution_id, external_account_id) DO NOTHING;

  -- Haydn Bank — "4400-32372359"
  INSERT INTO accounts (institution_id, display_name, account_type, account_number_masked, account_holder, connection_type, metadata)
  VALUES (schwab_id, 'Haydn Bank', 'checking', '****2359', 'Haydn Sonnad', 'manual',
    jsonb_build_object('routing_number', '121202211'))
  ON CONFLICT (institution_id, external_account_id) DO NOTHING;

  -- Haydn Brokerage — "2708-4944"
  INSERT INTO accounts (institution_id, display_name, account_type, account_number_masked, account_holder, connection_type)
  VALUES (schwab_id, 'Haydn Brokerage', 'brokerage', '****4944', 'Haydn Sonnad', 'manual')
  ON CONFLICT (institution_id, external_account_id) DO NOTHING;

  -- Haydn Inh Trad IRA — "7545-7692"
  INSERT INTO accounts (institution_id, display_name, account_type, account_number_masked, account_holder, connection_type, account_subtype)
  VALUES (schwab_id, 'Haydn Inh Trad IRA', 'ira', '****7692', 'Haydn Sonnad', 'manual', 'inherited_traditional')
  ON CONFLICT (institution_id, external_account_id) DO NOTHING;

  -- Emina Roth IRA — "1728-1387"
  INSERT INTO accounts (institution_id, display_name, account_type, account_number_masked, account_holder, connection_type)
  VALUES (schwab_id, 'Emina Roth IRA', 'roth_ira', '****1387', 'Emina Sonnad', 'manual')
  ON CONFLICT (institution_id, external_account_id) DO NOTHING;

  -- Emina Bank — "4400-32372797"
  INSERT INTO accounts (institution_id, display_name, account_type, account_number_masked, account_holder, connection_type, metadata)
  VALUES (schwab_id, 'Emina Bank', 'checking', '****2797', 'Emina Sonnad', 'manual',
    jsonb_build_object('routing_number', '121202211'))
  ON CONFLICT (institution_id, external_account_id) DO NOTHING;

  -- Emina Brokerage — "9729-7151"
  INSERT INTO accounts (institution_id, display_name, account_type, account_number_masked, account_holder, connection_type)
  VALUES (schwab_id, 'Emina Brokerage', 'brokerage', '****7151', 'Emina Sonnad', 'manual')
  ON CONFLICT (institution_id, external_account_id) DO NOTHING;

  -- Emina Inh Trad IRA — "2745-3866"
  INSERT INTO accounts (institution_id, display_name, account_type, account_number_masked, account_holder, connection_type, account_subtype)
  VALUES (schwab_id, 'Emina Inh Trad IRA', 'ira', '****3866', 'Emina Sonnad', 'manual', 'inherited_traditional')
  ON CONFLICT (institution_id, external_account_id) DO NOTHING;

  -- Hannah Roth IRA — "3326-5170"
  INSERT INTO accounts (institution_id, display_name, account_type, account_number_masked, account_holder, connection_type)
  VALUES (schwab_id, 'Hannah Roth IRA', 'roth_ira', '****5170', 'Hannah Sonnad', 'manual')
  ON CONFLICT (institution_id, external_account_id) DO NOTHING;

  -- Hannah Bank — "4400-32366518"
  INSERT INTO accounts (institution_id, display_name, account_type, account_number_masked, account_holder, connection_type, metadata)
  VALUES (schwab_id, 'Hannah Bank', 'checking', '****6518', 'Hannah Sonnad', 'manual',
    jsonb_build_object('routing_number', '121202211'))
  ON CONFLICT (institution_id, external_account_id) DO NOTHING;

  -- Hannah Brokerage — "5416-8830"
  INSERT INTO accounts (institution_id, display_name, account_type, account_number_masked, account_holder, connection_type)
  VALUES (schwab_id, 'Hannah Brokerage', 'brokerage', '****8830', 'Hannah Sonnad', 'manual')
  ON CONFLICT (institution_id, external_account_id) DO NOTHING;

  -- Hannah Inh Trad IRA — "8208-3568"
  INSERT INTO accounts (institution_id, display_name, account_type, account_number_masked, account_holder, connection_type, account_subtype)
  VALUES (schwab_id, 'Hannah Inh Trad IRA', 'ira', '****3568', 'Hannah Sonnad', 'manual', 'inherited_traditional')
  ON CONFLICT (institution_id, external_account_id) DO NOTHING;

  RAISE NOTICE 'Schwab accounts migration complete';
END $$;
