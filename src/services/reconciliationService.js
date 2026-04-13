const pool = require("../db/pool");
const { buildReconciliationData } = require("./reportService");
const {
  generateReconciliationDocx
} = require("../docs/generateReconciliationDocx");

async function generateReconciliationReport({
  clientId,
  startDate = null,
  endDate = null,
  mode = "full_history"
}) {
  const data = await buildReconciliationData(
    clientId,
    startDate,
    endDate,
    mode
  );

  const filePath = await generateReconciliationDocx(data);

  await pool.query(
    `
      INSERT INTO reconciliation_snapshots (
        client_id,
        period_start,
        period_end,
        opening_balance,
        charged_total,
        paid_total,
        closing_balance
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [
      clientId,
      data.periodStart,
      data.periodEnd,
      data.openingBalance,
      data.chargedTotal,
      data.paidTotal,
      data.closingBalance
    ]
  );

  return {
    ...data,
    filePath
  };
}

module.exports = {
  generateReconciliationReport
};
