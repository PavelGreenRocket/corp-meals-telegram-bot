const { formatDateRu, formatDateShort } = require("./dateHelpers");
const { formatAmount } = require("./money");

function abbreviateFullName(fullName) {
  const parts = String(fullName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!parts.length) {
    return "Без имени";
  }

  if (parts.length === 1) {
    return parts[0];
  }

  const [lastName, firstName] = parts;
  return `${lastName} ${firstName[0]}.`;
}

function formatMealRowButton(entry) {
  return `${formatDateShort(entry.meal_date)} | ${abbreviateFullName(entry.employee_name)} | ${formatAmount(
    entry.amount
  )} ₽`;
}

function formatAdvanceRowButton(entry) {
  return `${formatDateShort(entry.payment_date)} | Аванс | ${formatAmount(entry.amount)} ₽`;
}

function formatOperationLine(operation) {
  const comment = operation.comment ? `, комментарий: ${operation.comment}` : "";
  const employee = operation.employee_name ? `, сотрудник: ${operation.employee_name}` : "";
  const date = operation.operation_date || operation.meal_date || operation.payment_date;
  const title = operation.operation_type === "advance" ? "Аванс" : "Питание";

  return `${formatDateRu(date)} | ${title} | ${formatAmount(operation.amount)} ₽${employee}${comment}`;
}

module.exports = {
  abbreviateFullName,
  formatAdvanceRowButton,
  formatMealRowButton,
  formatOperationLine
};
