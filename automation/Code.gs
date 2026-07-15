/**
 * ==========================================================
 *  SIORÉ 대시보드 자동 빌드 (Google Apps Script)
 * ----------------------------------------------------------
 *  ⏰ 10:00 데일리 스크럼 전 갱신 보장 설계
 *
 *  구글의 "시간 지정 트리거"는 ±15분 오차가 있어
 *  09:50로 걸면 10:05에 돌 수도 있습니다 (스크럼 지각).
 *  → 그래서 5분마다 tick 하고, 지정 창(window)에서만 실제 빌드합니다.
 *
 *  오전: 09:50 ~ 09:58 사이 첫 tick에 빌드 → 스크럼 전 완료 보장
 *  오후: 15:00 ~ 15:10 사이 첫 tick에 빌드
 *  (하루 1회씩만 실행 — 실행 플래그로 중복 방지)
 *
 *  09:59까지 빌드가 안 끝나면 Slack으로 경고를 보냅니다.
 *
 *  ▶ 최초 1회: setup() 실행 → 트리거 자동 등록
 *  ▶ 수동 테스트: runNow() 실행
 * ==========================================================
 */

/* ---------- 실행 창 (KST) ----------
   창을 넉넉히 잡아 5분 트리거가 지연/누락돼도 반드시 걸리게 한다.
   오전 09:45~09:59 (스크럼 10:00 전 완료) · 오후 15:00~15:14
   notify: 정기 Slack 요약 발송 여부 (오전만 true, 오후는 조용히 갱신)
           ※ '빌드 실패' 알림은 notify와 무관하게 항상 발송 */
var WINDOWS = [
  { key: 'AM', from: '09:45', to: '09:59', deadline: '10:00', label: '오전 (스크럼 전)', notify: true },
  { key: 'PM', from: '15:00', to: '15:14', deadline: '15:15', label: '오후',           notify: false }
];

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
   tick — 5분마다 호출됨. 창 안에서만 실제 빌드.
   ========================================================== */
function tick() {
  var now  = new Date();
  var dow  = now.getDay();
  if (dow === 0 || dow === 6) return;                 // 주말 스킵

  var hhmm  = Utilities.formatDate(now, 'Asia/Seoul', 'HH:mm');
  var today = Utilities.formatDate(now, 'Asia/Seoul', 'yyyy-MM-dd');
  var props = PropertiesService.getScriptProperties();

  for (var i = 0; i < WINDOWS.length; i++) {
    var w    = WINDOWS[i];
    var flag = 'DONE_' + w.key + '_' + today;

    // 이미 오늘 이 창에서 실행됨 → 스킵
    if (props.getProperty(flag)) continue;

    // 실행 창 안 → 빌드 (오전만 Slack 요약 발송)
    if (hhmm >= w.from && hhmm <= w.to) {
      props.setProperty(flag, hhmm);
      runBuild_(w.label + ' 자동 갱신', w.notify);
      cleanFlags_(props, today);
      return;
    }

    // 마감을 넘겼는데 아직 안 돌았음 → (오전만) 경고 후 즉시 강행
    if (hhmm > w.deadline && hhmm < shiftHHMM_(w.deadline, 30)) {
      props.setProperty(flag, hhmm + ' (지연)');
      if (w.notify) {
        slackPost_({ text: '⚠️ *' + w.label + ' 갱신이 예정 시각(' + w.from + ')을 넘겼습니다.* ' +
                           hhmm + '에 강행합니다 — 스크럼 자료가 늦을 수 있습니다.' });
      }
      runBuild_(w.label + ' 지연 갱신', w.notify);
      return;
    }
  }
}

/* ---------- 실제 빌드 ----------
   notify=false 면 정기 요약 Slack을 보내지 않는다 (오후 갱신용).
   단, 빌드 '실패' 알림은 notify와 무관하게 항상 발송한다. */
