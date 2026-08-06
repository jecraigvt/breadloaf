import assert from "node:assert/strict";
import test from "node:test";
import {
  applyTypeSpecificExtraction,
  intakeDeepPassGuidance,
} from "./document-intake";

test("receipts get a materially different deep pass from historical photos", () => {
  assert.match(intakeDeepPassGuidance("receipt_invoice"), /sales tax/i);
  assert.match(intakeDeepPassGuidance("receipt_invoice"), /subtotal/i);
  assert.doesNotMatch(intakeDeepPassGuidance("historical_photo"), /sales tax/i);
  assert.match(intakeDeepPassGuidance("historical_photo"), /approximate era/i);
});

test("structured receipt facts become exact searchable text", () => {
  const result = applyTypeSpecificExtraction(
    {
      extractedText: "Sectional sofa and delivery.",
      maintenanceVendor: "Big Barn Home Furnishings",
      maintenanceDate: "2026-07-14",
      receiptSubtotal: 2879.94,
      receiptSalesTax: 193,
      receiptTotal: 3072.94,
    },
    "receipt_invoice"
  );

  assert.match(result.extractedText, /Vendor: Big Barn Home Furnishings/);
  assert.match(result.extractedText, /Purchase date: 2026-07-14/);
  assert.match(result.extractedText, /Subtotal: \$2879\.94/);
  assert.match(result.extractedText, /Sales tax: \$193\.00/);
  assert.match(result.extractedText, /Total: \$3072\.94/);
  assert.equal(result.intakeType, "receipt_invoice");
});
