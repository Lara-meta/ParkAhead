import { z } from "zod";
export const plateBounds = { min: 2, max: 16 };
// Transport limit only; configured length and normalization are enforced by SQL.
export const plateInputSchema = z.string().min(1).max(128);
export function normalizePlate(input: string, bounds = plateBounds): string {
  const value = input.replace(/[\s-]/g, "").toUpperCase();
  if (
    !/^[A-Z0-9]+$/.test(value) ||
    value.length < bounds.min ||
    value.length > bounds.max
  )
    throw new Error(
      `Use ${bounds.min}–${bounds.max} letters or digits; spaces and hyphens are allowed.`,
    );
  return value;
}
export const plateSchema = z.string().transform((value, ctx) => {
  try {
    return normalizePlate(value);
  } catch {
    ctx.addIssue({
      code: "custom",
      message: "Enter 2–16 letters or digits, with optional spaces or hyphens.",
    });
    return z.NEVER;
  }
});
