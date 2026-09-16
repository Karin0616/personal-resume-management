# 개발 및 운영

## 개발 환경

- Node.js 24 LTS, pnpm 10.32.1. 정확한 JS 의존성은 lockfile에 고정한다.
- Windows Authenticator: Rust stable, Visual Studio C++ Build Tools와 Windows SDK, WebView2.
- 실제 이력서·등록 proof·키 파일은 저장소 밖에 보관한다. fixture에는 명백한 더미만 사용한다.

### 다른 데스크톱에서 이어서 개발

```powershell
git clone --branch feat/mvp-bootstrap https://github.com/Karin0616/personal-resume-management.git
Set-Location personal-resume-management
pnpm install --frozen-lockfile
Copy-Item .env.example apps/web/.env.local
```

새 PC의 `.env.local`에 필요한 연결값을 직접 설정한다. 환경변수 파일, `.vercel` 로그인/연결 정보, Windows 설치 파일과 로컬 키는 Git으로 동기화하지 않는다. 웹에서 이력서를 사용하기만 한다면 소스 clone 없이 운영 사이트에 접속하면 된다. 편집하려는 각 PC에는 Authenticator를 설치해 별도 키를 생성하고, 최초 등록 이후의 추가 기기는 기존 등록 기기의 승인을 받아 등록한다. DPAPI로 보호된 키 파일을 다른 PC로 복사하지 않는다.

```powershell
pnpm install --frozen-lockfile
Copy-Item .env.example apps/web/.env.local
pnpm dev
```

`pnpm dev`는 HTTPS 개발 서버다. Authenticator는 유효한 TLS 인증서만 신뢰하므로 로컬 인증 통합 테스트에는 OS가 신뢰하는 개발 인증서를 사용한다. production에 TLS 검증 우회 옵션은 없다.

## Supabase

사용자가 프로젝트를 만들고 서버용 connection string, Storage service key를 설정한다. `DATABASE_URL`은 Supabase transaction pooler URI를 사용하며 prepared statement를 비활성화한다. migration에는 schema 생성·테이블 생성 권한이 필요하다.

Next.js는 `apps/web/.env.local`을 읽는다. 스크립트는 shell에 export한 환경변수를 사용한다. 비밀값을 명령줄 문자열이나 shell history에 직접 쓰지 말고 비공개 환경 파일/secret manager로 주입한다.

`SUPABASE_SERVICE_ROLE_KEY`에는 서버용 `sb_secret_` 키를 넣는다. 변수 이름은 기존 계약을 유지한다. `sb_publishable_` 키는 비공개 사진 저장소를 관리할 권한이 없으므로 사용할 수 없다.

```powershell
pnpm db:migrate
```

migration은 checksum을 기록한다. 이미 적용한 migration을 수정하지 말고 새 파일로 추가한다. Supabase의 storage schema가 존재하면 private bucket 설정도 적용한다. 기본 bucket 이름은 `resume-photos`이며 바꾸려면 Storage SQL과 환경변수를 함께 변경한다.

`resume` schema는 Data API에 노출하지 않는다. 테이블은 RLS와 PUBLIC 권한 철회로 직접 접근을 차단한다. 웹 서버의 DB credential은 제한된 장소에서만 보관한다. Supabase Auth는 사용하지 않는다.

## 최초 기기 등록 / 복구

운영 사이트 주소는 `https://personal-resume-management.vercel.app`이다. Authenticator 사이트 주소에는 끝의 `/` 없이 입력한다. 로컬 개발용 `.env.local`의 APP_ORIGIN과 구분하여, 운영 기기 등록 CLI를 실행할 때 APP_ORIGIN은 이 운영 주소를 사용한다.

```powershell
pnpm --filter @resume/authenticator build
```

생성된 NSIS installer로 설치한 뒤 Authenticator에서 HTTPS origin과 기기 이름을 저장한다. private key는 Windows 사용자의 앱 로컬 디렉터리에서 DPAPI 암호화 상태로 보관된다. 원문 키를 내보내는 기능은 없다.

1. 앱에서 등록 JSON을 생성한다. 유효 시간은 10분이다.
2. JSON을 저장소 밖의 파일에 저장한다.
3. 서버 관리 권한이 있는 터미널에서 다음 명령을 실행한다.