function runBuild_(reason, notify) {
  if (notify === undefined) notify = true;   // 기본 발송
  var t0 = new Date();
  var log = [reason];
  try {
    var snap = buildSnapshot_(log);
    var js   = renderSnapshotJs_(snap);

    var changed = pushToGitHub_(js);
    log.push(changed ? 'GitHub 커밋 완료' : 'GitHub 변경 없음 (동일 내용)');

    if (notify) notifySlack_(snap, log, changed, (new Date() - t0) / 1000);
    Logger.log(log.join('\n') + (notify ? '' : '\n(Slack 요약 생략 — 오후 갱신)'));

  } catch (e) {
    // 실패는 오전/오후 무관하게 항상 알림 (조용히 실패 방지)
    var msg = '❌ *대시보드 빌드 실패* (' + reason + ')\n```' + e.message + '\n' +
              String(e.stack || '').slice(0, 400) + '```';
    try { slackPost_({ text: msg }); } catch (e2) {}
    throw e;
  }
}

/* 수동 실행용 (창 무시, 요약 발송) */
function runNow() { runBuild_('수동 실행', true); }

/* 오래된 실행 플래그 정리 (3일 전 이상 삭제) */
function cleanFlags_(props, today) {
  var all = props.getProperties();
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('DONE_') !== 0) return;
    var d = k.split('_')[2];
    if (d && d < shiftDays_(today, -3)) props.deleteProperty(k);
  });
}

function shiftHHMM_(hhmm, addMin) {
  var p = hhmm.split(':');
  var t = (+p[0]) * 60 + (+p[1]) + addMin;
  return pad_(Math.floor(t / 60) % 24) + ':' + pad_(t % 60);
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

  /* ---- 메타 광고 일자별 (탭명 개편 대응: '메타') ---- */
  S.adsDaily = [];
  try {
    var adSS = SpreadsheetApp.openById(SHEETS.ads);
    var ad;
    try { ad = readTab_(adSS, ['메타', '2026 메타 광고 월별 데이터_RAW', 'Meta']); }
    catch (e0) { ad = readTabByGid_(adSS, 1082528091); }   // 최후: gid로

    // 헤더 위치 자동 탐색 (월/일/지출비용)
    ad.forEach(function (r) {
      var mo = String(r[0] || '').replace('월', '').trim();
      var dy = String(r[1] || '').replace('일', '').trim();
      if (!/^\d{1,2}$/.test(mo) || !/^\d{1,2}$/.test(dy)) return;
      var spend = num_(r[2]); if (!spend) return;
      S.adsDaily.push(['2026-' + pad_(+mo) + '-' + pad_(+dy), spend, num_(r[3]), num_(r[4]),
        num_(r[5]), num_(r[6]), num_(r[8]), num_(r[9]), num_(r[10])]);
    });
    log.push('메타광고: ' + S.adsDaily.length + '일');
  } catch (e) {
    log.push('⚠️ 메타광고 탭 읽기 실패 — ' + e.message.split('\n')[0]);
  }

  /* ---- 아마존 마케팅 리포트: 매체별 / 상품군별 ---- */
  S.adsChannels = [];
  S.adsProducts = [];
  S.adsBudgetKRW = 39200000;
  try {
    var mk = readTab_(SpreadsheetApp.openById(SHEETS.adsReport), ['통합', 'Summary']);
    mk.forEach(function (r) {
      var c1 = String(r[1] || '').trim();
      if (c1 === 'Amazon SP' || c1 === 'Meta') {
        S.adsChannels.push([c1, num_(r[2]), num_(r[3]), num_(r[4]), num_(r[5]), num_(r[6]), num_(r[7]), num_(r[8])]);
      }
      if (c1.indexOf('Siore ') === 0) {
        S.adsProducts.push([c1.replace(/^Siore\s*/, '').split('|')[0].trim(),
          num_(r[2]), num_(r[3]), num_(r[4]), num_(r[5]), num_(r[6]), num_(r[7]), num_(r[8])]);
      }
    });
    log.push('광고리포트: 매체 ' + S.adsChannels.length + ' / 상품 ' + S.adsProducts.length);
  } catch (e) {
    log.push('⚠️ 광고리포트 읽기 실패 — ' + e.message.split('\n')[0]);
  }

  /* ---- 재고 : RAW 탭 우선, 없으면 1.현재고현황 ---- */
  var inv = SpreadsheetApp.openById(SHEETS.inventory);
  buildStock_(inv, S, log);

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
   4) Slack 알림 — 시오레 일별 매출 리포트
   ========================================================== */
