# 대시보드 자동 갱신 설정 (30분)

**동작:** 평일 09:50 / 15:00 (KST) → 구글시트 6종 읽기 → `assets/snapshot.js` 생성 → GitHub 자동 커밋 → Pages 재배포 → Slack 알림

시트를 외부에 공개하지 않아도 되고, PC를 켜둘 필요도 없습니다. 구글 서버에서 돌아갑니다.

---

## 1단계 — GitHub 토큰 발급 (5분)

대시보드 repo에 파일 하나(`assets/snapshot.js`)만 쓸 수 있는 최소 권한 토큰을 만듭니다.

1. GitHub → 우측 상단 프로필 → **Settings**
2. 좌측 맨 아래 **Developer settings** → **Personal access tokens** → **Fine-grained tokens**
3. **Generate new token**
   - **Token name**: `siore-dashboard-bot`
   - **Expiration**: 1년 (만료 시 재발급 필요 — 캘린더에 미리 등록해두세요)
   - **Repository access**: `Only select repositories` → 대시보드 repo 선택
   - **Permissions** → Repository permissions → **Contents: Read and write** (이것만)
4. **Generate token** → **`github_pat_...` 문자열을 복사** (이 화면을 벗어나면 다시 못 봅니다)

> ⚠️ 이 토큰은 비밀번호입니다. 채팅·메일·문서에 붙여넣지 마시고, 3단계에서 스크립트 속성에만 넣으세요.

---

## 2단계 — Slack Webhook 발급 (5분)

1. https://api.slack.com/apps → **Create New App** → **From scratch**
   - App Name: `시오레 대시보드`, 워크스페이스 선택
2. 좌측 **Incoming Webhooks** → 토글 **On**
3. **Add New Webhook to Workspace** → 알림 받을 채널 선택 → 허용
4. 생성된 **`https://hooks.slack.com/services/...`** URL 복사

---

## 3단계 — Apps Script 프로젝트 만들기 (10분)

1. https://script.google.com → **새 프로젝트**
2. 프로젝트 이름: `시오레 대시보드 자동갱신`
3. 좌측 `Code.gs` 내용을 **전부 지우고** → 이 폴더의 **`Code.gs`** 내용을 통째로 붙여넣기
4. ⚙️ **프로젝트 설정** → **"appsscript.json" 매니페스트 파일 표시** 체크
5. 좌측에 생긴 `appsscript.json` 클릭 → 이 폴더의 **`appsscript.json`** 내용으로 교체
6. ⚙️ **프로젝트 설정** → 맨 아래 **스크립트 속성** → **속성 추가**로 아래 6개 입력

| 속성 | 값 | 예시 |
|---|---|---|
| `GH_OWNER` | GitHub 계정명 | `khh8434-theo` |
| `GH_REPO` | repo 이름 | `siore-dashboard` |
| `GH_BRANCH` | 브랜치 | `main` |
| `GH_PATH` | 파일 경로 | `assets/snapshot.js` |
| `GH_TOKEN` | 1단계 토큰 | `github_pat_...` |
| `SLACK_WEBHOOK` | 2단계 URL | `https://hooks.slack.com/services/...` |
| `DASH_URL` | 대시보드 주소 | `https://khh8434-theo.github.io/siore-dashboard/` |

7. **저장**

---

## 4단계 — 테스트 & 트리거 등록 (5분)

1. 상단 함수 선택 드롭다운에서 **`main`** 선택 → **실행**
2. 첫 실행 시 권한 요청 → **권한 검토** → 계정 선택 → *"이 앱은 확인되지 않았습니다"* 나오면 **고급** → **(안전하지 않음)으로 이동** → **허용**
   - 본인이 만든 스크립트라 안전합니다.
3. 실행 로그에 `GitHub 커밋 완료`가 뜨고 **Slack에 알림이 오면 성공**입니다.
4. GitHub repo에서 `assets/snapshot.js`가 방금 시각으로 갱신됐는지 확인
5. 마지막으로 함수 드롭다운에서 **`setup`** 선택 → **실행**
   → 평일 09:50 / 15:00 트리거 10개가 자동 등록됩니다.

---

## 확인 방법

- **트리거 확인**: Apps Script 좌측 ⏰ **트리거** 메뉴 → 10개 (평일 × 2회)
- **실행 이력**: 좌측 **실행** 메뉴에서 성공/실패 확인
- **실패 시**: Slack으로 `❌ 대시보드 빌드 실패` + 에러 메시지가 자동 발송됩니다

---

## 알아두실 점

**⏱ 정확히 09:50이 아닙니다.**
구글 시간 트리거는 **±15분 오차**가 있습니다 (09:35~10:05 사이 실행). RAW 업데이트를 09:50까지 끝내신다면, 안전하게 **10:00 트리거로 바꾸는 것**을 권합니다 — `Code.gs`의 `setup()`에서 `atHour(9).nearMinute(50)` → `atHour(10).nearMinute(0)`.

**🔄 변경이 없으면 커밋하지 않습니다.**
시트 내용이 그대로면 GitHub 커밋을 건너뛰어 히스토리가 지저분해지지 않습니다. Slack에는 `➖ 변경 없음`으로 표시됩니다.

**🔑 토큰 만료.**
1년 뒤 토큰이 만료되면 빌드가 실패하고 Slack으로 알림이 옵니다. 재발급 후 `GH_TOKEN`만 교체하면 됩니다.

**📋 시트 구조가 바뀌면 깨집니다.**
스크립트는 아래 탭 이름과 컬럼명에 의존합니다. **탭 이름·헤더명을 바꾸지 마세요.**

| 시트 | 탭 | 의존 컬럼 |
|---|---|---|
| 아마존 | `매출액` `주문수량` `PV` | 날짜 + 제품 9열 |
| 자사몰 | `2_계산` | 일자키 / 유통구분 / 제품명(집계용) / 수량(유효) / 정가매출(유효) / 순매출(안분) / 주문번호 |
| B2B | `①매출입력` | 일자 / 거래처 / 주문구분 / 제품명 / 수량 / 합계금액 |
| 광고 | `2026 메타 광고 월별 데이터_RAW` | 월 / 일 / 지출비용 … |
| 마케팅 | `통합` | 매체별·상품군별 블록 |
| 재고 | `1.현재고현황` `7.발주관리(국내)` `8.출고내역` `2.유통처별출고_월별` | — |

바뀌면 `Code.gs`의 해당 탭 이름만 고치면 됩니다.
