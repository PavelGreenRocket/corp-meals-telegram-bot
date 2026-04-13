const { getClientById } = require("./clientService");
const {
  getMonthlyMealsEntries,
  getMonthlyMealsSummary
} = require("./operationService");
const { generateRegistryXlsx } = require("../docs/generateRegistryXlsx");

async function generateMonthlyRegistry({ clientId, month, year }) {
  const client = await getClientById(clientId);
  if (!client) {
    throw new Error("Клиент не найден");
  }

  const entries = await getMonthlyMealsEntries(clientId, month, year);
  const summary = await getMonthlyMealsSummary(clientId, month, year);

  const filePath = await generateRegistryXlsx({
    client,
    month,
    year,
    entries,
    totalAmount: summary.totalAmount,
    daysCount: summary.daysCount
  });

  return {
    filePath,
    client,
    entries,
    summary
  };
}

module.exports = {
  generateMonthlyRegistry
};
