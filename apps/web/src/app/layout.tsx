import type { Metadata } from "next";
import "@fontsource/noto-sans-kr/400.css";
import "@fontsource/noto-sans-kr/500.css";
import "@fontsource/noto-sans-kr/700.css";
import "@/styles/globals.css";
export const metadata: Metadata = {
  title: "Resume Atelier · 나의 이력서",
  description: "경험을 정리하고 다음 기회를 준비하는 개인 이력서 작업 공간",
  robots: { index: false, follow: false },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <header className="site-header no-print">
          <a href="/" className="brand">
            <span>r.</span> resume atelier
          </a>
          <span className="brand-note">나의 경험, 나의 다음 페이지</span>
        </header>
        {children}
      </body>
    </html>
  );
}
