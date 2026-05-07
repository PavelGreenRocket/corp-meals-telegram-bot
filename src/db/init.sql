-- clients
CREATE TABLE IF NOT EXISTS clients (
  id BIGSERIAL PRIMARY KEY,
  short_name TEXT NOT NULL UNIQUE,
  legal_name TEXT NOT NULL,
  inn VARCHAR(12) NOT NULL,
  kpp VARCHAR(9),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- food_operations
CREATE TABLE IF NOT EXISTS food_operations (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  operation_type VARCHAR(16) NOT NULL CHECK (operation_type IN ('advance', 'meal')),
  operation_date DATE NOT NULL,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  persons_count INTEGER CHECK (persons_count IS NULL OR persons_count > 0),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- monthly_acts
CREATE TABLE IF NOT EXISTS monthly_acts (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  act_number TEXT NOT NULL,
  act_month SMALLINT NOT NULL CHECK (act_month BETWEEN 1 AND 12),
  act_year INTEGER NOT NULL CHECK (act_year >= 2000),
  act_date DATE NOT NULL,
  days_count INTEGER NOT NULL CHECK (days_count >= 0),
  total_amount NUMERIC(14, 2) NOT NULL CHECK (total_amount >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'generated',
  signed_file_path TEXT,
  signed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, act_month, act_year, act_number)
);

-- reconciliation_snapshots
CREATE TABLE IF NOT EXISTS reconciliation_snapshots (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  opening_balance NUMERIC(14, 2) NOT NULL,
  charged_total NUMERIC(14, 2) NOT NULL,
  paid_total NUMERIC(14, 2) NOT NULL,
  closing_balance NUMERIC(14, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- indexes
CREATE INDEX IF NOT EXISTS idx_clients_is_active ON clients(is_active);
CREATE INDEX IF NOT EXISTS idx_food_operations_client_date ON food_operations(client_id, operation_date);
CREATE INDEX IF NOT EXISTS idx_food_operations_client_type_date ON food_operations(client_id, operation_type, operation_date);
CREATE INDEX IF NOT EXISTS idx_monthly_acts_client_period ON monthly_acts(client_id, act_year, act_month);
CREATE INDEX IF NOT EXISTS idx_reconciliation_snapshots_client_period ON reconciliation_snapshots(client_id, period_start, period_end);

INSERT INTO clients (short_name, legal_name, inn, kpp)
VALUES ('Рейлшип', 'ООО «Рейлшип Сервис»', '6658246043', '665801001')
ON CONFLICT (short_name) DO NOTHING;

INSERT INTO food_operations (client_id, operation_type, operation_date, amount, persons_count, comment)
SELECT c.id, 'advance', '2025-10-23', 15000.00, NULL, 'Тестовый аванс'
FROM clients c
WHERE c.short_name = 'Рейлшип'
  AND NOT EXISTS (
    SELECT 1 FROM food_operations fo
    WHERE fo.client_id = c.id
      AND fo.operation_type = 'advance'
      AND fo.operation_date = '2025-10-23'
      AND fo.amount = 15000.00
  );

INSERT INTO food_operations (client_id, operation_type, operation_date, amount, persons_count, comment)
SELECT c.id, 'meal', '2025-11-17', 6700.00, NULL, 'Тестовое питание'
FROM clients c
WHERE c.short_name = 'Рейлшип'
  AND NOT EXISTS (
    SELECT 1 FROM food_operations fo
    WHERE fo.client_id = c.id
      AND fo.operation_type = 'meal'
      AND fo.operation_date = '2025-11-17'
      AND fo.amount = 6700.00
  );

INSERT INTO food_operations (client_id, operation_type, operation_date, amount, persons_count, comment)
SELECT c.id, 'meal', '2026-02-28', 6100.00, NULL, 'Тестовое питание'
FROM clients c
WHERE c.short_name = 'Рейлшип'
  AND NOT EXISTS (
    SELECT 1 FROM food_operations fo
    WHERE fo.client_id = c.id
      AND fo.operation_type = 'meal'
      AND fo.operation_date = '2026-02-28'
      AND fo.amount = 6100.00
  );
