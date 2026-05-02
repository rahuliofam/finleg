export interface Account {
  id: string;
  account_number_masked: string | null;
  account_type: string;
  account_subtype: string | null;
  display_name: string | null;
  official_name: string | null;
  account_holder: string | null;
  is_active: boolean;
  last_synced_at: string | null;
  total_value: number | null;
  cash_balance: number | null;
  buying_power: number | null;
  balance_current: number | null;
  balance_available: number | null;
  connection_type: string | null;
  metadata: Record<string, unknown> | null;
}

export interface Holding {
  id: string;
  account_id: string;
  quantity: number;
  cost_basis: number | null;
  market_value: number | null;
  price: number | null;
  unrealized_gain_loss: number | null;
  unrealized_gain_loss_pct: number | null;
  last_synced_at: string | null;
  security: {
    ticker_symbol: string | null;
    name: string;
    security_type: string;
  };
}

export interface ConnectionStatus {
  connected: boolean;
  refreshTokenExpiresAt?: string;
  lastUpdated?: string;
}

export interface AccountGroup {
  name: string;
  accounts: Account[];
}

export interface BalanceSnapshot {
  snapshot_date: string;
  total_value: number | null;
  account_id: string;
}
