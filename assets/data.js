/* ==========================================================
   SIORÉ 대시보드 · 로직 레이어 (데이터는 snapshot.js)
   - SOURCES : 구글시트 실시간 연동 설정 (gviz)
   - SNAP    : 스냅샷 폴백 (2026-07-13 기준)
   - SIORE.load() : 시트 → 실패 시 스냅샷
   ========================================================== */

const SOURCES = {
  amazon:    { id:'1Xgtx9hqd7g6k_YAbCfFnK0sxhzE76swfb4YPGm_FwEs', gid:'420097499',  name:'아마존 일자별 제품별 데이터' },
  b2b:       { id:'1-vt3_mttqS5o-00ARchz3Pg7ECWhdVvPL2jDrvJGuH8', gid:'1454732134', name:'시오레 B2B 매출' },
  ownmall:   { id:'1SkUdqnJ-FEZnN66mCoMPZkEzANuFmKNp084YSTGR2Fk', gid:'298108694',  name:'시오레 자사몰 월별매출' },
  ads:       { id:'1tjqdYvMHwtACkmG00PMoxTt3FLoBD3wBLXolrrBNUlk', gid:'1082528091', name:'광고데이터 대시보드' },
  inventory: { id:'1LCuWeWi8kBJLhl9xyPQW6VQaxDB5TQ2NgQvjsSRE9Yk', gid:'325819769',  name:'시오레 재고·유통·발주관리' },
};

const CONFIG = {
  fxUSDKRW: 1497,          // 당일 환율 (SIORE.loadFX()가 실시간으로 덮어씀)
  fxSource: '기본값',
  fxAsOf: '—',
  asOf: '2026-07-14',
  get refreshedAt(){ return (typeof GENERATED_AT !== 'undefined') ? GENERATED_AT : '—'; },
  // 아마존은 통상 한국 기준 -2일 (리포팅 지연)
  dataThrough: { amazon:'2026-07-12', ownmall:'2026-07-13', b2b:'2026-07-07', ads:'2026-07-11', inv:'2026-07-14' },
  reorder: { urgentDays:30, watchDays:60 },
};

/* 환율 API — 당일 USD/KRW (무료·키 불필요·CORS 허용) */
const FX_API = 'https://open.er-api.com/v6/latest/USD';

/* ==========================================================
   아마존 연간 목표/예산 (시트: 시오레_매출목표_raw)
   - 1.아마존_연간목표 · 2.마케팅예산세부 에서 스냅샷
   - 목표는 고정 연간계획 → snapshot.js(자동갱신)가 아닌 여기 보관
   - 실적(도달)은 amazonDaily 실측에서 실시간 계산
   - 월 인덱스 0=1월 … 11=12월
   ========================================================== */
const AMZ_PLAN = {
  asOf: '2026-07 갱신',
  fxPlan: 1492,
  // 월 매출 목표 (원)
  revTargetKRW: [0, 0, 8000000, 21000000, 51000000, 113303250, 108771120, 138985320, 154092420, 279481350, 374656080, 259842120],
  // 월 도달(실적) 매출 — 시트 공식 집계 [1.아마존_연간목표]
  achievedKRW:  [0, 0, 7843817, 20666886, 48425844, 79102632, 18039921, 0, 0, 0, 0, 0],
  achievedUSD:  [0, 0, 5257.25, 13851.80, 32457.00, 53017.85, 12091.10, 0, 0, 0, 0, 0],
  // 월 마케팅(광고) 예산 (원)  ※ 유가협업·시딩·아마존리뷰·콘텐츠·약사님·외부광고·Amazon SP 포함
  adBudgetKRW:  [0, 0, 0, 3750000, 70750000, 88000000, 86000000, 90000000, 170000000, 195000000, 195000000, 195000000],
  totalRevKRW: 1509131660,
  totalAdKRW:  1093500000,
  totalAchievedKRW: 174079100,
  // 마케팅 예산 카테고리 [항목, 연간예산(원), 비중]
  mktCategories: [
    ['유가협업',    438500000, 40.10],
    ['시딩',        292000000, 26.70],
    ['Amazon SP',   133000000, 12.16],
    ['외부광고',     97000000,  8.87],
    ['약사님',       63000000,  5.76],
    ['아마존 리뷰',   60000000,  5.49],
    ['콘텐츠 제작비', 10000000,  0.91],
  ],
};

