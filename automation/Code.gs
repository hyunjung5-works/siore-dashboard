/**
 * ==========================================================
 *  SIORÉ 대시보드 자동 빌드 (Google Apps Script)
 * ----------------------------------------------------------
 *  평일 09:50 / 15:00 (KST)에 실행:
 *    1. 구글시트 6종에서 RAW 읽기
 *    2. assets/snapshot.js 생성
 *    3. GitHub에 커밋 → GitHub Pages 자동 재배포
 *    4. Slack으로 요약 알림
 *
 *  ▶ 최초 1회: setup() 실행 → 트리거 자동 등록
 *  ▶ 수동 테스트: main() 실행
 * ==========================================================
 */

/* ---------- 시트 ID ---------- */
var SHEETS = {
  amazon:    '1Xgtx9hqd7g6k_YAbCfFnK0sxhzE76swfb4YPGm_FwEs',
  ownmall:   '1SkUdqnJ-FEZnN66mCoMPZkEzANuFmKNp084YSTGR2Fk',
  b2b:       '1-vt3_mttqS5o-00ARchz3Pg7ECWhdVvPL2jDrvJGuH8',
  ads:       '1tjqdYvMHwtACkmG00PMoxTt3FLoBD3wBLXolrrBNUlk',
  inventory: '1LCuWeWi8kBJLhl9xyPQW6VQaxDB5TQ2NgQvjsSRE9Yk',
  adsReport: '1kV4E0cReNHHuds2t87ZgZOZbr-R-09Dul9BCmqRMM2I'
};

/* ---------- 설정값 (스크립트 속성에서 읽음) ---------- */
function P_(k) { return PropertiesService.getScriptProperties().getProperty(k); }

/* ==========================================================
   메인
   ========================================================== */
function main() {
  var t0 = new Date();
  var log = [];
  try {
    // 주말 스킵 (트리거가 평일만 걸리지만 이중 방어)
    var dow = new Date().getDay();
    if (dow === 0 || dow === 6) { Logger.log('주말 — 스킵'); return; }

    var snap = buildSnapshot_(log);
    var js   = renderSnapshotJs_(snap);

    var changed = pushToGitHub_(js);
    log.push(changed ? 'GitHub 커밋 완료' : 'GitHub 변경 없음 (동일 내용)');

    notifySlack_(snap, log, changed, (new Date() - t0) / 1000);
    Logger.log(log.join('\n'));

  } catch (e) {
    var msg = '❌ 대시보드 빌드 실패\n```' + e.message + '\n' + (e.stack || '') + '```';
    try { slackPost_({ text: msg }); } catch (e2) {}
    throw e;
  }
}

/* ==========================================================
   1) 스냅샷 빌드
   ========================================================== */
