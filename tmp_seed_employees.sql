BEGIN;

DELETE FROM app_users
WHERE telegram_id = 2131871258;

DELETE FROM employees e
WHERE NOT EXISTS (
  SELECT 1
  FROM app_users u
  WHERE u.employee_id = e.id
);

WITH maybach AS (
  INSERT INTO employees (full_name, note, is_active, created_at, updated_at)
  VALUES ('Майбах А. А.', NULL, TRUE, NOW(), NOW())
  RETURNING id
)
INSERT INTO app_users (
  telegram_id,
  full_name,
  username,
  role,
  company,
  receives_meals,
  employee_id,
  is_active,
  created_at,
  updated_at
)
SELECT
  2131871258,
  'Майбах А. А.',
  NULL,
  'client_viewer',
  'RS',
  TRUE,
  maybach.id,
  TRUE,
  NOW(),
  NOW()
FROM maybach;

INSERT INTO employees (full_name, note, is_active, created_at, updated_at)
VALUES
  ('Табакопуло Е.Б', NULL, TRUE, NOW(), NOW()),
  ('Без имени', 'Запись по умолчанию для питания, если имя неизвестно', TRUE, NOW(), NOW());

COMMIT;