/* ==========================================================
   국내 재고 예측 (시트 [5.국내제품별_재고예측] · [B] 성장기준)
   - 성장(6월) 월수요 + FBA/물류 발송 + B2B/시딩 이벤트 반영
   - short = 재고 부족 예상월(없으면 null) · order = H2 발주필요 수량
   - 아워박스 가용재고(현재고)는 snapshot.js가 실시간 반영 → 예측은 7/14 기준
   ========================================================== */
const DOM_FORECAST = {
  asOf: '2026-07-14',
  basis: '시트 [5.국내제품별_재고예측] · 성장(6월)월수요 + 발송/시딩 이벤트',
  items: {
    'NMN 하이드로 캡슐 클렌징 밀크': { demand:29,  draw:29,  runwayM:32.0, short:null,  order:174   },
    'NMN 프레쉬 버블 토너':          { demand:256, draw:339, runwayM:16.5, short:null,  order:4058  },
    'NMN 인텐시브 세럼':             { demand:384, draw:511, runwayM:2.9,  short:'9월',  order:22826 },
    'NMN 하이드레이팅 수딩 크림':     { demand:32,  draw:32,  runwayM:10.0, short:null,  order:192   },
    'NMN 딥 글로우 리치 크림':       { demand:263, draw:263, runwayM:28.2, short:'10월', order:11098 },
    '데일리 릴리프 에센스 토너':      { demand:31,  draw:31,  runwayM:69.4, short:null,  order:186   },
    '데일리 릴리프 리페어 앰플':      { demand:34,  draw:34,  runwayM:47.4, short:null,  order:204   },
    '데일리 릴리프 카밍 수딩 젤':     { demand:259, draw:259, runwayM:19.2, short:null,  order:2354  },
    '데일리 릴리프 컴포트 크림':      { demand:73,  draw:73,  runwayM:26.3, short:null,  order:438   },
  },
};

/* ==========================================================
   인플루언서 운영 결과 + 하반기 시딩 계획
   - 광고데이터 시트 [인플루언서 현황] 탭 스냅샷
   - 시딩 계획: 매출목표 시트 [4.마케팅시딩계획] 탭
   - 고정/수기 데이터 → snapshot.js(자동갱신) 아닌 여기 보관
   행: [월, 인플루언서, 인종, 콘텐츠유형, 팔로워, 비용USD, 제품, 뷰, 좋아요, ER%]
   ER/뷰가 null = 콘텐츠 결과 집계 전 (진행중)
   ========================================================== */
