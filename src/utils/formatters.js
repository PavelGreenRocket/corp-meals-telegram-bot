const { formatDateRu } = require("./dates");
const { formatAmount } = require("./money");

function formatOperationType(type) {
  if (type === "advance") {
    return "Аванс";
  }
  if (type === "meal") {
    return "Питание";
  }
  return type;
}

function formatOperationLine(operation) {
  const persons = operation.persons_count ? `, питающихся: ${operation.persons_count}` : "";
  const comment = operation.comment ? `, комментарий: ${operation.comment}` : "";
  return `${formatDateRu(operation.operation_date)} | ${formatOperationType(operation.operation_type)} | ${formatAmount(operation.amount)}${persons}${comment}`;
}

module.exports = {
  formatOperationType,
  formatOperationLine
};
