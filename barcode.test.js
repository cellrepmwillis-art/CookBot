import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { barcodeKeys } from "./barcode.js";
import { setFoods, findByBarcode } from "./foods.js";

test("UPC-A and EAN-13 forms of a code match", () => {
  assert.deepEqual(barcodeKeys("850075778676"), barcodeKeys("0850075778676"));
});

test("8-digit UPC-E codes also try their UPC-A expansion", () => {
  // The textbook example: UPC-E 04252614 is UPC-A 042100005264.
  assert.ok(barcodeKeys("04252614").includes("42100005264"));
});

const hasBranded = existsSync(new URL("./branded.json", import.meta.url));

test("scanned codes find branded products", { skip: !hasBranded && "branded.json not built yet" }, () => {
  setFoods(JSON.parse(readFileSync(new URL("./branded.json", import.meta.url))));
  const food = findByBarcode(barcodeKeys("0850075778676"));
  assert.equal(food?.[0], "Barebells Berry Milkshake");
  assert.equal(findByBarcode(barcodeKeys("0000000000000")), undefined);
});