const INFLUENCER = {
  asOf: '2026-07 기준',
  note: '7월 5건은 콘텐츠 결과 집계 전(진행중)',
  rows: [
    ['11월','mirela.nova','백인','논토킹',38400,1288.95,'버블토너',null,871,0.6],
    ['12월','what_is_lada','백인','논토킹',146500,1288.95,'버블토너',null,null,0.2],
    ['12월','what_is_lada','백인','논토킹',146500,1288.95,'버블토너',null,null,2.2],
    ['12월','mirela.nova','백인','토킹',38400,1288.95,'버블토너',null,669,1.2],
    ['12월','itsalyssadaily','동양인','논토킹',105100,1288.95,'버블토너',null,null,16.9],
    ['2월','itsalyssadaily','동양인','논토킹',105100,1288.95,'버블토너',null,null,13.0],
    ['5월','mayaya.kimmm','동양인','토킹',1377700,5000,'인텐시브 세럼',13400,428,3.8],
    ['5월','natalia bbos','백인','토킹',null,4430,null,0,0,0.0],
    ['5월','what_is_lada','백인','논토킹',146500,2500,'버블토너',16500,621,4.2],
    ['5월','heylina2484','동양인','논토킹',177300,3000,'버블토너',6800,247,4.0],
    ['5월','mayaya.kimmm','동양인','토킹',1377700,0,'인텐시브 세럼',23000,495,2.6],
    ['6월','natalia','백인','토킹',217200,0,'인텐시브 세럼',13700,442,6.0],
    ['6월','mora','동양인','토킹',20600,2500,'인텐시브 세럼',2290,119,7.6],
    ['6월','oreoleo','동양인','N선',9331,400,'인텐시브 세럼',18800,445,3.9],
    ['6월','miki','흑인','토킹',14400,600,'인텐시브 세럼',10300,422,8.3],
    ['6월','sunny','동양인','토킹',429100,7000,'인텐시브 세럼',15500,648,5.7],
    ['6월','ellija','백인','N선',84000,3000,'인텐시브 세럼',3941,165,5.6],
    ['7월','oreoleo','동양인','N선',25100,400,'인텐시브 세럼',null,null,null],
    ['7월','Hudson Son','동양인','토킹',287700,4000,'인텐시브 세럼',null,null,null],
    ['7월','itsalyssadaily','동양인','토킹',105100,5500,'인텐시브 세럼',null,null,null],
    ['7월','trixjoyalcanar','동양인','토킹',238500,3000,'인텐시브 세럼',null,null,null],
    ['7월','Brenda Chan','동양인','토킹',208800,5000,'인텐시브 세럼',null,null,null],
  ],
  // 하반기(7~12월) 시딩 계획 — [업체, 유형, 예산(원), 수량]
  seeding: {
    asOf: '2026 하반기(7~12월) 계획',
    budgetKRW: 307000000,
    qty: 6072,
    vendors: [
      ['코이',    '무가 시딩', 172000000, 4800],
      ['지퓨처스', '체험단',    75000000,  500],
      ['지퓨처스', '리뷰',      60000000,  500],
      ['내부',    '유가',       0,         272],
    ],
  },
};

/* 인플루언서 집계 (월순: 1~12월, 실제 데이터 순서 기준) */
function influencerStats(){
  const R = INFLUENCER.rows;
  const done = R.filter(r=>r[9]!=null);               // 결과 집계 완료
  const pending = R.filter(r=>r[9]==null);            // 진행중(7월)
  const sum = (a,f)=>a.reduce((s,r)=>s+(f(r)||0),0);
  const totCost = sum(R, r=>r[5]);
  const doneCost = sum(done, r=>r[5]);
  const totViews = sum(R, r=>r[7]);
  const totLikes = sum(R, r=>r[8]);
  const avgER = done.length ? sum(done,r=>r[9])/done.length : 0;
  // 월별
  const monthsOrder = ['11월','12월','2월','5월','6월','7월'];
  const byMonth = monthsOrder.map(mo=>{
    const rr = R.filter(r=>r[0]===mo);
    const dd = rr.filter(r=>r[9]!=null);
    return { mo, cnt:rr.length, cost:sum(rr,r=>r[5]), views:sum(rr,r=>r[7]),
             er: dd.length? sum(dd,r=>r[9])/dd.length : null, pending: rr.some(r=>r[9]==null) };
  }).filter(x=>x.cnt>0);
  // 인플루언서별 (비용순)
  const byInfMap = {};
  R.forEach(r=>{ const k=r[1]; (byInfMap[k]=byInfMap[k]||{n:k,cnt:0,cost:0,views:0,erSum:0,erN:0,fol:r[4]});
    const o=byInfMap[k]; o.cnt++; o.cost+=r[5]; o.views+=(r[7]||0); if(r[9]!=null){o.erSum+=r[9];o.erN++;} });
  const byInf = Object.values(byInfMap).map(o=>({...o, er:o.erN?o.erSum/o.erN:null})).sort((a,b)=>b.cost-a.cost);
  // 제품별
  const byProdMap = {};
  R.forEach(r=>{ const k=r[6]||'미지정'; (byProdMap[k]=byProdMap[k]||{n:k,cnt:0,cost:0,views:0});
    byProdMap[k].cnt++; byProdMap[k].cost+=r[5]; byProdMap[k].views+=(r[7]||0); });
  const byProd = Object.values(byProdMap).sort((a,b)=>b.cost-a.cost);
  // 콘텐츠 유형별
  const byTypeMap = {};
  R.forEach(r=>{ const k=r[3]||'미지정'; (byTypeMap[k]=byTypeMap[k]||{n:k,cnt:0,cost:0,erSum:0,erN:0});
    const o=byTypeMap[k]; o.cnt++; o.cost+=r[5]; if(r[9]!=null){o.erSum+=r[9];o.erN++;} });
  const byType = Object.values(byTypeMap).map(o=>({...o,er:o.erN?o.erSum/o.erN:null})).sort((a,b)=>b.cost-a.cost);
  return { total:R.length, doneN:done.length, pendingN:pending.length,
           totCost, doneCost, pendingCost:totCost-doneCost, totViews, totLikes, avgER,
           byMonth, byInf, byProd, byType };
}

