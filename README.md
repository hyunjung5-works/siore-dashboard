# SIORÉ 화장품사업본부 통합 대시보드

블랙 + 민트/사이언 톤의 정적 대시보드. GitHub Pages에 그대로 올리면 됩니다.

```
siore-dashboard/
├── index.html        ← 메인 통합 대시보드 (허브 + 3개 임베드)
├── sales.html        ← 매출 (유통처별 · 일간/주간/월간/제품별)
├── marketing.html    ← 마케팅 (메타 광고 · ROAS · 퍼널 · BEP)
├── inventory.html    ← 재고 (발주 알람 · 국내/FBA · 출고 흐름)
├── assets/
│   ├── theme.css     ← 디자인 시스템 (블랙 헤더 + 민트/사이언)
│   └── data.js       ← 데이터 레이어 (SOURCES + 스냅샷 + gviz 로더)
└── README.md
```

---

## 1. 지금 바로 보기

`index.html`을 브라우저로 열면 됩니다. 내장 스냅샷(2026-07-13 기준)으로 즉시 동작합니다.

---

## 2. ⚠️ 구글시트 실시간 연동 — 필수 설정 1가지

현재 5개 시트 모두 **비공개**라 브라우저에서 직접 읽을 수 없습니다 (gviz 401).
아래를 하면 대시보드가 자동으로 `실시간 연동` 모드로 바뀝니다.

**각 시트에서:** `파일 → 공유 → 웹에 게시(Publish to web)` → **게시**

| 시트 | 파일명 |
|---|---|
| 아마존 US | 아마존 일자별 제품별 데이터 |
| 자사몰 | 시오레_자사몰_월별매출_대시보드 |
| B2B | 2026 시오레 B2B 매출 요약 |
| 광고 | 광고데이터 대시보드 |
| 재고 | 시오레_재고_유통_발주관리_260707 |

> 대안: `공유 → 링크가 있는 모든 사용자 → 뷰어` 로도 동작합니다.
> 사내 도메인 제한이 필요하면 이 방식 대신 **Apps Script 프록시**를 쓰세요 (아래 4번).

설정 후 대시보드 헤더의 뱃지가 `🟡 스냅샷` → `🟢 구글시트 실시간` 으로 바뀝니다.
실패해도 스냅샷으로 폴백하므로 화면이 깨지지 않습니다.

---

## 3. GitHub Pages 배포

### VS Code로 하는 경우 (권장)

VS Code에 GitHub 계정이 로그인돼 있으면 그대로 됩니다.

1. VS Code에서 `siore-dashboard` 폴더 열기
2. `Ctrl/Cmd + Shift + P` → **Publish to GitHub** → 리포지토리 이름 입력 (예: `siore-dashboard`) → Public 선택
3. GitHub 웹에서 해당 repo → **Settings → Pages** → Source: `Deploy from a branch` → Branch: `main` / `(root)` → Save
4. 1~2분 후 `https://<계정>.github.io/siore-dashboard/` 에서 열립니다

### 터미널로 하는 경우

```bash
cd siore-dashboard
git init && git branch -M main
git add . && git commit -m "SIORÉ 화장품사업본부 통합 대시보드"
git remote add origin https://github.com/<계정>/siore-dashboard.git
git push -u origin main
# 이후 GitHub → Settings → Pages 에서 main / (root) 지정
```

---

## 4. 데이터 소스 추가·교체

`assets/data.js` 상단만 고치면 됩니다.

```js
const SOURCES = {
  amazon:  { id:'<시트ID>', gid:'<탭GID>', name:'...' },
  // 국내공구(약사) 시트가 준비되면 여기에 추가
  groupBuy:{ id:'<시트ID>', gid:'<탭GID>', name:'국내공구' },
};
```

**아워박스 / 아마존 SP-API 자동화 예정**이라면, 해당 API를 Apps Script로 받아 시트에 쓰고
대시보드는 그 시트를 읽는 구조가 가장 적은 변경으로 끝납니다 (대시보드 코드 수정 0).

---

## 5. 계산 로직 (검증용)

| 지표 | 산식 |
|---|---|
| 통합 매출 | 아마존 USD × 환율(기본 1,380원) + 자사몰 정가매출 + B2B(VAT 포함) |
| 아마존 전환율 | 주문수량 ÷ PV |
| ROAS | 구매 전환값 ÷ 지출비용 |
| 손익분기 ROAS | 1 ÷ 기여마진율 (기본 60% → BEP 167%) |
| 국내 일평균 소진 | 2026-04-01~07-10 출고량 ÷ 101일 |
| 아마존 일평균 소진 | 최근 30일 판매 ÷ 30 |
| 소진 예상일 | 가용재고 ÷ 일평균 소진 |
| 발주 알람 | 소진예상일 ≤ 리드타임 → 🚨 즉시 / ≤ 리드타임×2 → ⚠️ 검토 |

리드타임은 헤더에서 조정 가능 (국내 기본 45일, 아마존은 최소 60일 강제).
환율도 매출 대시보드 헤더에서 조정하면 전 지표가 즉시 재계산됩니다.

---

## 6. 현재 데이터 공백

| 항목 | 상태 | 해결 |
|---|---|---|
| 국내공구(약사) 매출 | 미정 | 시트 확정 후 `SOURCES.groupBuy` 추가 |
| B2B 매출 | 그리니스트 1건(₩3.17M)만 입력 | 시트에 입력되면 자동 반영 |
| 자사몰 **일자별** RAW | 없음 (월별만) | 시트에 `일자별` 탭 추가하면 일간 대시보드에 채널 추가 가능 |
| 유통기한 | 데이터 없음 | 재고 시트에 유통기한 컬럼 추가 시 경고 탭 확장 가능 |
