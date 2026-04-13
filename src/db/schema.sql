CREATE TABLE IF NOT EXISTS employees (
  id BIGSERIAL PRIMARY KEY,
  full_name TEXT NOT NULL UNIQUE,
  note TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_users (
  id BIGSERIAL PRIMARY KEY,
  telegram_id BIGINT NOT NULL UNIQUE,
  full_name TEXT NOT NULL DEFAULT '',
  username TEXT,
  role VARCHAR(20) NOT NULL CHECK (role IN ('owner', 'barista', 'client_viewer')),
  company VARCHAR(2) NOT NULL DEFAULT 'GR' CHECK (company IN ('GR', 'RS')),
  receives_meals BOOLEAN NOT NULL DEFAULT FALSE,
  employee_id BIGINT REFERENCES employees(id) ON UPDATE CASCADE ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS advances (
  id BIGSERIAL PRIMARY KEY,
  payment_date DATE NOT NULL,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  comment TEXT,
  document_file_path TEXT,
  document_original_name TEXT,
  created_by_user_id BIGINT REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by_user_id BIGINT REFERENCES app_users(id) ON DELETE SET NULL,
  document_uploaded_by_user_id BIGINT REFERENCES app_users(id) ON DELETE SET NULL,
  document_uploaded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS meal_entries (
  id BIGSERIAL PRIMARY KEY,
  meal_date DATE NOT NULL,
  employee_id BIGINT NOT NULL REFERENCES employees(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  comment TEXT,
  created_by_user_id BIGINT REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by_user_id BIGINT REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS generated_documents (
  id BIGSERIAL PRIMARY KEY,
  doc_type VARCHAR(20) NOT NULL CHECK (doc_type IN ('act', 'reconciliation')),
  status VARCHAR(20) NOT NULL DEFAULT 'generated' CHECK (status IN ('generated', 'sent', 'signed')),
  document_number TEXT,
  document_date DATE NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  act_month SMALLINT CHECK (act_month IS NULL OR act_month BETWEEN 1 AND 12),
  act_year INTEGER CHECK (act_year IS NULL OR act_year >= 2000),
  days_count INTEGER NOT NULL DEFAULT 0,
  total_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  opening_balance NUMERIC(14, 2) NOT NULL DEFAULT 0,
  charged_total NUMERIC(14, 2) NOT NULL DEFAULT 0,
  paid_total NUMERIC(14, 2) NOT NULL DEFAULT 0,
  closing_balance NUMERIC(14, 2) NOT NULL DEFAULT 0,
  generated_file_path TEXT NOT NULL,
  signed_file_path TEXT,
  note TEXT,
  created_by_user_id BIGINT REFERENCES app_users(id) ON DELETE SET NULL,
  uploaded_signed_by_user_id BIGINT REFERENCES app_users(id) ON DELETE SET NULL,
  uploaded_signed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS month_uploaded_documents (
  id BIGSERIAL PRIMARY KEY,
  doc_kind VARCHAR(20) NOT NULL CHECK (doc_kind IN ('reconciliation')),
  doc_year INTEGER NOT NULL CHECK (doc_year >= 2000),
  doc_month SMALLINT NOT NULL CHECK (doc_month BETWEEN 1 AND 12),
  signed_file_path TEXT NOT NULL,
  original_file_name TEXT,
  created_by_user_id BIGINT REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by_user_id BIGINT REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (doc_kind, doc_year, doc_month)
);

CREATE INDEX IF NOT EXISTS idx_app_users_role ON app_users(role);
CREATE INDEX IF NOT EXISTS idx_app_users_company ON app_users(company);
CREATE INDEX IF NOT EXISTS idx_employees_active ON employees(is_active);
CREATE INDEX IF NOT EXISTS idx_advances_date ON advances(payment_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_meal_entries_employee_date ON meal_entries(employee_id, meal_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_meal_entries_date ON meal_entries(meal_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_generated_documents_type_period ON generated_documents(doc_type, period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_generated_documents_status ON generated_documents(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_generated_documents_act_number_unique
  ON generated_documents(document_number)
  WHERE doc_type = 'act' AND document_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_month_uploaded_documents_period ON month_uploaded_documents(doc_kind, doc_year, doc_month);

INSERT INTO app_settings (key, value)
VALUES
  (
    'performer_details',
    $${
      "shortName": "ИП Валеев Павел Сергеевич",
      "legalName": "Индивидуальный предприниматель Валеев Павел Сергеевич",
      "inn": "540131420015",
      "kpp": "",
      "address": "346062, Ростовская обл., Тарасовский р-н, слобода Ефремово-Степановка, ул. Буденного, д. 18",
      "bankAccount": "40802810770010447459",
      "bankName": "МОСКОВСКИЙ ФИЛИАЛ АО КБ «МОДУЛЬБАНК»",
      "bik": "044525092",
      "correspondentAccount": "30101810645250000092",
      "signerName": "ИП Валеев Павел Сергеевич",
      "signerLabel": "/Валеев П.С./"
    }$$::jsonb
  ),
  (
    'customer_details',
    $${
      "shortName": "Railship",
      "legalName": "ООО «Рейлшип Сервис»",
      "inn": "6658246043",
      "kpp": "665801001",
      "address": "",
      "bankAccount": "",
      "bankName": "",
      "bik": "",
      "correspondentAccount": "",
      "signerName": "ООО «Рейлшип Сервис»",
      "signerLabel": "/_____________/"
    }$$::jsonb
  ),
  (
    'document_settings',
    $${
      "serviceName": "Организация питания сотрудников",
      "dailyLimit": 300,
      "customerShortName": "Railship",
      "vatText": "НДС не облагается.",
      "advanceNote": "Остаток аванса Заказчика подлежит зачету при последующем оказании услуг"
    }$$::jsonb
  )
ON CONFLICT (key) DO NOTHING;

ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS company VARCHAR(2) NOT NULL DEFAULT 'GR';

ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS receives_meals BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS employee_id BIGINT REFERENCES employees(id) ON UPDATE CASCADE ON DELETE SET NULL;

UPDATE app_users
SET company = 'GR'
WHERE company IS NULL OR company = '';