/* ==========================================================
   파생 — 아마존 일자별×제품별(실측) 에서 모든 집계를 산출
   더 이상 추정 없음. 시트의 [매출액]/[주문수량]/[PV] 탭이 단일 진실.
   ========================================================== */
(function deriveAmazon(){
  const P = SNAP.amazonDailyProduct;
  const N = SNAP.amazonProductNames;

  // [날짜, PV, 판매량, 매출USD]
  SNAP.amazonDaily = P.map(([d,pv,rev,qty])=>[
    d, pv,
    qty.reduce((a,b)=>a+b,0),
    +rev.reduce((a,b)=>a+b,0).toFixed(2),
  ]);

  // 당일 제품별 [name, rev, qty]  (index → 이름)
  SNAP.amazonDayProducts = date => {
    const row = P.find(r=>r[0]===date);
    if(!row) return [];
    return N.map((n,i)=>({ n, rev: row[2][i], qty: row[3][i] }))
            .filter(x=>x.rev>0 || x.qty>0)
            .sort((a,b)=>b.rev-a.rev);
  };

  // 기간 제품별 집계 (from~to 포함), 미지정 시 전체
  SNAP.amazonProductsRange = (from, to) => {
    const rows = P.filter(r => (!from || r[0]>=from) && (!to || r[0]<=to));
    return N.map((n,i)=>({
      n,
      rev: +rows.reduce((a,r)=>a+r[2][i],0).toFixed(2),
      qty: rows.reduce((a,r)=>a+r[3][i],0),
    })).filter(x=>x.rev>0 || x.qty>0).sort((a,b)=>b.rev-a.rev);
  };

  // 제품별 누적 [상품명, PV, 주문수량, 매출USD]  — PV는 제품별 PV 매트릭스가 필요하나
  // 현재 PV는 일자합계만 보관 → 제품별 PV는 시트 [PV] 탭 누적값 사용
  const PV_BY_PRODUCT = {
    "NMN 인텐시브 세럼":79246, "NMN 버블토너":26229, "NMN 딥 글로우 리치 크림":5594,
    "NMN 클렌징밀크":673, "NMN 하이드레이팅 수딩 크림":920, "밸런스라인 수딩젤":1360,
    "밸런스 라인 크림":106, "밸런스 라인 토너":25, "밸런스 라인 앰플":5,
  };
  SNAP.amazonProduct = SNAP.amazonProductsRange().map(x=>[x.n, PV_BY_PRODUCT[x.n]||0, x.qty, x.rev]);

  SNAP.amazonTotals = {
    pv:  SNAP.amazonDaily.reduce((a,r)=>a+r[1],0),
    qty: SNAP.amazonDaily.reduce((a,r)=>a+r[2],0),
    usd: +SNAP.amazonDaily.reduce((a,r)=>a+r[3],0).toFixed(2),
  };
})();

