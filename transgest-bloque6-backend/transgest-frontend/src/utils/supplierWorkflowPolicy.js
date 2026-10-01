export function shouldSendSupplierWorkflow({ requested = false, supplierId, email, hasPrice }) {
  return requested === true && !!supplierId && !!String(email || "").trim() && !!hasPrice;
}