function won10k_(n) { return Math.round((n || 0) / 10000).toLocaleString() + '만원'; }
function qty_(n) { return Math.round(n || 0).toLocaleString() + '개'; }
function md_(d) { return d ? d.slice(5) : '—'; }              // MM-DD

/* 채널별 특정일 [수량, 매출KRW] */
function amzDay_(S, date, FX) {
  var r = null; for (var i = 0; i < S.amazonDailyProduct.length; i++) if (S.amazonDailyProduct[i][0] === date) { r = S.amazonDailyProduct[i]; break; }
  if (!r) return [0, 0];
  return [r[3].reduce(function (a, b) { return a + b; }, 0), r[2].reduce(function (a, b) { return a + b; }, 0) * FX];
}
function ownDay_(S, date) {
  var r = null; for (var i = 0; i < S.ownDaily.length; i++) if (S.ownDaily[i][0] === date) { r = S.ownDaily[i]; break; }
  return r ? [r[2], r[3]] : [0, 0];
}
function b2bDay_(S, date) {
  var q = 0, v = 0;   // 주문 O + 샘플 S 모두 매출로 집계
  S.b2bRaw.forEach(function (r) { if (r[0] === date) { q += r[4]; v += r[5]; } });
  return [q, v];
}
/* 채널별 월 [수량, 매출KRW] */
function amzMon_(S, m, FX) {
  var q = 0, v = 0;
  S.amazonDailyProduct.forEach(function (r) { if (r[0].slice(0, 7) === m) { q += r[3].reduce(function (a, b) { return a + b; }, 0); v += r[2].reduce(function (a, b) { return a + b; }, 0) * FX; } });
  return [q, v];
}
function ownMon_(S, m) {
  var q = 0, v = 0;
  S.ownDaily.forEach(function (r) { if (r[0].slice(0, 7) === m) { q += r[2]; v += r[3]; } });
  return [q, v];
}
function b2bMon_(S, m) {
  var q = 0, v = 0;   // 주문 + 샘플 모두 매출로
  S.b2bRaw.forEach(function (r) { if (r[0].slice(0, 7) === m) { q += r[4]; v += r[5]; } });
  return [q, v];
}