/* ==========================================================
   파생 — 자사몰 일자별(실측)
   [날짜, 주문건수, 수량, 정가매출, 순매출, 임직원매출, [[idx,qty,gross],...]]
   ========================================================== */
(function deriveOwn(){
  const D = SNAP.ownDaily, N = SNAP.ownProductNames;
  const byDate = {}; D.forEach(r => byDate[r[0]] = r);
  SNAP.ownDates = D.map(r=>r[0]);
  SNAP.ownLastDay = D[D.length-1][0];

  // 특정일 (없으면 매출 0)
  SNAP.ownDay = date => {
    const r = byDate[date];
    return r ? { date, orders:r[1], qty:r[2], gross:r[3], net:r[4], staff:r[5] }
             : { date, orders:0, qty:0, gross:0, net:0, staff:0 };
  };

  // 특정일 제품별 (일반주문)
  SNAP.ownDayProducts = date => {
    const r = byDate[date];
    if(!r) return [];
    return r[6].map(([i,q,g])=>({ n:N[i], qty:q, rev:g }))
               .filter(x=>x.rev>0 || x.qty>0)
               .sort((a,b)=>b.rev-a.rev);
  };

  // 기간 제품별 집계
  SNAP.ownProductsRange = (from, to) => {
    const acc = {};
    D.filter(r => (!from || r[0]>=from) && (!to || r[0]<=to))
     .forEach(r => r[6].forEach(([i,q,g])=>{
       if(!acc[i]) acc[i] = { n:N[i], qty:0, rev:0 };
       acc[i].qty += q; acc[i].rev += g;
     }));
    return Object.values(acc).filter(x=>x.rev>0).sort((a,b)=>b.rev-a.rev);
  };

  // 기간 합계
  SNAP.ownRange = (from, to) => {
    const rows = D.filter(r => (!from || r[0]>=from) && (!to || r[0]<=to));
    return {
      orders: rows.reduce((a,r)=>a+r[1],0),
      qty:    rows.reduce((a,r)=>a+r[2],0),
      gross:  rows.reduce((a,r)=>a+r[3],0),
      net:    rows.reduce((a,r)=>a+r[4],0),
      staff:  rows.reduce((a,r)=>a+r[5],0),
      days:   rows.length,
    };
  };
})();

/* ==========================================================
   파생 — B2B (주문라인 원본 → 일자/월/거래처/제품)
   ========================================================== */
