// Generador de remesa SEPA de transferencias (pain.001.001.03).
// Puro, sin dependencias de BD: recibe la cuenta ordenante y los pagos.
// El fichero generado debe validarse con el banco antes del primer uso real.

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// SEPA admite un subconjunto de caracteres latinos; limpiamos el resto.
function sepaText(value, maxLength) {
  const cleaned = String(value ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9/\-?:().,'+ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, maxLength);
}

function cleanIban(value) {
  return String(value || "").replace(/\s+/g, "").toUpperCase();
}

// Convierte un importe (hasta 6 decimales en texto) a céntimos exactos (BigInt).
function amountToCents(value) {
  const [whole, fraction = ""] = String(value ?? "0").split(".");
  const micro = (BigInt(whole || "0") * 1000000n) + BigInt((fraction + "000000").slice(0, 6));
  return (micro + 5000n) / 10000n; // redondeo a céntimo (half up)
}

function centsToAmount(cents) {
  const value = BigInt(cents);
  const euros = value / 100n;
  const rem = value % 100n;
  return `${euros}.${String(rem).padStart(2, "0")}`;
}

function agentXml(bic) {
  const clean = String(bic || "").replace(/\s+/g, "").toUpperCase();
  if (clean) return `<FinInstnId><BIC>${xmlEscape(clean)}</BIC></FinInstnId>`;
  return `<FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId>`;
}

function buildCreditTransferXml(input = {}) {
  const payments = (Array.isArray(input.payments) ? input.payments : [])
    .map((p, idx) => ({
      endToEndId: sepaText(p.endToEndId || `E2E${idx + 1}`, 35) || `E2E${idx + 1}`,
      cents: amountToCents(p.amount),
      creditorName: sepaText(p.creditorName, 70) || "ACREEDOR",
      creditorIban: cleanIban(p.creditorIban),
      creditorBic: p.creditorBic || "",
      remittanceInfo: sepaText(p.remittanceInfo, 140),
    }))
    .filter(p => p.creditorIban && p.cents > 0n);

  if (!payments.length) {
    const error = new Error("No hay pagos con IBAN de acreedor e importe válidos para generar la remesa SEPA");
    error.status = 422;
    throw error;
  }

  const debtorIban = cleanIban(input.debtorIban);
  if (!debtorIban) {
    const error = new Error("La cuenta bancaria ordenante no tiene IBAN");
    error.status = 422;
    throw error;
  }

  const nbOfTxs = payments.length;
  const ctrlCents = payments.reduce((sum, p) => sum + p.cents, 0n);
  const ctrlSum = centsToAmount(ctrlCents);
  const creationDateTime = input.creationDateTime || new Date().toISOString().replace(/\.\d{3}Z$/, "");
  const messageId = sepaText(input.messageId || `MSG${Date.now()}`, 35);
  const paymentInfoId = sepaText(input.paymentInfoId || messageId, 35);
  const reqExecDate = input.requestedExecutionDate || new Date().toISOString().slice(0, 10);
  const initiatingParty = sepaText(input.initiatingPartyName || input.debtorName, 70) || "EMPRESA";
  const debtorName = sepaText(input.debtorName, 70) || initiatingParty;

  const txXml = payments.map(p => `
      <CdtTrfTxInf>
        <PmtId><EndToEndId>${xmlEscape(p.endToEndId)}</EndToEndId></PmtId>
        <Amt><InstdAmt Ccy="EUR">${centsToAmount(p.cents)}</InstdAmt></Amt>
        <CdtrAgt>${agentXml(p.creditorBic)}</CdtrAgt>
        <Cdtr><Nm>${xmlEscape(p.creditorName)}</Nm></Cdtr>
        <CdtrAcct><Id><IBAN>${xmlEscape(p.creditorIban)}</IBAN></Id></CdtrAcct>
        ${p.remittanceInfo ? `<RmtInf><Ustrd>${xmlEscape(p.remittanceInfo)}</Ustrd></RmtInf>` : ""}
      </CdtTrfTxInf>`).join("");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <CstmrCdtTrfInitn>
    <GrpHdr>
      <MsgId>${xmlEscape(messageId)}</MsgId>
      <CreDtTm>${xmlEscape(creationDateTime)}</CreDtTm>
      <NbOfTxs>${nbOfTxs}</NbOfTxs>
      <CtrlSum>${ctrlSum}</CtrlSum>
      <InitgPty><Nm>${xmlEscape(initiatingParty)}</Nm></InitgPty>
    </GrpHdr>
    <PmtInf>
      <PmtInfId>${xmlEscape(paymentInfoId)}</PmtInfId>
      <PmtMtd>TRF</PmtMtd>
      <BtchBookg>true</BtchBookg>
      <NbOfTxs>${nbOfTxs}</NbOfTxs>
      <CtrlSum>${ctrlSum}</CtrlSum>
      <PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl></PmtTpInf>
      <ReqdExctnDt>${xmlEscape(reqExecDate)}</ReqdExctnDt>
      <Dbtr><Nm>${xmlEscape(debtorName)}</Nm></Dbtr>
      <DbtrAcct><Id><IBAN>${xmlEscape(debtorIban)}</IBAN></Id></DbtrAcct>
      <DbtrAgt>${agentXml(input.debtorBic)}</DbtrAgt>
      <ChrgBr>SLEV</ChrgBr>${txXml}
    </PmtInf>
  </CstmrCdtTrfInitn>
</Document>`;

  return { xml, nbOfTxs, ctrlSum };
}

module.exports = { buildCreditTransferXml, amountToCents, centsToAmount, sepaText };
