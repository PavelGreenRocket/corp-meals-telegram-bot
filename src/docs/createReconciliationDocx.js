const fs = require("fs");
const {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType
} = require("docx");
const { formatAmount } = require("../utils/money");
const { formatDateRu } = require("../utils/dateHelpers");

function borderlessCell(children, width, options = {}) {
  return new TableCell({
    width: { size: width, type: WidthType.PERCENTAGE },
    margins: {
      top: options.marginTop ?? 80,
      bottom: options.marginBottom ?? 80,
      left: options.marginLeft ?? 80,
      right: options.marginRight ?? 80
    },
    borders: {
      top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }
    },
    children: Array.isArray(children) ? children : [new Paragraph(children)]
  });
}

function formatPartyLine(title, party) {
  const shortName = String(party.shortName || "").trim();
  const name = /^ИП\s+/i.test(shortName) ? shortName : party.legalName || shortName;
  const parts = [`${title}: ${name}`];

  if (party.inn) {
    parts.push(`ИНН ${party.inn}`);
  }

  if (party.kpp) {
    parts.push(`КПП ${party.kpp}`);
  }

  return parts.join(", ");
}

function paragraph(text, options = {}) {
  return new Paragraph({
    alignment: options.alignment || AlignmentType.LEFT,
    spacing: {
      before: options.before ?? 0,
      after: options.after ?? 120,
      line: options.line ?? 276
    },
    children: [new TextRun({ text, bold: Boolean(options.bold) })]
  });
}

function tableParagraph(text, options = {}) {
  return new Paragraph({
    alignment: options.alignment || AlignmentType.LEFT,
    spacing: {
      before: options.before ?? 0,
      after: options.after ?? 0,
      line: options.line ?? 240
    },
    children: [new TextRun({ text, bold: Boolean(options.bold) })]
  });
}

function signatureBlockCell({ title, name, signerLabel, showStamp = false }) {
  return borderlessCell(
    [
      paragraph(title, { bold: true, after: 140 }),
      paragraph(name, { after: 260 }),
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: [
              borderlessCell([tableParagraph("____________________")], 50, { marginLeft: 0, marginRight: 30 }),
              borderlessCell([tableParagraph(signerLabel)], showStamp ? 32 : 50, { marginLeft: 0, marginRight: 30 }),
              ...(showStamp ? [borderlessCell([tableParagraph("М.П.")], 18, { marginLeft: 0, marginRight: 0 })] : [])
            ]
          })
        ]
      })
    ],
    50,
    { marginLeft: 0, marginRight: 0 }
  );
}

async function createReconciliationDocx(filePath, data) {
  const rows = [
    new TableRow({
      children: [
        new TableCell({ width: { size: 15, type: WidthType.PERCENTAGE }, children: [tableParagraph("Дата", { bold: true })] }),
        new TableCell({ width: { size: 45, type: WidthType.PERCENTAGE }, children: [tableParagraph("Документ", { bold: true })] }),
        new TableCell({ width: { size: 20, type: WidthType.PERCENTAGE }, children: [tableParagraph("Начислено, руб.", { bold: true })] }),
        new TableCell({ width: { size: 20, type: WidthType.PERCENTAGE }, children: [tableParagraph("Оплачено, руб.", { bold: true })] })
      ]
    }),
    ...data.rows.map(
      (row) =>
        new TableRow({
          children: [
            new TableCell({ width: { size: 15, type: WidthType.PERCENTAGE }, children: [tableParagraph(formatDateRu(row.date))] }),
            new TableCell({ width: { size: 45, type: WidthType.PERCENTAGE }, children: [tableParagraph(row.document)] }),
            new TableCell({ width: { size: 20, type: WidthType.PERCENTAGE }, children: [tableParagraph(row.charged ? formatAmount(row.charged) : "")] }),
            new TableCell({ width: { size: 20, type: WidthType.PERCENTAGE }, children: [tableParagraph(row.paid ? formatAmount(row.paid) : "")] })
          ]
        })
    )
  ];

  const document = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 900,
              right: 900,
              bottom: 900,
              left: 900
            }
          }
        },
        children: [
          paragraph("АКТ СВЕРКИ ВЗАИМНЫХ РАСЧЁТОВ", {
            alignment: AlignmentType.CENTER,
            bold: true,
            after: 80,
            line: 280
          }),
          paragraph("к расчётам по корпоративному питанию", {
            alignment: AlignmentType.CENTER,
            after: 260,
            line: 280
          }),
          paragraph(`Период сверки: ${formatDateRu(data.periodStart)} – ${formatDateRu(data.periodEnd)}`, { after: 100 }),
          paragraph(formatPartyLine("Исполнитель", data.performer), { after: 100 }),
          paragraph(formatPartyLine("Заказчик", data.customer), { after: 180 }),
          paragraph(`Сальдо на начало периода: ${formatAmount(data.openingBalance)} руб.`, { after: 220 }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows
          }),
          paragraph(`Итого начислено: ${formatAmount(data.chargedTotal)} руб.`, { before: 220, after: 80 }),
          paragraph(`Итого оплачено: ${formatAmount(data.paidTotal)} руб.`, { after: 80 }),
          paragraph(data.closingText, { after: 80 }),
          ...(data.note ? [paragraph(data.note, { after: 80 })] : []),
          paragraph(
            "Настоящий акт сверки составлен в двух экземплярах, имеющих равную юридическую силу, по одному для каждой из сторон.",
            { after: 360 }
          ),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  signatureBlockCell({
                    title: "ИСПОЛНИТЕЛЬ",
                    name: data.performer.signerName,
                    signerLabel: data.performer.signerLabel,
                    showStamp: false
                  }),
                  signatureBlockCell({
                    title: "ЗАКАЗЧИК",
                    name: data.customer.signerName,
                    signerLabel: data.customer.signerLabel,
                    showStamp: true
                  })
                ]
              })
            ]
          })
        ]
      }
    ]
  });

  const buffer = await Packer.toBuffer(document);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

module.exports = {
  createReconciliationDocx
};