(function deriveB2B(){
  const R = SNAP.b2bRaw, A = SNAP.b2bAccountNames;
  // 샘플구분도 매출로 집계 (주문 O + 샘플 S 모두 포함)
  const ord = R;

  SNAP.b2bLastDay = R.map(r=>r[0]).sort().pop();

  SNAP.b2bRange = (from, to) => {
    const o = ord.filter(r => (!from || r[0]>=from) && (!to || r[0]<=to));
    return {
      rev:    o.reduce((a,r)=>a+r[5],0),
      qty:    o.reduce((a,r)=>a+r[4],0),
      lines:  o.length,
      accounts: new Set(o.map(r=>r[1])).size,
    };
  };

  SNAP.b2bProductsRange = (from, to) => {
    const acc = {};
    ord.filter(r => (!from || r[0]>=from) && (!to || r[0]<=to))
       .forEach(r=>{ acc[r[3]] = acc[r[3]] || { n:r[3], qty:0, rev:0 };
                     acc[r[3]].qty += r[4]; acc[r[3]].rev += r[5]; });
    return Object.values(acc).sort((a,b)=>b.rev-a.rev);
  };

  SNAP.b2bAccountsRange = (from, to) => {
    const acc = {};
    ord.filter(r => (!from || r[0]>=from) && (!to || r[0]<=to))
       .forEach(r=>{ acc[r[1]] = acc[r[1]] || { n:A[r[1]], rev:0, qty:0 };
                     acc[r[1]].rev += r[5]; acc[r[1]].qty += r[4]; });
    return Object.values(acc).sort((a,b)=>b.rev-a.rev);
  };

  // 일자별 [날짜, 건수, 수량, 매출] — 주간/일별 그래프용
  SNAP.b2bDates = [...new Set(ord.map(r=>r[0]))].sort();
  SNAP.b2bDaily = SNAP.b2bDates.map(d=>{
    const rows = ord.filter(r=>r[0]===d);
    return [d, rows.length, rows.reduce((a,r)=>a+r[4],0), rows.reduce((a,r)=>a+r[5],0)];
  });
  SNAP.b2bDay = date => {
    const rows = ord.filter(r=>r[0]===date);
    return { date, lines:rows.length, qty:rows.reduce((a,r)=>a+r[4],0), rev:rows.reduce((a,r)=>a+r[5],0) };
  };

  // 월별 (기존 호환)
  SNAP.b2bMonths = ["2026-06","2026-07","2026-08","2026-09","2026-10","2026-11","2026-12"];
  SNAP.b2bAccounts = A.map((n,i)=>[n, SNAP.b2bMonths.map(m=>
    ord.filter(r=>r[1]===i && r[0].startsWith(m)).reduce((a,r)=>a+r[5],0))]);
})();

/* ==========================================================
   주간(최근 7일) 헬퍼 — 기준일 포함 7일
   ========================================================== */
const WEEK = {
  from(base){ const d = new Date(base+'T00:00:00Z'); d.setUTCDate(d.getUTCDate()-6); return d.toISOString().slice(0,10); },
  prevFrom(base){ const d = new Date(base+'T00:00:00Z'); d.setUTCDate(d.getUTCDate()-13); return d.toISOString().slice(0,10); },
  prevTo(base){ const d = new Date(base+'T00:00:00Z'); d.setUTCDate(d.getUTCDate()-7); return d.toISOString().slice(0,10); },
};

/* ==========================================================
   유틸
   ========================================================== */
const U = {
  krw:  n => '₩' + Math.round(n||0).toLocaleString('ko-KR'),
  krwM: n => (n||0) >= 100000000
              ? (n/100000000).toFixed(2)+'억'
              : ((n||0) >= 10000 ? Math.round(n/10000).toLocaleString('ko-KR')+'만' : Math.round(n||0).toLocaleString()),
  usd:  n => '$' + (n||0).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0}),
  usd2: n => '$' + (n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}),
  num:  n => (n==null ? '—' : Math.round(n).toLocaleString('ko-KR')),
  pct:  (n,d=1) => (n==null ? '—' : (n>0?'':'') + n.toFixed(d) + '%'),
  toKRW: usd => usd * CONFIG.fxUSDKRW,

  /* 아마존 전용 — $ 크게, 원화 작게 (2줄) */
  usdWithKrw(usd, big='23px'){
    return `<span style="font-size:${big};font-weight:750;letter-spacing:-.8px;display:block">${U.usd2(usd)}</span>
            <span style="font-size:12px;color:var(--tx-3);font-weight:600">≈ ${U.krw(U.toKRW(usd))}</span>`;
  },
  usdWithKrwInline: usd => `${U.usd2(usd)} <span style="color:var(--tx-3)">(${U.krwM(U.toKRW(usd))}원)</span>`,

  delta(cur, prev){
    if(prev == null || prev === 0) return {v:null, cls:'flat', tx:'—'};
    const v = (cur - prev) / prev * 100;
    return { v, cls: v>0?'up':(v<0?'dn':'flat'), tx: (v>0?'▲ ':(v<0?'▼ ':'')) + Math.abs(v).toFixed(1) + '%' };
  },
  ym: d => d.slice(0,7),
  // ISO 주차 키 (YYYY-Www)
  isoWeek(dstr){
    const d = new Date(dstr + 'T00:00:00Z');
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const y0 = new Date(Date.UTC(t.getUTCFullYear(),0,1));
    const wk = Math.ceil(((t - y0)/86400000 + 1)/7);
    return `${t.getUTCFullYear()}-W${String(wk).padStart(2,'0')}`;
  },
  weekRange(dstr){
    const d = new Date(dstr + 'T00:00:00Z');
    const day = d.getUTCDay() || 7;
    const mon = new Date(d); mon.setUTCDate(d.getUTCDate() - day + 1);
    const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6);
    const f = x => `${x.getUTCMonth()+1}/${x.getUTCDate()}`;
    return `${f(mon)}–${f(sun)}`;
  },
  sum: (arr, f = x=>x) => arr.reduce((a,b)=>a + (f(b)||0), 0),
  groupSum(rows, keyFn, valFns){
    const m = new Map();
    rows.forEach(r=>{
      const k = keyFn(r);
      if(!m.has(k)) m.set(k, valFns.map(()=>0));
      const cur = m.get(k);
      valFns.forEach((f,i)=> cur[i] += (f(r)||0));
    });
    return [...m.entries()].map(([k,v])=>[k,...v]);
  },
};