function buildSnapshot_(log) {
  var S = {};

  /* ---- 아마존: 날짜 × 제품 (매출액 / 주문수량 / PV) ---- */
  var az   = SpreadsheetApp.openById(SHEETS.amazon);
  var rev  = readTab_(az, '매출액');
  var qty  = readTab_(az, '주문수량');
  var pv   = readTab_(az, 'PV');

  var names = rev[0].slice(1, 10).map(String);            // 제품 9종
  S.amazonProductNames = names;

  var pvMap = {};
  pv.slice(1).forEach(function (r) {
    var d = ymd_(r[0]); if (!d) return;
    pvMap[d] = sumRow_(r.slice(1, 10));
  });
  var qMap = {};
  qty.slice(1).forEach(function (r) {
    var d = ymd_(r[0]); if (!d) return;
    qMap[d] = r.slice(1, 10).map(num_);
  });

  S.amazonDailyProduct = [];
  rev.slice(1).forEach(function (r) {
    var d = ymd_(r[0]); if (!d) return;
    var rr = r.slice(1, 10).map(num_);
    var qq = qMap[d] || [0,0,0,0,0,0,0,0,0];
    if (sumRow_(rr) === 0 && sumRow_(qq) === 0) return;
    S.amazonDailyProduct.push([d, pvMap[d] || 0, rr, qq]);
  });
  log.push('아마존: ' + S.amazonDailyProduct.length + '일');

  /* ---- 자사몰: 주문라인 원본 [2_계산] ---- */
  var om = readTab_(SpreadsheetApp.openById(SHEETS.ownmall), '2_계산');
  var H  = om[0].map(String);
  var ci = function (n) { return H.indexOf(n); };
  var iD = ci('일자키'), iCh = ci('유통구분'), iP = ci('제품명(집계용)'),
      iQ = ci('수량(유효)'), iG = ci('정가매출(유효)'), iN = ci('순매출(안분)'),
      iO = ci('주문번호'), iX = ci('취소여부'), iCq = ci('취소수량'), iCa = ci('취소정가');

  var days = {}, prodSum = {};
  om.slice(1).forEach(function (r) {
    var d = ymd_(r[iD]); if (!d) return;
    if (!days[d]) days[d] = { o: {}, q: 0, g: 0, n: 0, staff: 0, cq: 0, ca: 0, prod: {} };
    var o = days[d], g = num_(r[iG]), q = num_(r[iQ]);
    o.o[r[iO]] = 1; o.q += q; o.g += g; o.n += num_(r[iN]);
    o.cq += num_(r[iCq]); o.ca += num_(r[iCa]);
    if (String(r[iCh]) === '임직원') { o.staff += g; }
    else { var p = String(r[iP]); o.prod[p] = o.prod[p] || [0,0]; o.prod[p][0] += q; o.prod[p][1] += g;
           prodSum[p] = (prodSum[p] || 0) + g; }
  });
  var oNames = Object.keys(prodSum).sort(function (a,b) { return prodSum[b] - prodSum[a]; });
  S.ownProductNames = oNames.map(function (n) { return n.replace(/^시오레\s*/, ''); });

  S.ownDaily = Object.keys(days).sort().map(function (d) {
    var o = days[d];
    var P = Object.keys(o.prod).map(function (p) {
      return [oNames.indexOf(p), o.prod[p][0], o.prod[p][1]];
    }).filter(function (x) { return x[0] >= 0; });
    return [d, Object.keys(o.o).length, o.q, o.g, Math.round(o.n), o.staff, P];
  });
  log.push('자사몰: ' + S.ownDaily.length + '일');

  // 자사몰 월별/합계 (기존 화면 호환)
  var mAgg = {};
  S.ownDaily.forEach(function (r) {
    var m = r[0].slice(0, 7);
    mAgg[m] = mAgg[m] || { o: 0, q: 0, g: 0, n: 0, cq: 0, ca: 0 };
    mAgg[m].o += r[1]; mAgg[m].q += r[2]; mAgg[m].g += r[3]; mAgg[m].n += r[4];
  });
  Object.keys(days).forEach(function (d) {
    var m = d.slice(0, 7);
    if (mAgg[m]) { mAgg[m].cq += days[d].cq; mAgg[m].ca += days[d].ca; }
  });
  var MONTHS = [];
  for (var mm = 1; mm <= 12; mm++) MONTHS.push('2026-' + pad_(mm));
  S.ownMonthly = MONTHS.map(function (m) {
    var a = mAgg[m] || { o:0,q:0,g:0,n:0,cq:0,ca:0 };
    var disc = a.g ? +(((a.g - a.n) / a.g) * 100).toFixed(1) : 0;
    return [m, a.o, a.q, a.g, a.n, disc, a.o ? Math.round(a.g / a.o) : 0, a.cq, a.ca];
  }).filter(function (r, i) { return i < 12; });

  var tG = S.ownDaily.reduce(function (a, r) { return a + r[3]; }, 0);
  var tN = S.ownDaily.reduce(function (a, r) { return a + r[4]; }, 0);
  var tQ = S.ownDaily.reduce(function (a, r) { return a + r[2]; }, 0);
  var tO = S.ownDaily.reduce(function (a, r) { return a + r[1]; }, 0);
  var tS = S.ownDaily.reduce(function (a, r) { return a + r[5]; }, 0);
  var tCa = S.ownMonthly.reduce(function (a, r) { return a + r[8]; }, 0);
  var tCq = S.ownMonthly.reduce(function (a, r) { return a + r[7]; }, 0);
  S.ownTotals = {
    orders: tO, qty: tQ, gross: tG, net: tN,
    discount: tG ? +(((tG - tN) / tG) * 100).toFixed(1) : 0,
    aov: tO ? Math.round(tG / tO) : 0,
    cancelCnt: tCq, cancelAmt: tCa,
    cancelRate: (tG + tCa) ? +((tCa / (tG + tCa)) * 100).toFixed(1) : 0,
    normal: tG - tS, staff: tS,
    staffShare: tG ? +((tS / tG) * 100).toFixed(1) : 0
  };
  // 제품 × 월 (일반주문)
  var opm = {};
  S.ownDaily.forEach(function (r) {
    var m = r[0].slice(0, 7);
    r[6].forEach(function (p) {
      opm[p[0]] = opm[p[0]] || {};
      opm[p[0]][m] = (opm[p[0]][m] || 0) + p[2];
    });
  });
  var OM7 = MONTHS.slice(0, 7);
  S.ownProductMonthly = {
    months: OM7,
    rows: Object.keys(opm).map(function (i) {
      return [S.ownProductNames[i], OM7.map(function (m) { return opm[i][m] || 0; })];
    }),
    note: '일반주문 기준 (임직원 매출 제외)'
  };
  S.ownProduct = S.ownProductMonthly.rows.map(function (r) {
    return [r[0], r[1].reduce(function (a, b) { return a + b; }, 0)];
  }).sort(function (a, b) { return b[1] - a[1]; });

  /* ---- B2B: 주문라인 [①매출입력] ---- */
  var b = readTab_(SpreadsheetApp.openById(SHEETS.b2b), '①매출입력');
  var BH = b[0].map(String), bi = function (n) { return BH.indexOf(n); };
  var accSet = [];
  S.b2bRaw = [];
  b.slice(1).forEach(function (r) {
    var d = ymd_(r[bi('일자')]); if (!d) return;
    var acc = String(r[bi('거래처')]);
    if (accSet.indexOf(acc) < 0) accSet.push(acc);
    S.b2bRaw.push([d, accSet.indexOf(acc),
      String(r[bi('주문구분')]) === '샘플' ? 'S' : 'O',
      String(r[bi('제품명')]), num_(r[bi('수량')]), num_(r[bi('합계금액')])]);
  });
  S.b2bAccountNames = accSet;
  log.push('B2B: ' + S.b2bRaw.length + '행');

  /* ---- 메타 광고 일자별 ---- */
  var ad = readTab_(SpreadsheetApp.openById(SHEETS.ads), '2026 메타 광고 월별 데이터_RAW');
  S.adsDaily = [];
  ad.forEach(function (r) {
    var mo = String(r[0] || '').replace('월', '');
    var dy = String(r[1] || '').replace('일', '');
    if (!/^\d+$/.test(mo) || !/^\d+$/.test(dy)) return;
    var spend = num_(r[2]); if (!spend) return;
    S.adsDaily.push(['2026-' + pad_(+mo) + '-' + pad_(+dy), spend, num_(r[3]), num_(r[4]),
      num_(r[5]), num_(r[6]) * (String(r[6]).indexOf('%') >= 0 ? 100 : 1),
      num_(r[8]), num_(r[9]), num_(r[10]) * (String(r[10]).indexOf('%') >= 0 ? 100 : 1)]);
  });
  log.push('광고: ' + S.adsDaily.length + '일');

  /* ---- 아마존 마케팅 리포트: 매체별 / 상품군별 ---- */
  try {
    var mk = readTab_(SpreadsheetApp.openById(SHEETS.adsReport), '통합');
    S.adsChannels = [];
    S.adsProducts = [];
    mk.forEach(function (r, i) {
      var c1 = String(r[1] || '');
      if (c1 === 'Amazon SP' || c1 === 'Meta') {
        S.adsChannels.push([c1, num_(r[2]), num_(r[3]), num_(r[4]), num_(r[5]), num_(r[6]), num_(r[7]), num_(r[8])]);
      }
      if (c1.indexOf('Siore ') === 0) {
        S.adsProducts.push([c1.replace(/^Siore\s*/, '').split('|')[0].trim(),
          num_(r[2]), num_(r[3]), num_(r[4]), num_(r[5]), num_(r[6]), num_(r[7]), num_(r[8])]);
      }
    });
    S.adsBudgetKRW = 39200000;
    log.push('광고리포트: 매체 ' + S.adsChannels.length + ' / 상품 ' + S.adsProducts.length);
  } catch (e) { log.push('⚠️ 광고리포트 읽기 실패 — 이전 값 유지 필요'); }

  /* ---- 재고 ---- */
  var inv = SpreadsheetApp.openById(SHEETS.inventory);
  var st  = readTab_(inv, '1.현재고현황');
  var asOf = String(st[0][0] || '');
  var m1 = asOf.match(/아워박스\s*(\d{4}-\d{2}-\d{2})/);
  var m2 = asOf.match(/아마존\s*(\d{4}-\d{2}-\d{2})/);
  S.stockAsOf = { ourbox: m1 ? m1[1] : '', amazon: m2 ? m2[1] : '' };

  S.stock = [];
  st.forEach(function (r) {
    var code = String(r[0] || '').replace(/,/g, '');
    if (!/^\d{9,12}$/.test(code)) return;
    S.stock.push([code, String(r[1]), String(r[2]), String(r[3]),
      num_(r[4]), num_(r[5]), num_(r[6]), r[7] === '-' || r[7] === '' ? null : num_(r[7]),
      num_(r[9])]);
  });
  log.push('재고: ' + S.stock.length + ' SKU');

  /* ---- 발주 관리 ---- */
  var po = readTab_(inv, '7.발주관리(국내)');
  S.purchaseOrders = [];
  S.reorderNeed = [];
  var inLog = false;
  po.forEach(function (r) {
    var c0 = String(r[0] || ''), c1 = String(r[1] || '');
    if (c0.indexOf('[발주 로그') === 0) { inLog = true; return; }
    var code = c0.replace(/,/g, '');
    if (!/^\d{9,12}$/.test(code)) return;
    if (inLog) {
      var od = ymd_(r[3]), eta = ymd_(r[4]);
      if (num_(r[2]) > 0 && od) S.purchaseOrders.push([c1, num_(r[2]), od, eta || '']);
    } else {
      var need = num_(r[2]), onOrd = num_(r[3]), net = num_(r[4]);
      if (need > 0) S.reorderNeed.push([c1, need, onOrd, net]);
    }
  });
  log.push('발주: 진행 ' + S.purchaseOrders.length + '건 / 필요 ' + S.reorderNeed.length + '종');

  /* ---- 국내 출고 (8.출고내역: 제품 × 월 누계) ---- */
  var sh = readTab_(inv, '8.출고내역');
  var MON = ['4월','5월','6월','7월'];
  S.shipProductMonth = { months: ['4월','5월','6월','7월*'], rows: [],
    rrpUnitsPerBox: { '(약국) RRP + 프레쉬 버블 토너': 8, '(약국) RRP + 인텐시브 세럼': 10, '(약국) RRP + 카밍 수딩 젤': 10 } };
  sh.forEach(function (r) {
    var code = String(r[0] || '').replace(/,/g, '');
    if (!/^\d{9,12}$/.test(code)) return;
    var nm = String(r[1]);
    if (nm.indexOf('[US]') === 0) return;                 // 국내만
    var v = [num_(r[2]), num_(r[3]), num_(r[4]), num_(r[5])];
    if (v.reduce(function (a,b) { return a+b; }, 0) === 0) return;
    S.shipProductMonth.rows.push([shortName_(nm), v]);
  });

  /* ---- 유통처 × 월 (2.유통처별출고_월별 상단 요약) ---- */
  var f2 = readTab_(inv, '2.유통처별출고_월별');
  S.shipChannelMonth = { months: ['4월','5월','6월','7월*'], rows: [] };
  var started = false;
  for (var i = 0; i < f2.length; i++) {
    var c0 = String(f2[i][0] || '');
    if (c0 === '유통처') { started = true; continue; }
    if (!started) continue;
    if (c0 === '합계' || c0 === '') break;
    S.shipChannelMonth.rows.push([c0, [num_(f2[i][1]), num_(f2[i][2]), num_(f2[i][3]), num_(f2[i][4])]]);
  }

  S.groupBuy = { status: 'pending', months: [], note: '매출 데이터 미입력 · 시트 연결 후 자동 반영' };

  return S;
}

