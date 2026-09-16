import postgres from "postgres";
export interface DB {
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;
  transaction<T>(fn: (tx: DB) => Promise<T>): Promise<T>;
}
function wrap(sql: any): DB {
  return {
    query: (text, params = []) => sql.unsafe(text, params),
    transaction: (fn) => sql.begin((tx: any) => fn(wrap(tx))),
  };
}
let database: DB | undefined;
export function getDB(): DB {
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL 환경변수가 필요합니다.");
  return (database ??= wrap(
    postgres(process.env.DATABASE_URL, {
      prepare: false,
      max: 3,
      idle_timeout: 20,
      connect_timeout: 10,
    }),
  ));
}
