import { shouldSendSupplierWorkflow } from "./supplierWorkflowPolicy";

const assignedOrder = { supplierId: "supplier-1", email: "pedidos@example.invalid", hasPrice: true };

test("saving an assigned order never requests an email by itself", () => {
  expect(shouldSendSupplierWorkflow(assignedOrder)).toBe(false);
  expect(shouldSendSupplierWorkflow({ ...assignedOrder, requested: false })).toBe(false);
});

test("the explicit send action requires a supplier, recipient and agreed price", () => {
  expect(shouldSendSupplierWorkflow({ ...assignedOrder, requested: true })).toBe(true);
  expect(shouldSendSupplierWorkflow({ ...assignedOrder, requested: true, email: " " })).toBe(false);
  expect(shouldSendSupplierWorkflow({ ...assignedOrder, requested: true, hasPrice: false })).toBe(false);
  expect(shouldSendSupplierWorkflow({ ...assignedOrder, requested: true, supplierId: null })).toBe(false);
});
