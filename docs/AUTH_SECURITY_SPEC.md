# Auth & Security Spec

이 문서는 공개 열람과 편집 권한을 분리하기 위한 인증·보안 기준을 정리합니다.

## 1. 접근 원칙

### 확정

- 웹 이력서는 누구나 열람 가능
- 편집 기능은 본인만 사용 가능
- 일반적인 아이디/비밀번호 로그인 대신 **별도 로컬 Authenticator 프로그램**을 사용
- 인증 방식은 **Challenge-Response**

---

## 2. Challenge-Response 인증

### 확정

기본 흐름은 다음과 같습니다.

```text
Web App / Server                 Local Authenticator
      |                                  |
      | challenge 발급                    |
      | --------------------------------> |
      |                                  | private key로 서명
      | <-------------------------------- |
      | signature 검증                    |
      | public key로 검증 성공            |
      | 편집 권한 부여                     |
```

서버는 매 인증마다 새로운 challenge를 생성합니다.

Authenticator는 기기에만 저장된 private key로 challenge에 서명하고, 서버는 미리 등록된 public key로 서명을 검증합니다.

### 암호화 원칙

- 자체 암호 알고리즘을 새로 만들지 않음
- 검증된 표준 공개키 서명 알고리즘 사용
- Ed25519 사용: 서버 Node.js crypto, 로컬 Rust ed25519-dalek

---

## 3. 키 관리

### 확정

- private key는 로컬 기기에만 보관
- 서버에는 public key만 보관
- GitHub 저장소나 Vercel 환경에 private key를 저장하지 않음
- 집 PC, 노트북 등 여러 기기에서 Authenticator를 사용할 수 있어야 함

### 방향

기기마다 별도의 key pair를 사용할 수 있는 구조를 지향합니다.

### 확정 — MVP

- 기기별 Ed25519 key pair를 로컬 Rust에서 생성합니다.
- private key는 Windows 사용자의 앱 로컬 디렉터리에 DPAPI로 보호해 저장합니다.
- 최초 기기는 관리자 CLI와 새 키의 서명 증명으로 등록합니다.
- 추가 기기는 새 키의 서명 증명과 기존 기기의 명시적 서명 승인이 모두 필요합니다.
- revoke는 해당 기기의 세션도 폐기합니다.
- 모든 기기 분실 시 관리자 CLI의 명시적 `--recover`로 기존 기기·세션·challenge를 폐기합니다.
- 키 원문 내보내기는 제공하지 않습니다. 실제 절차는 [OPERATIONS.md](OPERATIONS.md)를 참조합니다.

---

## 4. 편집 세션

### 확정

인증 후 편집 권한은 **마지막 활동을 기준으로 1시간** 유지합니다.

- 사용자가 실제로 작업 중이면 만료 시간이 갱신됨
- 아무 작업이 없으면 idle timeout이 진행됨
- 마지막 활동 이후 1시간이 지나면 편집 권한 만료

목표는 작업 중 갑자기 로그아웃되는 일을 줄이면서, 방치된 브라우저의 편집 권한이 무기한 유지되지 않게 하는 것입니다.

### 확정 — MVP

- 세션 원문은 HttpOnly + Secure + SameSite=Strict cookie에만 저장합니다.
- DB에는 token hash와 마지막 활동·만료·폐기 시각만 저장합니다.
- 활성 화면의 실제 입력 활동이 있을 때 최대 1분 주기로 갱신합니다. 단순 polling은 갱신하지 않습니다.
- 마지막 활동 후 1시간이 지난 세션은 재활성화하지 않고 재인증을 요구합니다.

---

## 5. 인증 세부 UX

### 확정 — MVP

- `resume-auth://approve/<request-id>`는 request ID만 전달합니다.
- 앱은 사용자가 설정한 HTTPS origin에서만 challenge를 가져옵니다. 임의 redirect를 따라가지 않습니다.
- 32바이트 nonce, 5분 TTL, origin·purpose·만료가 포함된 고정 원문에 서명합니다.
- 승인 전 앱에 사이트·목적·새 기기 정보를 표시합니다.
- challenge는 요청을 시작한 브라우저의 binding cookie와 결합하며 1회만 소비됩니다.
- browser mutation은 Origin과 CSRF 헤더를 검증합니다. native 승인에는 Ed25519 proof를 요구합니다.
- protocol 필드와 경로는 [API.md](API.md)가 기준입니다.

---

## 6. 공개 저장소 보안 원칙

### 확정

GitHub 저장소에는 다음 정보를 커밋하지 않습니다.

- 실제 이력서의 전화번호·이메일 등 개인정보
- private key
- API token / API key
- 세션 secret
- 기타 인증 비밀값

공개키처럼 노출 자체가 인증 비밀이 아닌 정보와 실제 비밀정보를 구분합니다.

---

## 7. 선택 이유

Passkey/WebAuthn도 후보였지만, 이 프로젝트에서는 직접 만든 로컬 Authenticator와 Challenge-Response 방식을 사용하기로 했습니다.

다만 인증 구조를 직접 구현하더라도 암호 알고리즘 자체를 새로 만들지는 않고 표준 알고리즘을 사용합니다.
