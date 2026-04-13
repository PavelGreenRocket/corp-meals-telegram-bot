const fs = require("fs");
const path = require("path");
const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableCell,
  TableRow,
  WidthType,
  AlignmentType
} = require("docx");
const config = require("../config");
const { monthNameRu, formatDateRu } = require("../utils/dates");
const { formatAmount } = require("../utils/money");

function sanitizeFileName(text) {
  return String(text).replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, "_");
}

async function generateActDocx(data) {
  const monthName = monthNameRu(data.month);
  const periodText = `${monthName} ${data.year}`;
  const totalAmount = formatAmount(data.totalAmount);

  const document = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({
                text: `Акт оказанных услуг № ${data.actNumber}`,
                bold: true
              })
            ]
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            text: `за ${periodText}`
          }),
          new Paragraph({
            text: `Дата акта: ${formatDateRu(data.actDate)}`
          }),
          new Paragraph({
            text: `Исполнитель: ${data.performerName}`
          }),
          new Paragraph({
            text: `Заказчик: ${data.client.legal_name}`
          }),
          new Paragraph({ text: "" }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph("№")] }),
                  new TableCell({ children: [new Paragraph("Наименование услуги")] }),
                  new TableCell({ children: [new Paragraph("Ед. изм.")] }),
                  new TableCell({ children: [new Paragraph("Кол-во")] }),
                  new TableCell({ children: [new Paragraph("Сумма, руб.")] })
                ]
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph("1")] }),
                  new TableCell({
                    children: [
                      new Paragraph(
                        `Организация питания сотрудников за ${periodText}`
                      )
                    ]
                  }),
                  new TableCell({ children: [new Paragraph("дней")] }),
                  new TableCell({
                    children: [new Paragraph(String(data.daysCount))]
                  }),
                  new TableCell({ children: [new Paragraph(totalAmount)] })
                ]
              })
            ]
          }),
          new Paragraph({ text: "" }),
          new Paragraph({
            text: `Итого: ${totalAmount} руб.`
          }),
          new Paragraph({
            text: "НДС не облагается."
          }),
          new Paragraph({
            text: `Всего оказано услуг на сумму ${totalAmount} руб.`
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
    `act_${data.client.short_name}_${data.year}_${String(data.month).padStart(
      2,
      "0"
    )}.docx`
  );
  const filePath = path.join(config.generatedDir, fileName);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

module.exports = {
  generateActDocx
};
