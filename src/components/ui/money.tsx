import { formatRupiah, type Numeric } from "@/lib/money";

export function Money({
  value,
  tone = "auto",
  signed = false,
  className = "",
}: {
  value: Numeric;
  tone?: "auto" | "plain" | "income" | "expense";
  signed?: boolean;
  className?: string;
}) {
  const n = Number(value.toString());
  const color =
    tone === "plain"
      ? ""
      : tone === "income"
        ? "text-emerald-600"
        : tone === "expense"
          ? "text-red-600"
          : n < 0
            ? "text-red-600"
            : "";
  return <span className={`tabular whitespace-nowrap ${color} ${className}`}>{formatRupiah(n, { signed })}</span>;
}
