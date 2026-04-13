const pool = require("../db/pool");
const queries = require("../db/queries");
const { getMonthRange } = require("../utils/dates");

async function createOperation({
  clientId,
  operationType,
  operationDate,
  amount,
  personsCount = null,
  comment = null
}) {
  const { rows } = await pool.query(queries.operations.create, [
    clientId,
    operationType,
    operationDate,
    amount,
    personsCount,
    comment
  ]);
  return rows[0];
}

async function listClientOperations(clientId, limit = 20) {
  const { rows } = await pool.query(queries.operations.byClient, [clientId, limit]);
  return rows;
}

async function calculateClientBalance(clientId) {
  const sql = `
    SELECT
      COALESCE(SUM(CASE WHEN operation_type = 'advance' THEN amount ELSE 0 END), 0) AS total_paid,
      COALESCE(SUM(CASE WHEN operation_type = 'meal' THEN amount ELSE 0 END), 0) AS total_charged
    FROM food_operations
    WHERE client_id = $1
  `;
  const { rows } = await pool.query(sql, [clientId]);
  const totalPaid = Number(rows[0].total_paid || 0);
  const totalCharged = Number(rows[0].total_charged || 0);
  return {
    totalPaid,
    totalCharged,
    balance: Number((totalPaid - totalCharged).toFixed(2))
  };
}

async function getMonthlyMealsSummary(clientId, month, year) {
  const { startDate, endDate } = getMonthRange(month, year);
  const sql = `
    SELECT
      COALESCE(SUM(amount), 0) AS total_amount,
      COUNT(DISTINCT operation_date) AS days_count
    FROM food_operations
    WHERE client_id = $1
      AND operation_type = 'meal'
      AND operation_date BETWEEN $2 AND $3
  `;

  const { rows } = await pool.query(sql, [clientId, startDate, endDate]);
  return {
    startDate,
    endDate,
    totalAmount: Number(rows[0].total_amount || 0),
    daysCount: Number(rows[0].days_count || 0)
  };
}

async function getMonthlyMealsEntries(clientId, month, year) {
  const { startDate, endDate } = getMonthRange(month, year);
  const sql = `
    SELECT id, operation_date, amount, persons_count, comment
    FROM food_operations
    WHERE client_id = $1
      AND operation_type = 'meal'
      AND operation_date BETWEEN $2 AND $3
    ORDER BY operation_date ASC, id ASC
  `;
  const { rows } = await pool.query(sql, [clientId, startDate, endDate]);
  return rows;
}

module.exports = {
  createOperation,
  listClientOperations,
  calculateClientBalance,
  getMonthlyMealsSummary,
  getMonthlyMealsEntries
};
