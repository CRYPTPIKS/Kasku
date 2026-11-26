/**
 * Penyimpanan objek privat untuk foto struk.
 * - "s3": S3-compatible (MinIO untuk self-hosted). Bucket privat, tidak ada URL publik.
 * - "local": folder di disk (development tanpa MinIO).
 * - "memory": hanya untuk test.
 * Foto selalu diakses lewat aplikasi setelah cek login (lihat /api/receipts/[id]/image).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

export interface ObjectStorage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
}

class MemoryStorage implements ObjectStorage {
  private data = new Map<string, Buffer>();
  async put(key: string, body: Buffer) {
    this.data.set(key, body);
  }
  async get(key: string) {
    const v = this.data.get(key);
    if (!v) throw new Error(`Objek tidak ditemukan: ${key}`);
    return v;
  }
}

class LocalStorage implements ObjectStorage {
  constructor(private root: string) {}
  private resolve(key: string) {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(path.resolve(this.root) + path.sep)) throw new Error("Kunci objek tidak valid");
    return p;
  }
  async put(key: string, body: Buffer) {
    const p = this.resolve(key);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, body, { mode: 0o600 });
  }
  async get(key: string) {
    return readFile(this.resolve(key));
  }
}

class S3Storage implements ObjectStorage {
  private client: S3Client;
  private bucketReady: Promise<void> | null = null;
  constructor(
    private bucket: string,
    opts: { endpoint?: string; region: string; accessKeyId: string; secretAccessKey: string; forcePathStyle: boolean },
  ) {
    this.client = new S3Client({
      endpoint: opts.endpoint,
      region: opts.region,
      forcePathStyle: opts.forcePathStyle,
      credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
    });
  }
  private ensureBucket() {
    this.bucketReady ??= (async () => {
      try {
        await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      } catch {
        // Bucket baru bersifat privat secara default (tanpa policy publik).
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      }
    })().catch((e) => {
      this.bucketReady = null;
      throw e;
    });
    return this.bucketReady;
  }
  async put(key: string, body: Buffer, contentType: string) {
    await this.ensureBucket();
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }
  async get(key: string) {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!res.Body) throw new Error(`Objek kosong: ${key}`);
    return Buffer.from(await res.Body.transformToByteArray());
  }
}

let instance: ObjectStorage | null = null;

export function getStorage(): ObjectStorage {
  if (instance) return instance;
  const driver = process.env.STORAGE_DRIVER ?? (process.env.S3_ENDPOINT ? "s3" : "local");
  if (driver === "memory") instance = new MemoryStorage();
  else if (driver === "s3") {
    const need = ["S3_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY"] as const;
    for (const k of need) if (!process.env[k]) throw new Error(`${k} belum diisi untuk STORAGE_DRIVER=s3`);
    instance = new S3Storage(process.env.S3_BUCKET!, {
      endpoint: process.env.S3_ENDPOINT || undefined,
      region: process.env.S3_REGION ?? "us-east-1",
      accessKeyId: process.env.S3_ACCESS_KEY!,
      secretAccessKey: process.env.S3_SECRET_KEY!,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
    });
  } else instance = new LocalStorage(process.env.LOCAL_STORAGE_DIR ?? path.resolve(process.cwd(), "storage"));
  return instance;
}

/** Hanya untuk test. */
export function setStorage(s: ObjectStorage | null) {
  instance = s;
}