/* ==========================================================
   구글시트 실시간 로더 (gviz)
   시트가 '웹에 게시' 또는 '링크가 있는 모든 사용자(뷰어)'여야 동작.
   실패 시 SNAP 스냅샷으로 자동 폴백.
   ========================================================== */
const SIORE = {
  mode: 'snapshot',   // 'live' | 'snapshot'
  errors: [],

  gvizURL(src){
    return `https://docs.google.com/spreadsheets/d/${src.id}/gviz/tq?tqx=out:json&gid=${src.gid}`;
  },

  async fetchSheet(key){
    const src = SOURCES[key];
    const res = await fetch(this.gvizURL(src), { cache:'no-store' });
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const txt = await res.text();
    const m = txt.match(/setResponse\(([\s\S]*)\);?\s*$/);
    if(!m) throw new Error('gviz 파싱 실패 (시트 공개 설정 필요)');
    const json = JSON.parse(m[1]);
    return json.table.rows.map(r => (r.c||[]).map(c => c ? (c.v ?? null) : null));
  },

  /** 모든 소스 시도 → 하나라도 실패하면 스냅샷 모드 */
  async load(){
    const keys = Object.keys(SOURCES);
    const results = await Promise.allSettled(keys.map(k => this.fetchSheet(k)));
    const ok = results.every(r => r.status === 'fulfilled');
    results.forEach((r,i)=>{ if(r.status==='rejected') this.errors.push(`${keys[i]}: ${r.reason.message}`); });
    this.mode = ok ? 'live' : 'snapshot';
    this.raw = {};
    results.forEach((r,i)=>{ if(r.status==='fulfilled') this.raw[keys[i]] = r.value; });
    return { mode:this.mode, errors:this.errors };
  },

  /** 당일 환율 로드 (실패 시 CONFIG 기본값 유지) */
  async loadFX(){
    try{
      const r = await fetch(FX_API, { cache:'no-store' });
      if(!r.ok) throw new Error('HTTP '+r.status);
      const j = await r.json();
      const krw = j?.rates?.KRW;
      if(!krw) throw new Error('KRW 없음');
      CONFIG.fxUSDKRW = Math.round(krw * 100) / 100;
      CONFIG.fxSource = '실시간';
      CONFIG.fxAsOf   = (j.time_last_update_utc || '').slice(5,16);
    }catch(e){
      CONFIG.fxSource = '기본값(오프라인)';
      CONFIG.fxAsOf   = '—';
      this.errors.push('FX: ' + e.message);
    }
    return CONFIG.fxUSDKRW;
  },

  /** 환율 뱃지 렌더 */
  renderFX(el){
    if(!el) return;
    const live = CONFIG.fxSource === '실시간';
    el.className = 'pill ' + (live ? '' : 'snap');
    el.innerHTML = `<span class="dot"></span>$1 = <b style="color:var(--mint-hi)">${CONFIG.fxUSDKRW.toLocaleString('ko-KR')}</b>원`;
    el.title = live ? `당일 환율 · ${CONFIG.fxAsOf} 기준 (exchangerate-api)` : '환율 API 연결 실패 → 기본값 사용 중';
  },

  /** 헤더 상태 뱃지 렌더 */
  renderStatus(el){
    const live = this.mode === 'live';
    el.className = 'pill ' + (live ? 'live' : 'snap');
    el.innerHTML = `<span class="dot"></span>${live ? '구글시트 실시간' : '스냅샷 · ' + CONFIG.asOf}`;
    el.title = live ? '구글시트에서 직접 로드됨'
      : '구글시트 접근 불가 → 내장 스냅샷 표시 중.\n각 시트를 [파일 > 공유 > 웹에 게시] 하면 실시간 연동됩니다.\n' + this.errors.join('\n');
  },
};

