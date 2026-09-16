"use client";
import { useEffect, useState } from "react";
import { ResumeDocument } from "@/components/resume/document";
import { api } from "./api";
export function Print({ id }: { id: string }) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState("");
  useEffect(() => {
    api(`versions/${id}/data`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [id]);
  return (
    <main className="print-view">
      <div className="print-tools no-print">
        <a href={`/editor/${id}`}>← 편집으로 돌아가기</a>
        <p>용지 A4 · 배율 100% · 머리글/바닥글 해제</p>
        <button
          className="primary"
          disabled={!data}
          onClick={async () => {
            await document.fonts.ready;
            await Promise.all(
              [...document.images].map((img) => img.decode().catch(() => {})),
            );
            window.print();
          }}
        >
          PDF로 저장 / 인쇄
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {data && <ResumeDocument document={data.document} />}
    </main>
  );
}