/* ==========================================================
   2) snapshot.js 렌더
   ========================================================== */
function renderSnapshotJs_(S) {
  var now = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
  return [
    '/* ==========================================================',
    '   SIORÉ 대시보드 · 데이터 스냅샷',
    '   ⚠️ Google Apps Script 자동 생성 — 직접 수정하지 마세요.',
    '   ========================================================== */',
    "const GENERATED_AT = '" + now + " KST';",
    '',
    'const SNAP = ' + JSON.stringify(S, null, 1) + ';',
    ''
  ].join('\n');
}

/* ==========================================================
   3) GitHub 커밋
   ========================================================== */
function pushToGitHub_(content) {
  var owner  = P_('GH_OWNER');
  var repo   = P_('GH_REPO');
  var branch = P_('GH_BRANCH') || 'main';
  var path   = P_('GH_PATH')   || 'assets/snapshot.js';
  var token  = P_('GH_TOKEN');
  if (!owner || !repo || !token) throw new Error('스크립트 속성(GH_OWNER/GH_REPO/GH_TOKEN)이 없습니다.');

  var api = 'https://api.github.com/repos/' + owner + '/' + repo + '/contents/' + path;
  var hdr = {
    Authorization: 'Bearer ' + token,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };

  // 기존 파일 sha 조회
  var sha = null, prev = null;
  var getRes = UrlFetchApp.fetch(api + '?ref=' + branch,
    { method: 'get', headers: hdr, muteHttpExceptions: true });
  if (getRes.getResponseCode() === 200) {
    var j = JSON.parse(getRes.getContentText());
    sha = j.sha;
    prev = Utilities.newBlob(Utilities.base64Decode(j.content.replace(/\n/g, ''))).getDataAsString();
  }
  // 데이터가 동일하면 커밋 스킵 (GENERATED_AT 줄 제외 비교)
  if (prev && strip_(prev) === strip_(content)) return false;

  var body = {
    message: 'chore(data): 스냅샷 자동 갱신 ' +
             Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm'),
    content: Utilities.base64Encode(content, Utilities.Charset.UTF_8),
    branch: branch
  };
  if (sha) body.sha = sha;

  var res = UrlFetchApp.fetch(api, {
    method: 'put', headers: hdr, contentType: 'application/json',
    payload: JSON.stringify(body), muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 300) {
    throw new Error('GitHub 커밋 실패 (' + res.getResponseCode() + '): ' + res.getContentText().slice(0, 300));
  }
  return true;
}
function strip_(s) { return s.replace(/const GENERATED_AT[^\n]*\n/, ''); }

/* ==========================================================
   4) Slack 알림
   ========================================================== */
function notifySlack_(S, log, changed, secs) {
  var url = P_('SLACK_WEBHOOK');
  if (!url) return;

  var FX = fxRate_();
  var base = S.amazonDailyProduct[S.amazonDailyProduct.length - 1][0];
  var ownLast = S.ownDaily[S.ownDaily.length - 1][0];
  if (ownLast > base) base = ownLast;

  var wkFrom = shiftDays_(base, -6);
  var pwFrom = shiftDays_(base, -13), pwTo = shiftDays_(base, -7);

  var amzWk = sumAmz_(S, wkFrom, base), amzPw = sumAmz_(S, pwFrom, pwTo);
  var ownWk = sumOwn_(S, wkFrom, base), ownPw = sumOwn_(S, pwFrom, pwTo);
  var b2bWk = sumB2b_(S, wkFrom, base), b2bPw = sumB2b_(S, pwFrom, pwTo);

  var wk = amzWk * FX + ownWk + b2bWk;
  var pw = amzPw * FX + ownPw + b2bPw;
  var wow = pw ? ((wk - pw) / pw * 100) : 0;

  // 발주 위험
  var risk = reorderRisk_(S);

  // 광고 ROAS
  var spend = 0, adRev = 0;
  (S.adsChannels || []).forEach(function (c) { spend += c[3]; adRev += c[7]; });
  var roas = spend ? (adRev / spend * 100) : 0;

  var blocks = [
    { type: 'header', text: { type: 'plain_text', text: '📊 시오레 대시보드 갱신', emoji: true } },
    { type: 'context', elements: [{ type: 'mrkdwn',
      text: Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm') + ' KST · 기준일 ' + base +
            ' · 환율 $1=' + Math.round(FX).toLocaleString() + '원 · ' + secs.toFixed(1) + '초' }] },
    { type: 'section', fields: [
      { type: 'mrkdwn', text: '*주간 매출*\n' + won_(wk) + '  (' + (wow >= 0 ? '▲' : '▼') + Math.abs(wow).toFixed(1) + '%)' },
      { type: 'mrkdwn', text: '*채널별*\n아마존 ' + won_(amzWk * FX) + ' / 자사몰 ' + won_(ownWk) + ' / B2B ' + won_(b2bWk) },
      { type: 'mrkdwn', text: '*통합 ROAS*\n' + roas.toFixed(0) + '%  (BEP 167%)' },
      { type: 'mrkdwn', text: '*발주 위험*\n' + (risk.length ? '🚨 ' + risk.length + '개 SKU' : '✅ 없음') }
    ]}
  ];

  if (risk.length) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn',
      text: '*🚨 즉시 발주 필요*\n' + risk.map(function (r) {
        return '• *' + r.n + '* — 재고 ' + r.st.toLocaleString() + '개 · 소진 *' + r.runway + '일*' +
               (r.eta ? ' · 입고예정 ' + r.eta + ' (*공백 ' + r.gap + '일*)' : ' · _발주 미등록_');
      }).join('\n') } });
  }
  if (roas < 167) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn',
      text: '⚠️ *통합 ROAS ' + roas.toFixed(0) + '% — 손익분기(167%) 미달.* 광고를 태울수록 손해입니다.' } });
  }

  blocks.push({ type: 'actions', elements: [{ type: 'button',
    text: { type: 'plain_text', text: '대시보드 열기', emoji: true },
    url: P_('DASH_URL') || 'https://github.com', style: 'primary' }] });
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn',
    text: (changed ? '✅ 배포됨 · ' : '➖ 변경 없음 · ') + log.join(' · ') }] });

  slackPost_({ text: '시오레 대시보드 갱신 — 주간 ' + won_(wk), blocks: blocks });
}