/* ---------- Chart.js 공통 옵션 (라이트 배경 대응) ---------- */
const CH = {
  mint:'#0FB89A', cyan:'#1FA8C9', purple:'#7C5FE0', gold:'#D9A21B',
  red:'#E5484D', blue:'#4E72D8', grey:'#7C8891',
  palette:['#0FB89A','#1FA8C9','#7C5FE0','#D9A21B','#4E72D8','#E5484D','#0A8F78','#167F99','#A87C10'],

  /* 라이트 캔버스용 축/그리드 토큰 */
  grid:'#E6EBED', axis:'#D8DEE1', tick:'#7C8891', label:'#4E5A61',

  grad(ctx, hex, a1=.28, a2=0){
    const c = ctx.canvas.getContext('2d');
    const g = c.createLinearGradient(0,0,0,ctx.canvas.height || 300);
    const r = parseInt(hex.slice(1,3),16), gg = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    g.addColorStop(0, `rgba(${r},${gg},${b},${a1})`);
    g.addColorStop(1, `rgba(${r},${gg},${b},${a2})`);
    return g;
  },

  base(extra={}){
    return Object.assign({
      responsive:true, maintainAspectRatio:false,
      interaction:{ mode:'index', intersect:false },
      plugins:{
        legend:{ display:true, position:'top', align:'end',
          labels:{ color:'#4E5A61', boxWidth:9, boxHeight:9, usePointStyle:true, pointStyle:'circle',
                   font:{ size:11, weight:'600' }, padding:14 } },
        tooltip:{
          backgroundColor:'#FFFFFF', borderColor:'#DDE4E7', borderWidth:1,
          titleColor:'#12181B', bodyColor:'#4E5A61', padding:11, cornerRadius:8,
          titleFont:{size:12, weight:'700'}, bodyFont:{size:11.5}, displayColors:true, boxPadding:4,
        },
      },
      scales:{
        x:{ grid:{ display:false }, ticks:{ color:'#7C8891', font:{size:10.5}, maxRotation:0, autoSkipPadding:16 },
            border:{ color:'#D8DEE1' } },
        y:{ grid:{ color:'#E6EBED' }, ticks:{ color:'#7C8891', font:{size:10.5} }, border:{ display:false },
            beginAtZero:true },
      },
    }, extra);
  },
};

if(typeof Chart !== 'undefined'){
  Chart.defaults.font.family = getComputedStyle(document.documentElement).getPropertyValue('--font') || 'sans-serif';
  Chart.defaults.color = '#7C8891';
}
