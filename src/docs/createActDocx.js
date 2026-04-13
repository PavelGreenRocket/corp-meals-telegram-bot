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
const { amountToWords, formatAmount } = require("../utils/money");
const { formatDateRu, monthYearLabel } = require("../utils/dateHelpers");

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
  const parts = [`${title}: ${name}`, party.inn ? `ИНН ${party.inn}` : "", party.kpp ? `КПП ${party.kpp}` : ""].filter(Boolean);

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

async function createActDocx(filePath, data) {
  const totalAmount = formatAmount(data.totalAmount);
  const totalAmountWords = amountToWords(data.totalAmount);
  const periodText = data.periodLabel || monthYearLabel(data.month, data.year);
  const serviceDescription = data.serviceDescription || "Организация питания сотрудников";
  const daysCountText = data.daysCountDisplay || String(data.daysCount ?? "-");

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
          paragraph(`АКТ выполненных работ № ${data.actNumber}`, {
            alignment: AlignmentType.CENTER,
            bold: true,
            after: 80,
            line: 280
          }),
          paragraph(`от ${formatDateRu(data.actDate)} г.`, {
            alignment: AlignmentType.CENTER,
            after: 40,
            line: 280
          }),
          paragraph(`за ${periodText}`, {
            alignment: AlignmentType.CENTER,
            after: 320,
            line: 280
          }),
          paragraph(formatPartyLine("Исполнитель", data.performer), { after: 100 }),
          paragraph(formatPartyLine("Заказчик", data.customer), { after: 260 }),
          paragraph(
            "Мы, нижеподписавшиеся, составили настоящий акт о том, что Исполнитель оказал, а Заказчик принял следующие услуги:",
            { after: 220 }
          ),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  new TableCell({ width: { size: 5, type: WidthType.PERCENTAGE }, children: [tableParagraph("№", { bold: true })] }),
                  new TableCell({ width: { size: 62, type: WidthType.PERCENTAGE }, children: [tableParagraph("Наименование услуг", { bold: true })] }),
                  new TableCell({ width: { size: 10, type: WidthType.PERCENTAGE }, children: [tableParagraph("Ед. изм.", { bold: true })] }),
                  new TableCell({ width: { size: 9, type: WidthType.PERCENTAGE }, children: [tableParagraph("Кол-во", { bold: true })] }),
                  new TableCell({ width: { size: 14, type: WidthType.PERCENTAGE }, children: [tableParagraph("Сумма, руб.", { bold: true })] })
                ]
              }),
              new TableRow({
                children: [
                  new TableCell({ width: { size: 5, type: WidthType.PERCENTAGE }, children: [tableParagraph("1")] }),
                  new TableCell({
                    width: { size: 62, type: WidthType.PERCENTAGE },
                    children: [tableParagraph(serviceDescription)]
                  }),
                  new TableCell({ width: { size: 10, type: WidthType.PERCENTAGE }, children: [tableParagraph("дней")] }),
                  new TableCell({ width: { size: 9, type: WidthType.PERCENTAGE }, children: [tableParagraph(daysCountText)] }),
                  new TableCell({ width: { size: 14, type: WidthType.PERCENTAGE }, children: [tableParagraph(totalAmount)] })
                ]
              })
            ]
          }),
          paragraph(`Итого: ${totalAmount} руб.`, { before: 220, after: 80 }),
          paragraph(data.vatText, { after: 80 }),
          paragraph(`Количество дней питания: ${daysCountText}.`, { after: 80 }),
          paragraph(`Всего оказано услуг на сумму: ${totalAmountWords}.`, { after: 80 }),
          paragraph("Заказчик претензий по срокам, качеству и объёму оказанных услуг не имеет.", { after: 80 }),
          paragraph(
            "Настоящий акт составлен в двух экземплярах, имеющих одинаковую юридическую силу, по одному для каждой из сторон.",
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
  createActDocx
};
