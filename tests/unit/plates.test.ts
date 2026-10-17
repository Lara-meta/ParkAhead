import { it, expect } from "vitest";
import { normalizePlate, plateSchema } from "../../lib/plates";
it.each([
  [" abc-0123 ", "ABC0123"],
  ["00-a 01", "00A01"],
  ["O0", "O0"],
  ["AB\t12", "AB12"],
])("normalizes %s without OCR correction", (input, value) =>
  expect(normalizePlate(input)).toBe(value),
);
it.each(["", " -- ", "A", "AB!12", "AB/12", "ÅB12", "A".repeat(17)])(
  "rejects unsupported plate %s",
  (input) => expect(plateSchema.safeParse(input).success).toBe(false),
);
it("supports explicit prototype length bounds", () =>
  expect(normalizePlate("001", { min: 3, max: 3 })).toBe("001"));
