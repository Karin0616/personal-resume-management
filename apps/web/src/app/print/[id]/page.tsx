import { Print } from "@/features/print";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <Print id={(await params).id} />;
}