function slackPost_(payload) {
  var url = P_('SLACK_WEBHOOK'); if (!url) return;
  UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json',
    payload: JSON.stringify(payload), muteHttpExceptions: true });
}

/* ---------- 발주 위험 계산 (대시보드와 동일 로직) ---------- */
function reorderRisk_(S) {
  var DOM_DAYS = 101, LT = 45, BUF_D = 14, LT_US = 60, BUF_US = 21;
  var shipTot = {};
  S.shipProductMonth.rows.forEach(function (r) {
    shipTot[r[0]] = r[1].reduce(function (a, b) { return a + b; }, 0);
  });
  var poMap = {};
  S.purchaseOrders.forEach(function (p) { if (!poMap[p[0]]) poMap[p[0]] = p; });

  var out = [];
  S.stock.forEach(function (r) {
    var isUS = r[2] === 'US';
    var st = isUS ? r[5] : r[4];
    var daily = isUS ? (r[7] || 0) / 30 : (shipTot[shortName_(r[1])] || 0) / DOM_DAYS;
    if (!daily) return;
    var runway = st / daily;
    var th = isUS ? (LT_US + BUF_US) : (LT + BUF_D);
    if (runway > th) return;
    var po = poMap[r[1].replace('[US] ', '')];
    var eta = po ? po[3] : null;
    var gap = null;
    if (eta) {
      var etaDays = Math.round((new Date(eta) - new Date(S.stockAsOf.amazon || S.stockAsOf.ourbox)) / 86400000);
      gap = Math.max(0, etaDays - Math.round(runway));
    }
    out.push({ n: r[1], st: st, runway: Math.round(runway), eta: eta, gap: gap });
  });
  return out.sort(function (a, b) { return a.runway - b.runway; });
}