function notifySlack_(S, log, changed, secs) {
  var url = P_('SLACK_WEBHOOK');
  if (!url) return;

  var FX = fxRate_();

  // 각 채널의 최신 데이터일
  var amzDate = S.amazonDailyProduct[S.amazonDailyProduct.length - 1][0];
  var ownDate = S.ownLastDay || S.ownDaily[S.ownDaily.length - 1][0];
  var b2bDates = S.b2bRaw.filter(function (r) { return r[2] === 'O'; }).map(function (r) { return r[0]; }).sort();
  var b2bDate = b2bDates.length ? b2bDates[b2bDates.length - 1] : '';
  var curM = (ownDate > amzDate ? ownDate : amzDate).slice(0, 7);   // 대표 월

  // 일간 (각 채널 최신일)
  var aD = amzDay_(S, amzDate, FX), bD = b2bDay_(S, b2bDate), oD = ownDay_(S, ownDate);
  var dQty = aD[0] + bD[0] + oD[0], dRev = aD[1] + bD[1] + oD[1];

  // 월간 (대표 월)
  var aM = amzMon_(S, curM, FX), bM = b2bMon_(S, curM), oM = ownMon_(S, curM);
  var mQty = aM[0] + bM[0] + oM[0], mRev = aM[1] + bM[1] + oM[1];

  // 마케팅 (메타 일별/주별)
  var ads = (S.adsDaily || []).filter(function (r) { return r[1] > 0; });
  var adLast = ads.length ? ads[ads.length - 1] : null;
  var wk7 = ads.slice(-7);
  var wkSpend = wk7.reduce(function (a, r) { return a + r[1]; }, 0);
  var wkRev   = wk7.reduce(function (a, r) { return a + r[7]; }, 0);
  var wkBuy   = wk7.reduce(function (a, r) { return a + r[6]; }, 0);
  var wkRoas  = wkSpend ? (wkRev / wkSpend * 100) : 0;

  // 발주 위험 (하단 경고용)
  var risk = reorderRisk_(S);

  var usd = function (n) { return '$' + Math.round(n || 0).toLocaleString(); };

  var blocks = [
    { type: 'header', text: { type: 'plain_text', text: '📊 시오레 일별 매출 (' + md_(ownDate > amzDate ? ownDate : amzDate) + ')', emoji: true } },

    /* 유통별 일간 판매 */
    { type: 'section', text: { type: 'mrkdwn', text:
        '*🗓 유통별 일간 판매* _(각 채널 최신일)_\n' +
        '`1.` 아마존 US (' + md_(amzDate) + ') — 수량 *' + qty_(aD[0]) + '* / 매출 *' + won10k_(aD[1]) + '*\n' +
        '`2.` B2B ' + (b2bDate ? '(' + md_(b2bDate) + ')' : '') + ' — 수량 *' + qty_(bD[0]) + '* / 매출 *' + won10k_(bD[1]) + '*\n' +
        '`3.` 자사몰 (' + md_(ownDate) + ') — 수량 *' + qty_(oD[0]) + '* / 매출 *' + won10k_(oD[1]) + '*\n' +
        '─────────────\n' +
        '총 수량 : *' + qty_(dQty) + '*\n총 매출 : *' + won10k_(dRev) + '*'
    }},

    /* 유통별 월간 판매 */
    { type: 'section', text: { type: 'mrkdwn', text:
        '*📆 유통별 월간 판매* _(' + curM + ')_\n' +
        '`1.` 아마존 US — 수량 *' + qty_(aM[0]) + '* / 매출 *' + won10k_(aM[1]) + '*\n' +
        '`2.` B2B — 수량 *' + qty_(bM[0]) + '* / 매출 *' + won10k_(bM[1]) + '*\n' +
        '`3.` 자사몰 — 수량 *' + qty_(oM[0]) + '* / 매출 *' + won10k_(oM[1]) + '*\n' +
        '─────────────\n' +
        '총 수량 : *' + qty_(mQty) + '*\n총 매출 : *' + won10k_(mRev) + '*'
    }},

    /* 마케팅 요약 (일별/주별) */
    { type: 'section', text: { type: 'mrkdwn', text:
        '*📣 마케팅 요약* _(메타 광고)_\n' +
        '· 일별 (' + (adLast ? md_(adLast[0]) : '—') + ') : 광고비 *' + (adLast ? usd(adLast[1]) : '$0') +
          '* / 구매 ' + (adLast ? adLast[6] : 0) + '건 / ROAS *' + (adLast ? Math.round(adLast[8]) : 0) + '%*\n' +
        '· 주별 (7일) : 광고비 *' + usd(wkSpend) + '* / 구매 ' + wkBuy + '건 / ROAS *' + Math.round(wkRoas) + '%*'
    }}
  ];

  /* 발주 위험 있을 때만 경고 */
  if (risk.length) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn',
      text: '*🚨 즉시 발주 필요*\n' + risk.map(function (r) {
        return '• *' + r.n + '* — 재고 ' + r.st.toLocaleString() + '개 · 소진 *' + r.runway + '일*' +
               (r.eta ? ' · 입고예정 ' + r.eta + ' (*공백 ' + r.gap + '일*)' : ' · _발주 미등록_');
      }).join('\n') } });
  }

  blocks.push({ type: 'actions', elements: [{ type: 'button',
    text: { type: 'plain_text', text: '대시보드 열기', emoji: true },
    url: P_('DASH_URL') || 'https://github.com', style: 'primary' }] });
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn',
    text: Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm') + ' KST · 환율 $1=' +
          Math.round(FX).toLocaleString() + '원 · ' + (changed ? '배포됨' : '변경없음') }] });

  slackPost_({ text: '시오레 일별 매출 — 일간 ' + won10k_(dRev), blocks: blocks });
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
function sumB2b_(S, f, t) {   // 주문 + 샘플 모두 매출로
  return S.b2bRaw.filter(function (r) { return r[0] >= f && r[0] <= t; })
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
/* ==========================================================
   재고 빌드 — RAW 붙여넣기 탭에서 자동 산출
   ----------------------------------------------------------
   시트에 아래 두 탭을 만들고 원본을 통째로 붙여넣기만 하면 됩니다.
     · RAW_국내재고  : 아워박스 WMS 재고현황 (헤더 포함 그대로)
     · RAW_아마존재고 : 아마존 FBA 재고 리포트 CSV (헤더 포함 그대로)
   두 탭이 없으면 기존 '1.현재고현황' 집계 탭을 그대로 사용(하위호환).
   ========================================================== */

/* 국내 12품목 (WMS 품목코드 → 대시보드 표기) */
var DOM_ITEMS = [
  ['202650000032','NMN 하이드로 캡슐 클렌징 밀크','NMN'],
  ['202650000033','NMN 프레쉬 버블 토너','NMN'],
  ['202650000034','NMN 인텐시브 세럼','NMN'],
  ['202650000035','NMN 하이드레이팅 수딩 크림','NMN'],
  ['202650000036','NMN 딥 글로우 리치 크림','NMN'],
  ['201069000210','(약국) RRP 박스 + 프레쉬 버블 토너(8EA)','RRP'],
  ['201069000211','(약국) RRP 박스 + 인텐시브 세럼(10EA)','RRP'],
  ['201069000212','(약국) RRP 박스 + 카밍 수딩 젤(10EA)','RRP'],
  ['202650000037','데일리 릴리프 에센스 토너','릴리프'],
  ['202650000038','데일리 릴리프 리페어 앰플','릴리프'],
  ['202650000039','데일리 릴리프 카밍 수딩 젤','릴리프'],
  ['202650000040','데일리 릴리프 컴포트 크림','릴리프']
];

/* 아마존 9품목 (ASIN → 대시보드 표기) */
var ASIN_MAP = {
  'B0GDP2FL88': ['201069000193','[US] NMN 인텐시브 세럼','NMN'],
  'B0GDP4X3CQ': ['201069000195','[US] NMN 프레쉬 버블 토너','NMN'],
  'B0GDPMZD17': ['201069000196','[US] NMN 하이드레이팅 수딩 크림','NMN'],
  'B0GDP27VSC': ['201069000197','[US] 데일리 릴리프 에센스 토너','릴리프'],
  'B0GDNPHNVQ': ['201069000198','[US] 데일리 릴리프 리페어 앰플','릴리프'],
  'B0GDP5SVLM': ['201069000199','[US] 데일리 릴리프 컴포트 크림','릴리프'],
  'B0GDPMDFRR': ['201069000200','[US] 데일리 릴리프 카밍 수딩 젤','릴리프'],
  'B0GDNS62TV': ['201069000201','[US] NMN 하이드로 캡슐 클렌징 밀크','NMN'],
  'B0GDP8S4S5': ['201069000202','[US] NMN 딥 글로우 리치 크림','NMN']
};

/* 제품명 정리: "[시오레] NMN 세럼" → "NMN 세럼", 이중공백 제거 */
function cleanNm_(n) {
  return String(n).replace('[시오레US]', '').replace('[시오레]', '')
    .replace(/\s{2,}/g, ' ').trim();
}

/* 09.제품정보 탭 → 매핑 로드. 없으면 하드코딩 폴백. */
function loadProductMap_(inv) {
  var asinMap = {};   // ASIN → [표시명(US), cat]
  var domItems = [];  // 국내 판매 [code, 표시명, cat]
  var prod = tryTab_(inv, ['9.제품정보', '09.제품정보', '제품정보']);
  if (prod) {
    var hi = -1;
    for (var i = 0; i < prod.length; i++) { if (String(prod[i][0]).trim() === '품목코드') { hi = i; break; } }
    for (var r = hi + 1; r < prod.length; r++) {
      var code = String(prod[r][0] || '').replace(/[,\s]/g, '');
      if (!/^\d{9,12}$/.test(code)) continue;
      var asin = String(prod[r][1] || '').trim();
      var raw  = String(prod[r][2] || '');
      var cat  = String(prod[r][3] || '').trim();
      var nm   = cleanNm_(raw);
      var isUS = /\[시오레US\]|US\]/.test(raw);
      if (asin) asinMap[asin] = ['[US] ' + nm, cat];
      if ((cat === 'NMN' || cat === '릴리프' || cat === 'RRP') && !isUS) domItems.push([code, nm, cat]);
    }
  }
  // 폴백 (09.제품정보 못 읽을 때)
  if (!domItems.length) domItems = DOM_ITEMS;
  if (!Object.keys(asinMap).length) {
    Object.keys(ASIN_MAP).forEach(function (a) { var m = ASIN_MAP[a]; asinMap[a] = [m[1], m[2]]; });
  }
  return { asinMap: asinMap, domItems: domItems };
}

