const path = require("path");
const ExcelJS = require("exceljs");
const config = require("../config");
const { formatDateRu, monthNameRu } = require("../utils/dates");
const { formatAmount } = require("../utils/money");

function sanitizeFileName(text) {
  return String(text).replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, "_");
}

async function generateRegistryXlsx(data) {
  const workbook = new ExcelJS.Workbook();
  const registrySheet = workbook.addWorksheet("Реестр");
  const summarySheet = workbook.addWorksheet("Сводка");

  registrySheet.columns = [
    { header: "Дата", key: "date", width: 16 },
    { header: "Сумма", key: "amount", width: 16 },
    { header: "Кол-во питающихся", key: "persons", width: 22 },
    { header: "Комментарий", key: "comment", width: 45 }
  ];

  data.entries.forEach((entry) => {
    registrySheet.addRow({
      date: formatDateRu(entry.operation_date),
      amount: Number(entry.amount),
      persons: entry.persons_count || "",
      comment: entry.comment || ""
    });
  });

  registrySheet.getColumn("amount").numFmt = "#,##0.00";
  registrySheet.addRow({});
  registrySheet.addRow({
    date: "Итого",
    amount: Number(data.totalAmount),
    persons: `${data.daysCount} уник. дней`
  });

  summarySheet.columns = [
    { header: "Параметр", key: "name", width: 32 },
    { header: "Значение", key: "value", width: 42 }
  ];

  summarySheet.addRow({
    name: "Клиент",
    value: data.client.legal_name
  });
  summarySheet.addRow({
    name: "Период",
    value: `${monthNameRu(data.month)} ${data.year}`
  });
  summarySheet.addRow({
    name: "Итого сумма",
    value: `${formatAmount(data.totalAmount)} руб.`
  });
  summarySheet.addRow({
    name: "Уникальных дней питания",
    value: data.daysCount
  });
  summarySheet.addRow({
    name: "Количество записей",
    value: data.entries.length
  });

  const fileName = sanitizeFileName(
    `registry_${data.client.short_name}_${data.year}_${String(data.month).padStart(
      2,
      "0"
    )}.xlsx`
  );
  const filePath = path.join(config.generatedDir, fileName);
  await workbook.xlsx.writeFile(filePath);
  return filePath;
}

module.exports = {
  generateRegistryXlsx
};
