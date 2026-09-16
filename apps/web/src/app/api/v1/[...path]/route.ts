import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { importJsonSchema } from "@resume/schema";
import { getDB } from "@/server/db";
import { ResumeService } from "@/server/resume-service";
import { AuthService } from "@/server/auth";
import { AppError, required } from "@/server/errors";
import { upload, photo } from "@/server/assets";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const uuid = z.uuid(),
  title = z.string().trim().min(1).max(200),
  rev = z.number().int().nonnegative();
const cookie = {
  httpOnly: true,
  secure: true,
  sameSite: "strict" as const,
  path: "/",
};
const sessionCookie = "__Host-resume-session";
function json(value: unknown) {
  return NextResponse.json(value, { headers: { "Cache-Control": "no-store" } });
}
async function handler(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    const path = (await params).path,
      [resource, id, action, sub] = path,
      method = req.method,
      mutating = method !== "GET";
    const origin = process.env.APP_ORIGIN;
    if (!origin)
      throw new AppError(
        503,
        "NOT_CONFIGURED",
        "서버 APP_ORIGIN 설정이 필요합니다.",
      );
    // Native approve carries an Ed25519 proof, not ambient browser authority.
    const nativeApprove =
      resource === "auth" &&
      id === "challenges" &&
      sub === "approve" &&
      path.length === 4;
    if (
      mutating &&
      !nativeApprove &&
      (req.headers.get("origin") !== origin ||
        req.headers.get("x-resume-csrf") !== "1")
    )
      throw new AppError(
        403,
        "ORIGIN_DENIED",
        "요청 출처를 확인할 수 없습니다.",
      );
    const db = getDB(),
      service = new ResumeService(db),
      auth = new AuthService(db, origin),
      token = req.cookies.get(sessionCookie)?.value ?? "";
    let body: any = {};
    if (
      mutating &&
      !req.headers.get("content-type")?.startsWith("multipart/form-data")
    ) {
      const raw = await req.text();
      if (Buffer.byteLength(raw) > 1024 * 1024)
        throw new AppError(413, "TOO_LARGE", "JSON은 1MB 이하로 입력하세요.");
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        throw new AppError(422, "INVALID_JSON", "JSON 형식을 확인하세요.");
      }
    }
    if (resource === "public" && id && method === "GET") {
      if (action === "assets" && sub) return photo(db, uuid.parse(sub), id);
      if (path.length === 2) return json(await service.publicDocument(id));
    }
    if (resource === "auth" && id === "challenges") {
      if (method === "POST" && path.length === 2) {
        if (body.registration) await auth.session(token);
        const binding = randomBytes(32).toString("base64url"),
          result = await auth.challenge(binding, body.registration),
          response = json(result);
        response.cookies.set(`__Host-resume-binding-${result.id}`, binding, {
          ...cookie,
          maxAge: 300,
        });
        return response;
      }
      if (action) {
        uuid.parse(action);
        if (method === "GET" && path.length === 3)
          return json(await auth.inspect(action));
        if (method === "POST" && sub === "approve")
          return json(
            await auth.approve(
              action,
              z.string().max(100).parse(body.public_key),
              z.string().max(200).parse(body.signature),
            ),
          );
        if (method === "POST" && sub === "complete") {
          const bindingName = `__Host-resume-binding-${action}`;
          const result = await auth.complete(
              action,
              req.cookies.get(bindingName)?.value ?? "",
            ),
            response = json({
              pending: "pending" in result,
              registered: "registered" in result,
            });
          if ("token" in result)
            response.cookies.set(sessionCookie, result.token!, {
              ...cookie,
              maxAge: 3600,
            });
          if (!("pending" in result))
            response.cookies.set(bindingName, "", { ...cookie, maxAge: 0 });
          return response;
        }
      }
    }
    await auth.session(token, mutating);
    let value: unknown;
    if (resource === "auth") {
      if (id === "session" && action === "activity" && method === "POST")
        value = { ok: true };
      else if (id === "logout" && method === "POST") {
        const res = json(await auth.logout(token));
        res.cookies.set(sessionCookie, "", { ...cookie, maxAge: 0 });
        return res;
      } else if (id === "devices" && method === "GET")
        value = await auth.devices();
      else if (id === "devices" && action && method === "DELETE")
        value = await auth.revoke(uuid.parse(action));
    } else if (resource === "home" && method === "GET")
      value = await service.home();
    else if (resource === "import-schema" && method === "GET")
      value = importJsonSchema();
    else if (resource === "assets") {
      if (method === "POST") {
        const data = await req.formData(),
          file = data.get("file");
        if (!(file instanceof File))
          throw new AppError(422, "MISSING_FILE", "사진을 선택하세요.");
        value = await upload(db, file);
      } else if (id && method === "GET") return photo(db, uuid.parse(id));
    } else if (["purposes", "resumes", "versions"].includes(resource)) {
      if (id) uuid.parse(id);
      if (id && action === "delete-summary" && method === "GET")
        value = await service.deleteSummary(resource as any, id);
      else if (id && method === "DELETE" && !action)
        value = await service.remove(
          resource as any,
          id,
          z.string().parse(body.confirmation),
          z.string().parse(body.fingerprint),
        );
      else if (resource === "purposes") {
        if (method === "GET" && !action) {
          const purposes = (await service.home()).purposes;
          value = id ? required(purposes.find(p => p.id === id)) : purposes;
        }
        else if ((method === "POST" && !id) || (method === "PATCH" && id))
          value = await service.purpose(title.parse(body.name), id);
      } else if (resource === "resumes") {
        if (method === "GET" && action === "versions") value = await service.versions(id);
        else if (method === "GET" && !action) {
          const resumes = (await service.home()).resumes;
          value = id ? required(resumes.find(r => r.id === id)) : resumes;
        }
        else if (method === "POST" && !id)
          value = await service.createResume(
            z
              .object({
                purpose_id: uuid,
                title,
                company: z.string().max(200).nullable().optional(),
                source_id: uuid.optional(),
              })
              .strict()
              .parse(body),
          );
        else if (method === "POST" && action === "versions")
          value = await service.createVersion(
            id,
            z.enum(["major", "minor"]).parse(body.kind),
            body.source_id ? uuid.parse(body.source_id) : undefined,
            body.document,
          );
        else if (method === "PATCH" && id)
          value = await service.renameResume(
            id,
            title.parse(body.title),
            z.string().max(200).nullable().parse(body.company),
          );
      } else if (id) {
        if (method === "GET" && (!action || action === "data"))
          value = await service.version(id);
        else if (method === "GET" && action === "history")
          value = await service.history(id);
        else if (method === "GET" && action === "publication")
          value = await service.publication(id);
        else if (method === "PUT" && action === "data")
          value = await service.save(
            id,
            rev.parse(body.revision),
            body.document,
          );
        else if (method === "PATCH" && !action)
          value = await service.label(
            id,
            z.string().max(200).parse(body.label),
          );
        else if (method === "POST" && action === "activity")
          value = await service.activity(id);
        else if (method === "POST" && action === "import" && sub === "preview")
          value = await service.importPreview(id, body.payload);
        else if (method === "POST" && action === "import" && sub === "apply")
          value = await service.importApply(
            id,
            rev.parse(body.revision),
            body.payload,
          );
        else if (method === "POST" && action === "publication")
          value = await service.publish(id, rev.parse(body.revision));
        else if (method === "DELETE" && action === "publication")
          value = await service.unpublish(id);
      }
    }
    if (value === undefined)
      throw new AppError(404, "NOT_FOUND", "API를 찾을 수 없습니다.");
    const response = json(value);
    if (mutating)
      response.cookies.set(sessionCookie, token, { ...cookie, maxAge: 3600 });
    return response;
  } catch (error) {
    if (error instanceof z.ZodError)
      return NextResponse.json(
        {
          code: "VALIDATION_ERROR",
          message: "입력 형식을 확인하세요.",
          fields: error.issues,
        },
        { status: 422 },
      );
    if (error instanceof AppError)
      return NextResponse.json(
        { code: error.code, message: error.message },
        { status: error.status },
      );
    // Never log SQL parameters, documents, keys or cookies.
    const code = (error as { code?: string })?.code;
    if (code === "23505")
      return NextResponse.json(
        { code: "ALREADY_EXISTS", message: "이미 등록된 데이터입니다." },
        { status: 409 },
      );
    if (code === "23503")
      return NextResponse.json(
        { code: "INVALID_REFERENCE", message: "참조 대상을 찾을 수 없습니다." },
        { status: 422 },
      );
    return NextResponse.json(
      {
        code: "REQUEST_FAILED",
        message:
          "요청을 처리하지 못했습니다. 서버 설정과 입력 내용을 확인하세요.",
      },
      { status: 500 },
    );
  }
}
export {
  handler as GET,
  handler as POST,
  handler as PUT,
  handler as PATCH,
  handler as DELETE,
};
