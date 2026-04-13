const dayjs = require("dayjs");
const pool = require("../db/pool");
const { getClientById } = require("./clientService");

async function buildReconciliationData(clientId, startDate, endDate, mode = "full_history") {
  const client = await getClientById(clientId);
  if (!client) {
    throw new Error("Клиент не найден");
  }

  const normalizedEnd = endDate || dayjs().format("YYYY-MM-DD");
  let periodStart = startDate;
  let periodEnd = normalizedEnd;

  if (mode === "full_history") {
    const firstOperation = await pool.query(
      "SELECT MIN(operation_date) AS min_date FROM food_operations WHERE client_id = $1",
      [clientId]
    );
    periodStart = firstOperation.rows[0].min_date || normalizedEnd;
    periodEnd = normalizedEnd;
  }

  if (!periodStart || !periodEnd) {
    throw new Error("Для сверки за период укажите даты начала и конца");
  }

  const openingResult = await pool.query(
    `
      SELECT
        COALESCE(SUM(CASE WHEN operation_type = 'advance' THEN amount ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN operation_type = 'meal' THEN amount ELSE 0 END), 0) AS opening_balance
      FROM food_operations
      WHERE client_id = $1
        AND operation_date < $2
    `,
    [clientId, periodStart]
  );

  const openingBalance = Number(openingResult.rows[0].opening_balance || 0);

  const operationsResult = await pool.query(
    `
      SELECT id, operation_type, operation_date, amount, persons_count, comment
      FROM food_operations
      WHERE client_id = $1
        AND operation_date BETWEEN $2 AND $3
      ORDER BY operation_date ASC, id ASC
    `,
    [clientId, periodStart, periodEnd]
  );

  let runningBalance = openingBalance;

  const rows = operationsResult.rows.map((operation) => {
    const charged = operation.operation_type === "meal" ? Number(operation.amount) : 0;
    const paid = operation.operation_type === "advance" ? Number(operation.amount) : 0;
    runningBalance = Number((runningBalance + paid - charged).toFixed(2));

    const operationTitle =
      operation.operation_type === "advance" ? "Поступление аванса" : "Начисление питания";
    const document = operation.comment
      ? `${operationTitle} (${operation.comment})`
      : operationTitle;

    return {
      date: operation.operation_date,
      document,
      charged,
      paid,
      balanceAfter: runningBalance
    };
  });

  const chargedTotal = Number(
    rows.reduce((sum, row) => sum + row.charged, 0).toFixed(2)
  );
  const paidTotal = Number(rows.reduce((sum, row) => sum + row.paid, 0).toFixed(2));
  const closingBalance = Number((openingBalance + paidTotal - chargedTotal).toFixed(2));

  return {
    client,
    mode,
    periodStart,
    periodEnd,
    openingBalance,
    rows,
    chargedTotal,
    paidTotal,
    closingBalance
  };
}

module.exports = {
  buildReconciliationData
};
