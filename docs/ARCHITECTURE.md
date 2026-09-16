# Architecture

이 문서는 현재 확정된 배포·저장소 방향과 아직 미확정인 기술 선택을 정리합니다.

## 1. GitHub

### 확정

- Repository: `Karin0616/personal-resume-management`
- GitHub는 **소스 코드, 문서, 버전 관리의 기준점**으로 사용
- 현재 저장소는 public

공개 저장소에는 실제 이력서 개인정보, private key, token, secret 등 민감정보를 넣지 않습니다.

---

## 2. Vercel

### 확정

실제 웹 앱 배포는 **Vercel**을 사용합니다.

### 결정 이유

Cloudflare Workers/D1도 후보였지만, 다른 프로젝트에서 Cloudflare 무료 범위를 이미 많이 사용하고 있어 이 프로젝트의 기본 인프라에서는 제외했습니다.

---

## 3. 데이터 저장

### 확정된 요구사항

- 여러 기기에서 같은 이력서 데이터를 사용할 수 있어야 함
- 브라우저 `localStorage`만으로 끝내지 않음
- 클라우드 저장이 필요

### 확정 — MVP 구현

- Supabase PostgreSQL과 private Storage bucket을 사용합니다.
- 직무/용도 → 이력서 → 버전 → JSONB 문서 → 변경 history 구조입니다.
- 버전별 revision을 사용하며 저장·history 추가를 하나의 transaction으로 수행합니다.
- 사진은 별도 assets와 버전/공개본 참조 테이블로 관리합니다.
- history는 버전당 최근 100개 변경 요약입니다. 전체 snapshot 복원은 후속 범위입니다.
- 공개본은 사용자가 명시적으로 갱신하는 별도 snapshot입니다.
- 실제 테이블과 API는 [API.md](API.md), 운영 환경은 [OPERATIONS.md](OPERATIONS.md)를 참조합니다.

GitHub 저장소는 코드·문서 기준점이며, 실제 개인정보가 포함된 이력서 데이터 저장소로 확정된 것은 아닙니다.

---

## 4. 인증

### 확정

- 공개 열람 가능
- 편집은 본인만 가능
- 별도 로컬 Authenticator 프로그램 사용
- 공개키 기반 Challenge-Response 인증
- private key는 로컬 기기에만 보관
- 서버에는 검증용 public key를 등록
- 인증 후 편집 세션은 마지막 활동 기준 1시간 유지

상세 인증·보안 기준은 [AUTH_SECURITY_SPEC.md](AUTH_SECURITY_SPEC.md)에서 관리합니다.

---

## 5. MVP 기술 선택

### 확정

- pnpm workspace, Next.js App Router, TypeScript, Tailwind CSS
- Tiptap 서술 필드, dnd-kit 항목·섹션 정렬
- Route Handler → Resume service → PostgreSQL adapter. UI는 DB/Storage에 직접 접근하지 않습니다.
- Tauri Windows Authenticator, Rust Ed25519, Windows DPAPI 키 보호
- PostgreSQL에 token hash와 idle 만료 시각을 저장하는 세션
- HttpOnly + Secure + SameSite=Strict cookie
- request ID deep link와 브라우저 polling으로 승인 완료 확인
- A4 Print CSS와 브라우저 PDF 저장

2026-09-15 사용자 승인 구현 계획으로 기술 TBD를 구체화했습니다. Supabase Auth의 ID/password 로그인은 도입하지 않습니다.