```powershell
pnpm device:register C:\private\device-registration.json
```

추가 기기는 웹의 등록 기기 화면에서 새 기기 proof를 붙여넣고 기존 기기로 승인한다. `resume-auth://approve/<request-id>`는 요청 ID만 전달하며 임의 서버 주소를 전달하지 않는다.

모든 기기를 분실했을 때에만 새 기기 proof와 `--recover`를 사용한다. 기존 기기·세션·진행 중 challenge를 폐기하고 새 기기를 등록한다. 서버 관리 권한을 가진 운영자만 수행할 수 있다. 기존 키 파일을 새 기기나 다른 Windows 사용자에게 복사하는 방법은 지원하지 않는다.

## Vercel

- 이 앱은 `projectallblu` 팀의 별도 `personal-resume-management` 프로젝트로 운영한다. 환경변수·도메인·배포 설정은 해당 프로젝트에만 적용하며 기존 프로젝트나 팀 공통 설정은 변경하지 않는다. Hobby 팀의 사용량 한도는 공유된다.
- `.vercelignore`는 로컬 환경변수 파일, 키 파일, 테스트 산출물과 Windows 빌드 파일을 CLI 업로드에서 제외한다. 서버 비밀값은 Vercel 환경변수로 별도 등록한다.
- Framework: Next.js. Root Directory: `apps/web`. workspace 바깥 공유 패키지 접근을 허용한다.
- Install: `pnpm install --frozen-lockfile`. Build: `pnpm build` (웹 디렉터리 기준).
- Production/Preview의 APP_ORIGIN, DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_STORAGE_BUCKET을 각각 설정한다.
- Preview는 별도 Supabase 개발 프로젝트만 사용한다. 운영 DB credential을 Preview에 복사하지 않는다.
- 각 인증 환경은 고정 HTTPS origin을 사용한다. 임의의 Preview URL을 인증 대상 origin으로 허용하지 않는다.
- 인증 서버·Authenticator 통합 검증 전에는 외부에서 편집 가능한 운영 배포를 완료로 간주하지 않는다.

## 운영 점검

- 인증 없는 관리 API가 401인지, 다른 Origin mutation이 403인지 확인.
- 실제 기기 로그인 → 생성 → 편집 → 재조회 → 새 버전 → 공개/해제 → PDF 확인.
- 두 기기로 접속해 오래된 revision이 409인지 확인.
- 1시간 idle 만료, 해제한 기기의 재인증 차단 확인.
- 숨긴 내용이 공개 HTML·JSON·사진 endpoint에 남지 않는지 확인.
- 브라우저 인쇄: A4, 배율 100%, 머리글·바닥글 끄기. 1페이지보다 긴 항목은 브라우저가 분할한다.
- 폰트는 `@fontsource/noto-sans-kr`에서 로컬 번들링하며 해당 패키지 OFL 라이선스를 따른다.

`pnpm assets:cleanup`은 생성 후 1일이 지난 미참조 사진을 정리한다. 버전·공개본이 참조하는 파일은 삭제하지 않으며 실패한 정리는 재시도한다. 초기 업로드 성공 후 DB 기록 전에 프로세스가 중단된 orphan 파일은 Storage 관리 화면에서 별도로 확인해야 한다.

DB 백업/복구는 Supabase 프로젝트의 백업 설정을 확인한다. 사용자 삭제를 되돌리는 앱 휴지통은 없다. migration 실패 시 transaction이 rollback된다. 배포 rollback은 Vercel의 이전 배포를 사용하고 DB rollback은 별도 검증한 복구 절차를 따른다.

## 테스트

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

통합 테스트는 PGlite의 실제 PostgreSQL 엔진을 사용한다. HTTP 테스트는 테스트 런타임에서만 DB adapter를 주입한다. 브라우저 E2E는 Playwright의 요청 interception을 통해 같은 DB service를 호출한다. 제품에는 test login endpoint나 인증 우회 환경변수가 없다.

Windows 네이티브 검증은 `apps/authenticator/src-tauri`에서 `cargo test --locked`, `cargo clippy --locked -- -D warnings`를 실행한다. CI에도 Windows 검사를 둔다. 실제 설치·deep link 등록과 두 물리 기기 검증은 자동 단위 테스트와 별도로 수행한다.