function buildStock_(inv, S, log) {
  var domRaw = tryTab_(inv, ['RAW_국내재고', 'RAW_국내재고현황', 'WMS_재고현황']);
  var azRaw  = tryTab_(inv, ['RAW_아마존재고', 'RAW_아마존', 'FBA재고']);

  // 둘 다 없으면 기존 방식
  if (!domRaw && !azRaw) {
    var st = readTab_(inv, '1.현재고현황');
    var a0 = String(st[0][0] || '');
    var mm1 = a0.match(/아워박스\s*(\d{4}-\d{2}-\d{2})/);
    var mm2 = a0.match(/아마존\s*(\d{4}-\d{2}-\d{2})/);
    S.stockAsOf = { ourbox: mm1 ? mm1[1] : '', amazon: mm2 ? mm2[1] : '' };
    S.stock = [];
    st.forEach(function (r) {
      var code = String(r[0] || '').replace(/,/g, '');
      if (!/^\d{9,12}$/.test(code)) return;
      S.stock.push([code, String(r[1]), String(r[2]), String(r[3]),
        num_(r[4]), num_(r[5]), num_(r[6]), r[7] === '-' || r[7] === '' ? null : num_(r[7]), num_(r[9])]);
    });
    log.push('재고: ' + S.stock.length + ' SKU (집계탭)');
    return;
  }

  S.stock = [];
  var asOf = { ourbox: '', amazon: '' };
  var PM = loadProductMap_(inv);          // 09.제품정보 매핑

  /* --- 국내: 품목코드별 가용수량 합산 (Lot 여러 행 → SUM) --- */
  if (domRaw) {
    var H = domRaw[0].map(String);
    var ci = colIdx_(H, ['품목코드','상품코드','코드']);
    var cq = colIdx_(H, ['가용수량','가용재고','가용','재고수량']);
    var sums = {};
    for (var i = 1; i < domRaw.length; i++) {
      var code = String(domRaw[i][ci] || '').replace(/[,\s]/g, '');
      if (!/^\d{9,12}$/.test(code)) continue;
      sums[code] = (sums[code] || 0) + num_(domRaw[i][cq]);
    }
    PM.domItems.forEach(function (it) {
      S.stock.push([it[0], it[1], '국내', it[2], sums[it[0]] || 0, 0, 0, null, 0]);
    });
    asOf.ourbox = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
    log.push('국내재고(RAW): ' + PM.domItems.length + '종');
  }

  /* --- 아마존: ASIN 매칭 → available / reserved / t30 --- */
  if (azRaw) {
    var AH = azRaw[0].map(String);
    var ai = colIdx_(AH, ['asin']);
    var av = colIdx_(AH, ['available']);
    var rv = colIdx_(AH, ['Total Reserved Quantity','reserved-quantity','reserved']);
    var t30 = colIdx_(AH, ['units-shipped-t30','units-shipped-last-30-days','sales-shipped-last-30-days']);
    var byAsin = {};
    for (var j = 1; j < azRaw.length; j++) {
      var asin = String(azRaw[j][ai] || '').trim();
      if (!asin) continue;
      byAsin[asin] = byAsin[asin] || { av: 0, rv: 0, t: 0 };
      byAsin[asin].av += num_(azRaw[j][av]);
      byAsin[asin].rv += num_(azRaw[j][rv]);
      byAsin[asin].t  += num_(azRaw[j][t30]);
    }
    // 09.제품정보에 등록된 ASIN 순서대로 (신제품은 09.제품정보에 추가만 하면 됨)
    Object.keys(PM.asinMap).forEach(function (asin) {
      var m = PM.asinMap[asin], d = byAsin[asin];
      if (!d) return;                     // 이 ASIN이 아마존 재고에 없으면 skip
      var code = 'AZ-' + asin;            // US 표시용 코드
      S.stock.push([code, m[0], 'US', m[1], 0, d.av, d.rv, d.t, 0]);
    });
    asOf.amazon = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
    log.push('아마존재고(RAW): ' + S.stock.filter(function(x){return x[2]==='US';}).length + '종');
  } else {
    // 아마존 RAW 없으면 기존 집계탭에서 US만 가져와 붙임
    try {
      var st2 = readTab_(inv, '1.현재고현황');
      st2.forEach(function (r) {
        var code = String(r[0] || '').replace(/,/g, '');
        if (!/^\d{9,12}$/.test(code) || String(r[2]) !== 'US') return;
        S.stock.push([code, String(r[1]), 'US', String(r[3]), 0, num_(r[5]), num_(r[6]),
          r[7] === '-' || r[7] === '' ? null : num_(r[7]), 0]);
      });
    } catch (e) {}
  }

  S.stockAsOf = asOf;
  log.push('재고 합계: ' + S.stock.length + ' SKU');
}

