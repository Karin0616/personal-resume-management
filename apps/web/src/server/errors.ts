export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function required<T>(value: T | undefined | null): T {
  if (value == null)
    throw new AppError(404, "NOT_FOUND", "대상을 찾을 수 없습니다.");
  return value;
}
