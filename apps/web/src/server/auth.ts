import {
  randomBytes,
  randomUUID,
  createHash,
  createPublicKey,
  verify,
} from "node:crypto";
import { z } from "zod";
import type { DB } from "./db";
import { AppError, required } from "./errors";
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export const registrationSchema = z
  .object({
    name: z.string().min(1).max(100),
    public_key: z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
    origin: z.url(),
    nonce: z.string().regex(/^[a-f0-9]{64}$/),
    expires_at: z.string().datetime(),
    signature: z.string().max(200),
  })
  .strict();
export type Registration = z.infer<typeof registrationSchema>;
export function registrationMessage(p: Registration) {
  return `resume-auth:v1\nregister-key\n${p.origin}\n${p.public_key}\n${p.name}\n${p.nonce}\n${p.expires_at}`;
}
export function signatureValid(
  publicKey: string,
  payload: string,
  signature: string,
) {
  try {
    const raw = Buffer.from(publicKey, "base64");
    if (raw.length !== 32) return false;
    const key = createPublicKey({
      key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), raw]),
      format: "der",
      type: "spki",
    });
    return verify(
      null,
      Buffer.from(payload, "utf8"),
      key,
      Buffer.from(signature, "base64"),
    );
  } catch {
    return false;
  }
}
export function checkRegistration(input: unknown, origin: string) {
  const r = registrationSchema.parse(input),
    ttl = Date.parse(r.expires_at) - Date.now();
  if (
    r.origin !== origin ||
    ttl <= 0 ||
    ttl > 10 * 60_000 ||
    !signatureValid(r.public_key, registrationMessage(r), r.signature)
  )
    throw new AppError(
      422,
      "INVALID_REGISTRATION",
      "등록 증명 또는 만료 시각이 올바르지 않습니다.",
    );
  return r;
}
export class AuthService {
  constructor(
    private db: DB,
    private origin: string,
  ) {}
  async limit(key: string, max: number) {
    const row = (
      await this.db.query(
        `insert into resume.rate_limits(key,window_start,count) values($1,now(),1)
      on conflict(key) do update set count=case when resume.rate_limits.window_start<now()-interval '1 minute' then 1 else resume.rate_limits.count+1 end,
      window_start=case when resume.rate_limits.window_start<now()-interval '1 minute' then now() else resume.rate_limits.window_start end returning count`,
        [key],
      )
    )[0];
    if (row.count > max)
      throw new AppError(
        429,
        "RATE_LIMIT",
        "요청이 많습니다. 잠시 후 다시 시도하세요.",
      );
  }
  async challenge(binding: string, registration?: unknown) {
    await this.limit("challenge-global", 30);
    const r = registration
      ? checkRegistration(registration, this.origin)
      : null;
    const id = randomUUID(),
      nonce = randomBytes(32).toString("hex"),
      expires = new Date(Date.now() + 5 * 60_000).toISOString(),
      purpose = r ? "register" : "login";
    const payload = `resume-auth:v1\n${purpose}\n${this.origin}\n${id}\n${nonce}\n${expires}${r ? "\n" + hash(JSON.stringify(r)) : ""}`;
    await this.db.query(
      "insert into resume.auth_challenges(id,nonce,purpose,payload,binding_hash,registration,expires_at) values($1,$2,$3,$4,$5,$6,$7)",
      [
        id,
        nonce,
        purpose,
        payload,
        hash(binding),
        r ? JSON.stringify(r) : null,
        expires,
      ],
    );
    return { id, expires_at: expires, url: `resume-auth://approve/${id}` };
  }
  async inspect(id: string) {
    const c = required(
      (
        await this.db.query(
          "select * from resume.auth_challenges where id=$1 and consumed_at is null and expires_at>now()",
          [id],
        )
      )[0],
    );
    return {
      id: c.id,
      payload: c.payload,
      origin: this.origin,
      purpose: c.purpose,
      expires_at: c.expires_at,
      registration: c.registration,
    };
  }
  async approve(id: string, key: string, signature: string) {
    await this.limit("approval-global", 60);
    return this.db.transaction(async (tx) => {
      const c = required(
        (
          await tx.query(
            "select * from resume.auth_challenges where id=$1 and expires_at>now() and consumed_at is null for update",
            [id],
          )
        )[0],
      );
      const d = required(
        (
          await tx.query(
            "select * from resume.auth_devices where public_key=$1 and revoked_at is null for update",
            [key],
          )
        )[0],
      );
      if (!signatureValid(key, c.payload, signature))
        throw new AppError(
          401,
          "INVALID_SIGNATURE",
          "서명이 올바르지 않습니다.",
        );
      if (c.approved_at)
        throw new AppError(409, "ALREADY_APPROVED", "이미 승인된 요청입니다.");
      if (c.registration) {
        checkRegistration(c.registration, this.origin);
        if (c.registration.public_key === key)
          throw new AppError(
            422,
            "SAME_DEVICE",
            "다른 등록 기기로 승인하세요.",
          );
      }
      await tx.query(
        "update resume.auth_challenges set approved_at=now(),device_id=$2 where id=$1",
        [id, d.id],
      );
      return { ok: true };
    });
  }
  async complete(id: string, binding: string) {
    return this.db.transaction(async (tx) => {
      const c = required(
        (
          await tx.query(
            "select * from resume.auth_challenges where id=$1 and binding_hash=$2 and consumed_at is null and expires_at>now() for update",
            [id, hash(binding)],
          )
        )[0],
      );
      if (!c.approved_at) return { pending: true } as const;
      required(
        (
          await tx.query(
            "select id from resume.auth_devices where id=$1 and revoked_at is null for update",
            [c.device_id],
          )
        )[0],
      );
      await tx.query(
        "update resume.auth_challenges set consumed_at=now() where id=$1",
        [id],
      );
      if (c.registration) {
        const r = checkRegistration(c.registration, this.origin);
        await tx.query(
          "insert into resume.auth_devices(name,public_key,fingerprint) values($1,$2,$3)",
          [r.name, r.public_key, hash(r.public_key)],
        );
        return { registered: true } as const;
      }
      const token = randomBytes(32).toString("base64url");
      await tx.query(
        "insert into resume.edit_sessions(token_hash,device_id,expires_at) values($1,$2,now()+interval '1 hour')",
        [hash(token), c.device_id],
      );
      return { token } as const;
    });
  }
  async session(token: string, activity = false) {
    const s = (
      await this.db.query(
        "select s.device_id from resume.edit_sessions s join resume.auth_devices d on d.id=s.device_id where s.token_hash=$1 and s.revoked_at is null and d.revoked_at is null and s.expires_at>now()",
        [hash(token)],
      )
    )[0];
    if (!s)
      throw new AppError(
        401,
        "SESSION_EXPIRED",
        "편집 인증이 필요합니다. 저장하지 못한 내용은 화면에 유지됩니다.",
      );
    if (activity)
      await this.db.query(
        "update resume.edit_sessions set active_at=now(),expires_at=now()+interval '1 hour' where token_hash=$1 and expires_at>now() and revoked_at is null",
        [hash(token)],
      );
    return s;
  }
  async logout(token: string) {
    await this.db.query(
      "update resume.edit_sessions set revoked_at=now() where token_hash=$1",
      [hash(token)],
    );
    return { ok: true };
  }
  async devices() {
    return this.db.query(
      "select id,name,fingerprint,created_at,revoked_at from resume.auth_devices order by created_at",
    );
  }
  async revoke(id: string) {
    return this.db.transaction(async (tx) => {
      await tx.query(
        "update resume.auth_devices set revoked_at=now() where id=$1",
        [id],
      );
      await tx.query(
        "update resume.edit_sessions set revoked_at=now() where device_id=$1",
        [id],
      );
      return { ok: true };
    });
  }
}
