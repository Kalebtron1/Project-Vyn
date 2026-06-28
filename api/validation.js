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

// Monto en USD (USDC desde la UI). Mínimo $5 = quote mínimo de BlindPay (500 centavos).
const usdAmount = z.preprocess((value) => {
  if (typeof value === "string" && value.trim().length > 0) return Number(value);
  return value;
}, z
  .number({ invalid_type_error: "debe ser un número" })
  .positive({ message: "debe ser mayor a 0" })
  .min(5, { message: "el monto mínimo es 5 USDC" }));

export const blindpayQuoteBodySchema = z.object({
  amount: usdAmount,
});

export const blindpayStatusQuerySchema = z.object({
  id: nonEmptyString.describe("id del payout es requerido"),
});

// ── On-ramp (payin SPEI → USDC). El SENDER es MXN; mínimo 5 MXN = 500 centavos. ──
const mxnAmount = z.preprocess((value) => {
  if (typeof value === "string" && value.trim().length > 0) return Number(value);
  return value;
}, z
  .number({ invalid_type_error: "debe ser un número" })
  .positive({ message: "debe ser mayor a 0" })
  .min(5, { message: "el monto mínimo es 5 MXN" }));

// Dirección Stellar (cuenta clásica G…) de la wallet Accesly del usuario.
const stellarAddress = z
  .string()
  .trim()
  .regex(/^G[A-Z2-7]{55}$/, { message: "dirección Stellar inválida" });

export const onrampInitBodySchema = z.object({
  walletAddress: stellarAddress,
  email: z.string().trim().email({ message: "email inválido" }).optional(),
});

export const onrampQuoteBodySchema = z.object({
  walletAddress: stellarAddress,
  amountMxn: mxnAmount,
  email: z.string().trim().email().optional(),
});

export const onrampStatusQuerySchema = z.object({
  id: nonEmptyString.describe("id del payin es requerido"),
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
