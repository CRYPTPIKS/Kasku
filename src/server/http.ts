import { NextResponse } from "next/server";
import { httpStatus, toErrorPayload } from "./errors";
import { logger } from "./logger";

export function jsonError(err: unknown) {
  const payload = toErrorPayload(err);
  if (payload.code === "internal") logger.error("Permintaan API gagal", { err });
  return NextResponse.json({ error: payload }, { status: httpStatus(payload.code) });
}

export function unauthorized() {
  return NextResponse.json({ error: { message: "Silakan masuk terlebih dahulu.", code: "unauthorized" } }, { status: 401 });
}

export function csvResponse(csv: string, filename: string) {
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
