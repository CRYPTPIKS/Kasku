import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { LedgerRuleError } from "./ledger";

/** Kesalahan yang aman ditampilkan ke pengguna. */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: "validation" | "not_found" | "forbidden" | "conflict" | "unauthorized" = "validation",
    public readonly fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const notFound = (what: string) => new AppError(`${what} tidak ditemukan.`, "not_found");

export interface ErrorPayload {
  message: string;
  code: string;
  fieldErrors?: Record<string, string>;
}

/** Ubah error apa pun menjadi pesan yang ramah pengguna. */
export function toErrorPayload(err: unknown): ErrorPayload {
  if (err instanceof AppError) return { message: err.message, code: err.code, fieldErrors: err.fieldErrors };
  if (err instanceof LedgerRuleError) return { message: err.message, code: "validation" };
  if (err instanceof ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of err.issues) {
      const key = issue.path.join(".") || "_";
      fieldErrors[key] ??= issue.message;
    }
    return { message: "Periksa kembali isian yang ditandai.", code: "validation", fieldErrors };
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") return { message: "Data dengan nama yang sama sudah ada.", code: "conflict" };
    if (err.code === "P2025") return { message: "Data tidak ditemukan.", code: "not_found" };
  }
  return { message: "Terjadi kesalahan. Silakan coba lagi.", code: "internal" };
}

export function httpStatus(code: string): number {
  switch (code) {
    case "validation":
      return 400;
    case "unauthorized":
      return 401;
    case "forbidden":
      return 403;
    case "not_found":
      return 404;
    case "conflict":
      return 409;
    default:
      return 500;
  }
}