/* 있으면 읽고 없으면 null (에러 안 냄) */
function tryTab_(ss, names) {
  var all = ss.getSheets();
  for (var n = 0; n < names.length; n++) {
    for (var i = 0; i < all.length; i++) {
      var nm = all[i].getName().toLowerCase().replace(/\s/g, '');
      if (nm === String(names[n]).toLowerCase().replace(/\s/g, '')) {
        var vals = all[i].getDataRange().getDisplayValues();
        return vals.length > 1 ? vals : null;   // 헤더만 있으면 빈 것으로 취급
      }
    }
  }
  return null;
}

/* 헤더 배열에서 후보명으로 컬럼 인덱스 찾기 (부분일치·대소문자무시) */
function colIdx_(header, cands) {
  for (var c = 0; c < cands.length; c++) {
    var key = String(cands[c]).toLowerCase().replace(/\s/g, '');
    for (var i = 0; i < header.length; i++) {
      if (String(header[i]).toLowerCase().replace(/\s/g, '') === key) return i;
    }
  }
  // 부분일치 2차
  for (var c2 = 0; c2 < cands.length; c2++) {
    var k2 = String(cands[c2]).toLowerCase().replace(/\s/g, '');
    for (var j = 0; j < header.length; j++) {
      if (String(header[j]).toLowerCase().replace(/\s/g, '').indexOf(k2) >= 0) return j;
    }
  }
  return -1;
}

