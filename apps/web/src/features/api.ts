export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string,
  ) {
    super(message);
  }
}
export async function api<T = any>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const res = await fetch(`/api/v1/${path}`, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      "x-resume-csrf": "1",
      ...(body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
    },
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
          ? body
          : JSON.stringify(body),
  });
  const result = await res.json();
  if (!res.ok)
    throw new ApiError(
      res.status,
      result.message +
        (result.fields?.[0]
          ? ` (${result.fields[0].path.join(".")}: ${result.fields[0].message})`
          : ""),
      result.code,
    );
  return result;
}
export const versionName = (v: { major: number; minor: number }) =>
  `v${v.major}.${v.minor}`;
export const dateLabel = (s: string) =>
  new Date(s).toLocaleString("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
