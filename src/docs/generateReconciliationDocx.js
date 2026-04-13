const fs = require("fs");
const path = require("path");
const {
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  WidthType,
  AlignmentType
} = require("docx");
const config = require("../config");
const { formatDateRu } = require("../utils/dates");
const { formatAmount } = require("../utils/money");

function sanitizeFileName(text) {
  return String(text).replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, "_");
}

async function generateReconciliationDocx(data) {
  const rows = [
    new TableRow({
      children: [
        new TableCell({ children: [new Paragraph("Дата")] }),
        new TableCell({ children: [new Paragraph("Документ / операция")] }),
        new TableCell({ children: [new Paragraph("Начислено")] }),
        new TableCell({ children: [new Paragraph("Оплачено")] }),
        new TableCell({ children: [new Paragraph("Сальдо")] })
      ]
    })
  ];

  for (const row of data.rows) {
    rows.push(
      new TableRow({
        children: [
          new TableCell({
            children: [new Paragraph(formatDateRu(row.date))]
          }),
          new TableCell({
            children: [new Paragraph(row.document)]
          }),
          new TableCell({
            children: [new Paragraph(row.charged ? formatAmount(row.charged) : "")]
          }),
          new TableCell({
            children: [new Paragraph(row.paid ? formatAmount(row.paid) : "")]
          }),
          new TableCell({
            children: [new Paragraph(formatAmount(row.balanceAfter))]
          })
        ]
      })
    );
  }

  const document = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            text: "Акт сверки взаимных расчетов"
          }),
          new Paragraph({
            text: `Период: ${formatDateRu(data.periodStart)} - ${formatDateRu(
              data.periodEnd
            )}`
          }),
          new Paragraph({
            text: `Исполнитель: Исполнитель`
          }),
          new Paragraph({
            text: `Заказчик: ${data.client.legal_name}`
          }),
          new Paragraph({
            text: `Сальдо на начало периода: ${formatAmount(
              data.openingBalance
            )} руб.`
          }),
          new Paragraph({ text: "" }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows
          }),
          new Paragraph({ text: "" }),
          new Paragraph({
            text: `Итого начислено: ${formatAmount(data.chargedTotal)} руб.`
          }),
          new Paragraph({
            text: `Итого оплачено: ${formatAmount(data.paidTotal)} руб.`
          }),
          new Paragraph({
            text: `Сальдо на конец периода: ${formatAmount(
              data.closingBalance
            )} руб.`
          }),
          new Paragraph({ text: "" }),
          new Paragraph({
            text: "Исполнитель: ____________________"
          }),
          new Paragraph({
            text: "Заказчик: ____________________"
          })
        ]
      }
    ]
  });

  const buffer = await Packer.toBuffer(document);
  const fileName = sanitizeFileName(
    `reconciliation_${data.client.short_name}_${data.periodStart}_${data.periodEnd}.docx`
  );
  const filePath = path.join(config.generatedDir, fileName);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

module.exports = {
  generateReconciliationDocx
};