/**
 * 탭 읽기 — 이름이 바뀌어도 최대한 살려낸다.
 * @param names  문자열 또는 후보 배열 (앞에서부터 시도)
 * 1) 정확히 일치  2) 부분 일치(대소문자 무시)  3) 실패 시 실제 탭 목록을 에러에 표시
 */
function readTab_(ss, names) {
  var cand = (typeof names === 'string') ? [names] : names;
  var all  = ss.getSheets().map(function (s) { return s.getName(); });

  // 1) 정확히 일치
  for (var i = 0; i < cand.length; i++) {
    var sh = ss.getSheetByName(cand[i]);
    if (sh) return sh.getDataRange().getDisplayValues();
  }
  // 2) 부분 일치
  for (var j = 0; j < cand.length; j++) {
    var key = String(cand[j]).toLowerCase().replace(/\s/g, '');
    for (var k = 0; k < all.length; k++) {
      var nm = all[k].toLowerCase().replace(/\s/g, '');
      if (nm.indexOf(key) >= 0 || key.indexOf(nm) >= 0) {
        Logger.log('탭 이름 유사매칭: "' + cand[j] + '" → "' + all[k] + '"');
        return ss.getSheetByName(all[k]).getDataRange().getDisplayValues();
      }
    }
  }
  throw new Error('탭을 찾을 수 없음: [' + cand.join(' / ') + ']\n' +
                  '파일: ' + ss.getName() + '\n실제 탭 목록: ' + all.join(' · '));
}

