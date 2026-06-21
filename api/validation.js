import { z } from "zod";

export class ValidationError extends Error {
  constructor(error) {
    super(ValidationError.formatErrorMessage(error));
    this.name = "ValidationError";
  }

  static formatErrorMessage(error) {
    const issues = error.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "request body";
      return `${path}: ${issue.message}`;
    });
    return issues.join("; ");
  }
}

const nonEmptyString = z.string().trim().min(1, { message: "es requerido" });
const nonNegativeNumber = z.preprocess((value) => {
  if (typeof value === "string" && value.trim().length > 0) {
    return Number(value);
  }
  return value;
}, z.number({ invalid_type_error: "debe ser un número" }).nonnegative({ message: "debe ser mayor o igual a 0" }));

export const calculateScoreBodySchema = z.object({
  address: nonEmptyString.describe("Wallet requerida"),
  totalDeposited: nonNegativeNumber.optional(),
});

export const depositSchema = z.object({
  amount: nonNegativeNumber,
});

export const evaluateAndMintBodySchema = z.object({
  userAddress: nonEmptyString.describe("userAddress es requerido"),
  totalVolume: nonNegativeNumber.optional(),
  deposits: z.array(depositSchema).optional(),
});

export const getAvailableCreditBodySchema = z.object({
  userAddress: nonEmptyString.describe("userAddress es requerido"),
});

export const getUserDataQuerySchema = z.object({
  address: nonEmptyString.describe("address es requerido"),
});

export function validateBody(schema, data) {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new ValidationError(parsed.error);
  }
  return parsed.data;
}

export function validateQuery(schema, query) {
  const parsed = schema.safeParse(query);
  if (!parsed.success) {
    throw new ValidationError(parsed.error);
  }
  return parsed.data;
}

export function reportValidationError(res, error) {
  if (error instanceof ValidationError) {
    return res.status(400).json({ error: error.message, status: "error" });
  }
  return res.status(500).json({ error: error.message || "Internal server error", status: "error" });
}
