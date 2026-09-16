import { ResumeDocument } from "@/components/resume/document";
import { getDB } from "@/server/db";
import { ResumeService } from "@/server/resume-service";
import { AppError } from "@/server/errors";
import { notFound } from "next/navigation";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  try {
    const doc = await new ResumeService(getDB()).publicDocument(token);
    return (
      <main className="print-view">
        <ResumeDocument
          document={doc}
          assetBase={`/api/v1/public/${token}/assets`}
        />
      </main>
    );
  } catch (e) {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  }
}
