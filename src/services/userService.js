const pool = require("../db/pool");
const { USER_ROLES } = require("../constants");

const ROLE_VALUES = new Set(Object.values(USER_ROLES));

function normalizeRole(role) {
  return ROLE_VALUES.has(role) ? role : USER_ROLES.CLIENT_VIEWER;
}

function buildTelegramFullName(profile) {
  return [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim() || String(profile.id);
}

async function ensureBootstrapOwners(adminIds = []) {
  for (const telegramId of adminIds) {
    await pool.query(
      `
        INSERT INTO app_users (telegram_id, full_name, role, company, receives_meals, is_active, created_at, updated_at)
        VALUES ($1, $2, $3, 'GR', false, true, NOW(), NOW())
        ON CONFLICT (telegram_id) DO NOTHING
      `,
      [telegramId, `Owner ${telegramId}`, USER_ROLES.OWNER]
    );
  }
}

async function getUserByTelegramId(telegramId) {
  const { rows } = await pool.query(
    `
      SELECT id, telegram_id, full_name, username, role, company, receives_meals, employee_id, is_active, created_at, updated_at
      FROM app_users
      WHERE telegram_id = $1
    `,
    [telegramId]
  );
  return rows[0] || null;
}

async function getUserById(userId) {
  const { rows } = await pool.query(
    `
      SELECT id, telegram_id, full_name, username, role, company, receives_meals, employee_id, is_active, created_at, updated_at
      FROM app_users
      WHERE id = $1
    `,
    [userId]
  );
  return rows[0] || null;
}

async function resolveAccessUser(profile, adminIds = []) {
  const fullName = buildTelegramFullName(profile);
  const username = profile.username || null;
  const isBootstrapOwner = adminIds.includes(profile.id);

  if (isBootstrapOwner) {
    await pool.query(
      `
        INSERT INTO app_users (telegram_id, full_name, username, role, company, receives_meals, is_active, created_at, updated_at)
        VALUES ($1, $2, $3, $4, 'GR', false, true, NOW(), NOW())
        ON CONFLICT (telegram_id)
        DO UPDATE SET
          full_name = EXCLUDED.full_name,
          username = EXCLUDED.username,
          updated_at = NOW()
      `,
      [profile.id, fullName, username, USER_ROLES.OWNER]
    );
  }

  const user = await getUserByTelegramId(profile.id);
  if (!user || !user.is_active) {
    return null;
  }

  if (user.full_name !== fullName || user.username !== username) {
    const { rows } = await pool.query(
      `
        UPDATE app_users
        SET full_name = $2,
            username = $3,
            updated_at = NOW()
        WHERE telegram_id = $1
        RETURNING id, telegram_id, full_name, username, role, company, receives_meals, employee_id, is_active, created_at, updated_at
      `,
      [profile.id, fullName, username]
    );
    return rows[0];
  }

  return user;
}

async function listUsers() {
  const { rows } = await pool.query(
    `
      SELECT id, telegram_id, full_name, username, role, company, receives_meals, employee_id, is_active, created_at, updated_at
      FROM app_users
      ORDER BY
        company ASC,
        CASE role
          WHEN 'owner' THEN 1
          WHEN 'barista' THEN 2
          ELSE 3
        END,
        full_name ASC,
        telegram_id ASC
    `
  );
  return rows;
}

async function listDocumentReminderRecipients() {
  const { rows } = await pool.query(
    `
      SELECT id, telegram_id, full_name, username, role, company, receives_meals, employee_id, is_active, created_at, updated_at
      FROM app_users
      WHERE is_active = true
        AND role IN ($1, $2)
      ORDER BY role ASC, full_name ASC, telegram_id ASC
    `,
    [USER_ROLES.OWNER, USER_ROLES.CLIENT_VIEWER]
  );
  return rows;
}

async function upsertUser({ telegramId, fullName, username = null, role, company = "GR", receivesMeals = false, employeeId = null }) {
  const normalizedRole = normalizeRole(role);
  const { rows } = await pool.query(
    `
      INSERT INTO app_users (telegram_id, full_name, username, role, company, receives_meals, employee_id, is_active, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, true, NOW(), NOW())
      ON CONFLICT (telegram_id)
      DO UPDATE SET
        full_name = EXCLUDED.full_name,
        username = EXCLUDED.username,
        role = EXCLUDED.role,
        company = EXCLUDED.company,
        receives_meals = EXCLUDED.receives_meals,
        employee_id = EXCLUDED.employee_id,
        is_active = true,
        updated_at = NOW()
      RETURNING id, telegram_id, full_name, username, role, company, receives_meals, employee_id, is_active, created_at, updated_at
    `,
    [telegramId, String(fullName || "").trim() || `User ${telegramId}`, username, normalizedRole, company, Boolean(receivesMeals), employeeId]
  );
  return rows[0];
}

async function updateUserRole(userId, role) {
  const normalizedRole = normalizeRole(role);
  const { rows } = await pool.query(
    `
      UPDATE app_users
      SET role = $2,
          updated_at = NOW()
      WHERE id = $1
        RETURNING id, telegram_id, full_name, username, role, company, receives_meals, employee_id, is_active, created_at, updated_at
      `,
      [userId, normalizedRole]
    );
  return rows[0] || null;
}

async function updateUserRsSettings(userId, { receivesMeals, employeeId = null }) {
  const { rows } = await pool.query(
    `
      UPDATE app_users
      SET receives_meals = $2,
          employee_id = $3,
          updated_at = NOW()
      WHERE id = $1
      RETURNING id, telegram_id, full_name, username, role, company, receives_meals, employee_id, is_active, created_at, updated_at
    `,
    [userId, Boolean(receivesMeals), employeeId]
  );
  return rows[0] || null;
}

async function toggleUserActive(userId) {
  const { rows } = await pool.query(
    `
      UPDATE app_users
      SET is_active = NOT is_active,
          updated_at = NOW()
      WHERE id = $1
      RETURNING id, telegram_id, full_name, username, role, company, receives_meals, employee_id, is_active, created_at, updated_at
    `,
    [userId]
  );
  return rows[0] || null;
}

module.exports = {
  ensureBootstrapOwners,
  getUserById,
  getUserByTelegramId,
  listDocumentReminderRecipients,
  listUsers,
  normalizeRole,
  resolveAccessUser,
  toggleUserActive,
  upsertUser,
  updateUserRole,
  updateUserRsSettings
};
