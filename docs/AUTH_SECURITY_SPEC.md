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
- 정확한 알고리즘은 아직 확정하지 않음

---

## 3. 키 관리

### 확정

- private key는 로컬 기기에만 보관
- 서버에는 public key만 보관
- GitHub 저장소나 Vercel 환경에 private key를 저장하지 않음
- 집 PC, 노트북 등 여러 기기에서 Authenticator를 사용할 수 있어야 함

### 방향

기기마다 별도의 key pair를 사용할 수 있는 구조를 지향합니다.

### TBD

- 실제 key pair 생성 방식
- private key 저장 위치 및 보호 방식
- 기기 등록 절차
- 기기 해제 / revoke 방식
- 분실 기기 대응 UX
- 사용할 공개키 서명 알고리즘

---

## 4. 편집 세션

### 확정

인증 후 편집 권한은 **마지막 활동을 기준으로 1시간** 유지합니다.

- 사용자가 실제로 작업 중이면 만료 시간이 갱신됨
- 아무 작업이 없으면 idle timeout이 진행됨
- 마지막 활동 이후 1시간이 지나면 편집 권한 만료

목표는 작업 중 갑자기 로그아웃되는 일을 줄이면서, 방치된 브라우저의 편집 권한이 무기한 유지되지 않게 하는 것입니다.

### TBD

- 세션 저장 방식
- HttpOnly / Secure / SameSite 쿠키 사용 여부 등 구체 구현
- 사용자 활동 감지 방식
- heartbeat 필요 여부 및 주기

---

## 5. 인증 세부 UX

다음 항목은 아이디어로 논의되었지만 **아직 확정하지 않았습니다.**

- `resume-auth://` 형태의 Custom URL Protocol
- 브라우저가 Authenticator 승인 완료를 기다리는 방식
- challenge 대신 request ID만 로컬 앱에 전달하는 구조

구현 전에 실제 보안 경계와 사용자 경험을 함께 검토합니다.

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
