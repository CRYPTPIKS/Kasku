/** Kategori bawaan Indonesia beserta kata kunci untuk saran kategori otomatis. */
export interface SeedCategory {
  name: string;
  icon: string;
  color: string;
  keywords: string[];
}

export const EXPENSE_CATEGORIES: SeedCategory[] = [
  { name: "Makan & Minum", icon: "🍜", color: "#f97316", keywords: ["makan", "minum", "kopi", "sarapan", "makan siang", "makan malam", "resto", "warung", "gofood", "grabfood", "shopeefood", "bakso", "nasi", "jajan", "snack", "starbucks", "mcd", "kfc"] },
  { name: "Belanja Harian", icon: "🛒", color: "#22c55e", keywords: ["belanja", "indomaret", "alfamart", "supermarket", "sayur", "pasar", "superindo", "hypermart", "lotte", "transmart", "sembako", "galon"] },
  { name: "Transportasi", icon: "🚗", color: "#3b82f6", keywords: ["bensin", "pertalite", "pertamax", "bbm", "parkir", "tol", "e-toll", "ojek", "gojek", "grab", "gocar", "grabcar", "krl", "mrt", "transjakarta", "kereta", "taksi", "bus"] },
  { name: "Tagihan & Utilitas", icon: "💡", color: "#eab308", keywords: ["listrik", "pln", "token", "air", "pdam", "internet", "wifi", "indihome", "biznet", "pulsa", "paket data", "bpjs", "iuran", "gas"] },
  { name: "Tempat Tinggal", icon: "🏠", color: "#a855f7", keywords: ["sewa", "kos", "kost", "kontrakan", "ipl", "cicilan rumah", "kpr", "renovasi"] },
  { name: "Kesehatan", icon: "💊", color: "#ef4444", keywords: ["obat", "apotek", "dokter", "rumah sakit", "klinik", "vitamin", "kimia farma", "k24", "lab"] },
  { name: "Pendidikan", icon: "📚", color: "#0ea5e9", keywords: ["sekolah", "kursus", "buku", "spp", "kuliah", "les", "pelatihan", "udemy"] },
  { name: "Hiburan", icon: "🎬", color: "#ec4899", keywords: ["bioskop", "film", "netflix", "spotify", "youtube", "game", "konser", "liburan", "nonton", "disney"] },
  { name: "Belanja Pribadi", icon: "🛍️", color: "#d946ef", keywords: ["baju", "sepatu", "tokopedia", "shopee", "lazada", "skincare", "kosmetik", "potong rambut", "salon"] },
  { name: "Keluarga & Anak", icon: "👨‍👩‍👧", color: "#14b8a6", keywords: ["anak", "susu", "popok", "keluarga", "orang tua", "uang jajan"] },
  { name: "Sosial & Donasi", icon: "🤲", color: "#84cc16", keywords: ["zakat", "infaq", "sedekah", "donasi", "kondangan", "sumbangan", "hadiah", "kado", "arisan"] },
  { name: "Asuransi", icon: "🛡️", color: "#64748b", keywords: ["asuransi", "premi", "prudential", "allianz", "axa"] },
  { name: "Biaya Admin & Bank", icon: "🏦", color: "#78716c", keywords: ["admin", "biaya transfer", "biaya admin", "bunga kartu", "materai"] },
  { name: "Pajak", icon: "🧾", color: "#991b1b", keywords: ["pajak", "pbb", "pph", "stnk", "samsat"] },
  { name: "Lainnya", icon: "📦", color: "#94a3b8", keywords: [] },
];

export const INCOME_CATEGORIES: SeedCategory[] = [
  { name: "Gaji", icon: "💼", color: "#16a34a", keywords: ["gaji", "salary", "upah"] },
  { name: "Bonus & THR", icon: "🎁", color: "#22c55e", keywords: ["bonus", "thr", "insentif", "komisi"] },
  { name: "Usaha & Freelance", icon: "🧑‍💻", color: "#0891b2", keywords: ["freelance", "proyek", "jualan", "usaha", "omzet", "klien"] },
  { name: "Hasil Investasi", icon: "📈", color: "#7c3aed", keywords: ["dividen", "bunga", "kupon", "imbal hasil"] },
  { name: "Hadiah & Pemberian", icon: "🎉", color: "#db2777", keywords: ["hadiah", "angpao", "kiriman", "pemberian"] },
  { name: "Pengembalian Dana", icon: "↩️", color: "#0284c7", keywords: ["refund", "cashback", "pengembalian", "reimburse"] },
  { name: "Pemasukan Lainnya", icon: "💰", color: "#65a30d", keywords: [] },
];

export const SAMPLE_ACCOUNTS = [
  { name: "Tunai", kind: "cash", aliases: ["cash", "tunai", "dompet"] },
  { name: "BCA", kind: "bank", aliases: ["bca"] },
  { name: "Mandiri", kind: "bank", aliases: ["mandiri"] },
  { name: "GoPay", kind: "ewallet", aliases: ["gopay"] },
  { name: "OVO", kind: "ewallet", aliases: ["ovo"] },
  { name: "Kartu Kredit", kind: "credit_card", aliases: ["cc", "kartu kredit"] },
] as const;