/** gid로 탭 읽기 (이름이 바뀌어도 gid는 안 바뀜 — 최후의 보루) */
function readTabByGid_(ss, gid) {
  var shs = ss.getSheets();
  for (var i = 0; i < shs.length; i++) {
    if (shs[i].getSheetId() === gid) return shs[i].getDataRange().getDisplayValues();
  }
  throw new Error('gid ' + gid + ' 탭 없음 (' + ss.getName() + ')');
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
   5분마다 tick → 창(09:50~09:58 / 15:00~15:10)에서만 빌드
   ========================================================== */
function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var f = t.getHandlerFunction();
    if (f === 'tick' || f === 'main') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('tick').timeBased().everyMinutes(5).create();

  Logger.log('트리거 등록 완료 — 5분마다 tick / 실행 창: ' +
    WINDOWS.map(function (w) { return w.label + ' ' + w.from + '~' + w.to; }).join(' · '));

  slackPost_({ text: '✅ *시오레 대시보드 자동 갱신 설정 완료*\n' +
    '• 오전 *09:50~09:58* (10:00 데일리 스크럼 전 완료)\n' +
    '• 오후 *15:00~15:10*\n' +
    '• 평일만 · 지연 시 자동 경고' });
}

/* 트리거 상태 확인용 — 로그 + Slack으로 동시에 보고 */
function checkStatus() {
  var trig = ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'tick'; });
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  var need = ['GH_OWNER','GH_REPO','GH_TOKEN','GH_PATH','SLACK_WEBHOOK'];
  var missing = need.filter(function (k) { return !all[k]; });
  var flags = Object.keys(all).filter(function (k) { return k.indexOf('DONE_') === 0; })
    .map(function (k) { return k + ' = ' + all[k]; });

  var lines = [];
  lines.push('현재 시각(KST): ' + Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm'));
  lines.push('tick 트리거: ' + trig.length + '개 ' + (trig.length ? '✅' : '❌ setup() 실행 필요!'));
  lines.push('필수 속성 누락: ' + (missing.length ? '❌ ' + missing.join(', ') : '없음 ✅'));
  lines.push('최근 실행 이력: ' + (flags.length ? flags.join(' / ') : '(없음 — 아직 자동 실행 안 됨)'));

  var report = lines.join('\n');
  Logger.log(report);

  // 진단 결과를 Slack으로도 (webhook이 살아있는지 겸사겸사 확인)
  var diag = trig.length === 0
    ? '🔴 *자동 갱신이 꺼져 있습니다.* `setup()` 함수를 실행하세요.'
    : (missing.length ? '🟠 *스크립트 속성이 비어 있습니다:* ' + missing.join(', ')
                      : '🟢 자동 갱신 정상 (tick ' + trig.length + '개).');
  try { slackPost_({ text: '🩺 *대시보드 자동화 상태 점검*\n```' + report + '```\n' + diag }); } catch (e) {}
}
