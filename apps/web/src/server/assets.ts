import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { DB } from "./db";
import { AppError, required } from "./errors";
export function storage() {
  const url = process.env.SUPABASE_URL,
    key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase Storage 환경변수가 필요합니다.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  }).storage.from(process.env.SUPABASE_STORAGE_BUCKET || "resume-photos");
}
export async function upload(db: DB, file: File) {
  if (
    file.size > 4 * 1024 * 1024 ||
    !["image/jpeg", "image/png", "image/webp"].includes(file.type)
  )
    throw new AppError(
      422,
      "INVALID_IMAGE",
      "4MB 이하의 JPG, PNG, WebP 사진을 선택하세요.",
    );
  const bytes = Buffer.from(await file.arrayBuffer());
  const actual = bytes
    .subarray(0, 8)
    .equals(Buffer.from("89504e470d0a1a0a", "hex"))
    ? "image/png"
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      ? "image/jpeg"
      : bytes.toString("ascii", 0, 4) === "RIFF" &&
          bytes.toString("ascii", 8, 12) === "WEBP"
        ? "image/webp"
        : null;
  if (actual !== file.type)
    throw new AppError(422, "INVALID_IMAGE", "사진 파일 형식을 확인하세요.");
  const id = randomUUID(),
    path = `photos/${id}`;
  const result = await storage().upload(path, bytes, {
    contentType: file.type,
    upsert: false,
  });
  if (result.error) throw new Error("사진 업로드 실패");
  try {
    await db.query(
      "insert into resume.assets(id,path,mime,size) values($1,$2,$3,$4)",
      [id, path, file.type, file.size],
    );
  } catch (e) {
    await storage().remove([path]);
    throw e;
  }
  return { id };
}
export async function photo(db: DB, id: string, publicToken?: string) {
  if (publicToken)
    required(
      (
        await db.query(
          "select a.asset_id from resume.publication_assets a join resume.publications p on p.version_id=a.version_id where p.token=$1 and a.asset_id=$2",
          [publicToken, id],
        )
      )[0],
    );
  const a = required(
    (
      await db.query("select path,mime from resume.assets where id=$1", [id])
    )[0],
  );
  const result = await storage().download(a.path);
  if (result.error)
    throw new AppError(404, "NOT_FOUND", "사진을 찾을 수 없습니다.");
  return new Response(result.data, {
    headers: {
      "Content-Type": a.mime,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
