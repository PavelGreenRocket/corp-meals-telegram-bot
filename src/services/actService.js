const dayjs = require("dayjs");
const pool = require("../db/pool");
const config = require("../config");
const { getClientById } = require("./clientService");
const { getMonthlyMealsSummary } = require("./operationService");
const { generateActDocx } = require("../docs/generateActDocx");

async function generateMonthlyAct({ clientId, month, year }) {
  const client = await getClientById(clientId);
  if (!client) {
    throw new Error("Клиент не найден");
  }

  const summary = await getMonthlyMealsSummary(clientId, month, year);
  const actDate = dayjs().format("YYYY-MM-DD");
  const actNumber = `АКТ-${year}${String(month).padStart(2, "0")}-${clientId}-${Date.now()
    .toString()
    .slice(-5)}`;

  const filePath = await generateActDocx({
    actNumber,
    actDate,
    month,
    year,
    performerName: config.performerName,
    client,
    daysCount: summary.daysCount,
    totalAmount: summary.totalAmount
  });

  await pool.query(
    `
      INSERT INTO monthly_acts (
        client_id, act_number, act_month, act_year, act_date, days_count, total_amount, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'generated')
    `,
    [
      clientId,
      actNumber,
      month,
      year,
      actDate,
      summary.daysCount,
      summary.totalAmount
    ]
  );

  return {
    filePath,
    actNumber,
    actDate,
    summary,
    client
  };
}

module.exports = {
  generateMonthlyAct
};