/* ---------- 기간 합계 ---------- */
function sumAmz_(S, f, t) {
  return S.amazonDailyProduct.filter(function (r) { return r[0] >= f && r[0] <= t; })
    .reduce(function (a, r) { return a + r[2].reduce(function (x, y) { return x + y; }, 0); }, 0);
}
function sumOwn_(S, f, t) {
  return S.ownDaily.filter(function (r) { return r[0] >= f && r[0] <= t; })
    .reduce(function (a, r) { return a + r[3]; }, 0);
}
function sumB2b_(S, f, t) {
  return S.b2bRaw.filter(function (r) { return r[2] === 'O' && r[0] >= f && r[0] <= t; })
    .reduce(function (a, r) { return a + r[5]; }, 0);
}

/* ---------- 환율 ---------- */
function fxRate_() {
  try {
    var r = UrlFetchApp.fetch('https://open.er-api.com/v6/latest/USD', { muteHttpExceptions: true });
    return JSON.parse(r.getContentText()).rates.KRW || 1400;
  } catch (e) { return 1400; }
}

/* ==========================================================
   유틸
   ========================================================== */
function readTab_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh) throw new Error('탭을 찾을 수 없음: ' + name + ' (' + ss.getName() + ')');
  return sh.getDataRange().getDisplayValues();
}
function num_(v) {
  if (v === null || v === undefined || v === '' || v === '-') return 0;
  var n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? 0 : n;
}
function sumRow_(a) { return a.reduce(function (x, y) { return x + num_(y); }, 0); }
function pad_(n) { return (n < 10 ? '0' : '') + n; }
function ymd_(v) {
  if (!v) return null;
  var s = String(v).trim();
  var m = s.match(/(\d{4})[.\-\/\s]+(\d{1,2})[.\-\/\s]+(\d{1,2})/);
  return m ? m[1] + '-' + pad_(+m[2]) + '-' + pad_(+m[3]) : null;
}
function shiftDays_(d, n) {
  var x = new Date(d + 'T00:00:00Z');
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}
function won_(n) {
  n = Math.round(n || 0);
  if (n >= 100000000) return (n / 100000000).toFixed(2) + '억';
  if (n >= 10000) return Math.round(n / 10000).toLocaleString() + '만원';
  return n.toLocaleString() + '원';
}
function shortName_(n) {
  return String(n)
    .replace('(약국) RRP 박스 + NMN ', '(약국) RRP + ')
    .replace('(약국) RRP 박스 + 데일리 릴리프 ', '(약국) RRP + ')
    .replace('(약국) RRP 박스 + ', '(약국) RRP + ')
    .replace(/\(\d+EA\)/, '')
    .trim();
}

/* ==========================================================
   최초 1회: 트리거 등록
   ========================================================== */
function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'main') ScriptApp.deleteTrigger(t);
  });
  var DAYS = [ScriptApp.WeekDay.MONDAY, ScriptApp.WeekDay.TUESDAY, ScriptApp.WeekDay.WEDNESDAY,
              ScriptApp.WeekDay.THURSDAY, ScriptApp.WeekDay.FRIDAY];
  DAYS.forEach(function (d) {
    ScriptApp.newTrigger('main').timeBased().onWeekDay(d).atHour(9).nearMinute(50).create();
    ScriptApp.newTrigger('main').timeBased().onWeekDay(d).atHour(15).nearMinute(0).create();
  });
  Logger.log('트리거 ' + ScriptApp.getProjectTriggers().length + '개 등록 완료 (평일 09:50 / 15:00 KST)');
  slackPost_({ text: '✅ 시오레 대시보드 자동 갱신이 설정되었습니다. (평일 09:50 / 15:00 KST)' });
}
