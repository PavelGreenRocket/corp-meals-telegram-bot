const pool = require("../db/pool");
const { DAILY_LIMIT } = require("../constants");
const { getMonthRange } = require("../utils/dateHelpers");
const { getLegacyActSummary } = require("./legacySettlementService");

async function getEmployeeSpentForDate(employeeId, mealDate, excludeMealId = null) {
  const values = [employeeId, mealDate];
  let exclusion = "";

  if (excludeMealId) {
    values.push(excludeMealId);
    exclusion = `AND id <> $${values.length}`;
  }

  const { rows } = await pool.query(
    `
      SELECT COALESCE(SUM(amount), 0) AS total_amount
      FROM meal_entries
      WHERE employee_id = $1
        AND meal_date = $2
        ${exclusion}
    `,
    values
  );

  return Number(rows[0]?.total_amount || 0);
}

async function assertDailyLimit(employeeId, mealDate, amount, excludeMealId = null) {
  const currentTotal = await getEmployeeSpentForDate(employeeId, mealDate, excludeMealId);
  const nextTotal = Number((currentTotal + Number(amount)).toFixed(2));

  if (nextTotal > DAILY_LIMIT) {
    throw new Error(
      `Превышен лимит 300 ₽ на сотрудника за день. Уже занесено ${currentTotal.toFixed(2)} ₽, новая сумма даст ${nextTotal.toFixed(2)} ₽`
    );
  }

  return {
    currentTotal,
    nextTotal,
    remaining: Number((DAILY_LIMIT - nextTotal).toFixed(2))
  };
}

async function createMealEntry({
  mealDate,
  employeeId,
  amount,
  comment = null,
  createdByUserId = null
}) {
  await assertDailyLimit(employeeId, mealDate, amount);

  const { rows } = await pool.query(
    `
      INSERT INTO meal_entries (
        meal_date, employee_id, amount, comment, created_by_user_id, updated_by_user_id, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $5, NOW(), NOW())
      RETURNING *
    `,
    [mealDate, employeeId, amount, comment, createdByUserId]
  );

  return rows[0];
}

async function getMealEntryById(mealId) {
  const { rows } = await pool.query(
    `
      SELECT
        me.*,
        e.full_name AS employee_name,
        u.full_name AS creator_name
      FROM meal_entries me
      JOIN employees e ON e.id = me.employee_id
      LEFT JOIN app_users u ON u.id = me.created_by_user_id
      WHERE me.id = $1
    `,
    [mealId]
  );
  return rows[0] || null;
}

async function updateMealEntry(
  mealId,
  { mealDate, employeeId, amount, comment = null, updatedByUserId = null }
) {
  await assertDailyLimit(employeeId, mealDate, amount, mealId);

  const { rows } = await pool.query(
    `
      UPDATE meal_entries
      SET meal_date = $2,
          employee_id = $3,
          amount = $4,
          comment = $5,
          updated_by_user_id = $6,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [mealId, mealDate, employeeId, amount, comment, updatedByUserId]
  );
  return rows[0] || null;
}

async function deleteMealEntry(mealId) {
  const { rows } = await pool.query("DELETE FROM meal_entries WHERE id = $1 RETURNING *", [mealId]);
  return rows[0] || null;
}

async function listMealEntries({
  startDate = null,
  endDate = null,
  employeeId = null,
  createdByUserId = null,
  limit = 20,
  offset = 0
} = {}) {
  const filters = [];
  const values = [];

  if (startDate) {
    values.push(startDate);
    filters.push(`me.meal_date >= $${values.length}`);
  }

  if (endDate) {
    values.push(endDate);
    filters.push(`me.meal_date <= $${values.length}`);
  }

  if (employeeId) {
    values.push(employeeId);
    filters.push(`me.employee_id = $${values.length}`);
  }

  if (createdByUserId) {
    values.push(createdByUserId);
    filters.push(`me.created_by_user_id = $${values.length}`);
  }

  values.push(limit);
  values.push(offset);

  const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

  const { rows } = await pool.query(
    `
      SELECT
        me.*,
        e.full_name AS employee_name,
        u.full_name AS creator_name
      FROM meal_entries me
      JOIN employees e ON e.id = me.employee_id
      LEFT JOIN app_users u ON u.id = me.created_by_user_id
      ${whereClause}
      ORDER BY me.meal_date DESC, me.id DESC
      LIMIT $${values.length - 1}
      OFFSET $${values.length}
    `,
    values
  );

  return rows;
}

async function getMealSummary({ startDate = null, endDate = null, createdByUserId = null, includeLegacy = false } = {}) {
  const filters = [];
  const values = [];

  if (startDate) {
    values.push(startDate);
    filters.push(`meal_date >= $${values.length}`);
  }

  if (endDate) {
    values.push(endDate);
    filters.push(`meal_date <= $${values.length}`);
  }

  if (createdByUserId) {
    values.push(createdByUserId);
    filters.push(`created_by_user_id = $${values.length}`);
  }

  const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const { rows } = await pool.query(
    `
      SELECT
        COALESCE(SUM(amount), 0) AS total_amount,
        COUNT(DISTINCT meal_date) AS days_count,
        COUNT(*) AS entries_count
      FROM meal_entries
      ${whereClause}
    `,
    values
  );

  const dbSummary = {
    totalAmount: Number(rows[0]?.total_amount || 0),
    daysCount: Number(rows[0]?.days_count || 0),
    entriesCount: Number(rows[0]?.entries_count || 0)
  };

  if (!includeLegacy) {
    return dbSummary;
  }

  const legacySummary = getLegacyActSummary(startDate, endDate);
  return {
    totalAmount: Number((dbSummary.totalAmount + legacySummary.totalAmount).toFixed(2)),
    daysCount: legacySummary.hasLegacyData && legacySummary.daysCount == null ? null : dbSummary.daysCount + Number(legacySummary.daysCount || 0),
    entriesCount: dbSummary.entriesCount + Number(legacySummary.entriesCount || 0)
  };
}

async function getMonthlyActSummary(month, year) {
  const { startDate, endDate } = getMonthRange(month, year);
  return getActSummaryForPeriod(startDate, endDate);
}

async function getActSummaryForPeriod(startDate, endDate) {
  const [summary, legacySummary] = await Promise.all([
    getMealSummary({ startDate, endDate }),
    Promise.resolve(getLegacyActSummary(startDate, endDate))
  ]);

  const hasUnknownLegacyDays = legacySummary.hasLegacyData && legacySummary.daysCount == null;
  const totalAmount = Number((summary.totalAmount + legacySummary.totalAmount).toFixed(2));
  const daysCount = hasUnknownLegacyDays
    ? null
    : Number(summary.daysCount || 0) + Number(legacySummary.daysCount || 0);

  return {
    ...summary,
    totalAmount,
    daysCount,
    entriesCount: Number(summary.entriesCount || 0) + Number(legacySummary.entriesCount || 0),
    hasLegacyData: legacySummary.hasLegacyData,
    startDate,
    endDate
  };
}

module.exports = {
  DAILY_LIMIT,
  assertDailyLimit,
  createMealEntry,
  deleteMealEntry,
  getEmployeeSpentForDate,
  getMealEntryById,
  getActSummaryForPeriod,
  getMealSummary,
  getMonthlyActSummary,
  listMealEntries,
  updateMealEntry
};
