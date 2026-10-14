// 할인 종료일·월별 요금 계산. 브라우저와 Node 테스트가 같은 파일을 쓴다.
// 날짜는 연·월·일만 다룬다(시각·시간대 없음). 월 요금은 날짜 수로 나눠 일할한다.

export const METHODS = {
  includeStartMonth: {
    label: '개통한 달을 1개월째로 센다',
    example: '3월 15일 개통, 6개월 할인 → 8월 31일까지 할인',
  },
  fromNextMonth: {
    label: '개통 다음 달부터 N개월을 센다',
    example: '3월 15일 개통, 6개월 할인 → 9월 30일까지 할인',
  },
  byDays: {
    label: '개통일부터 날짜로 N개월을 센다',
    example: '3월 15일 개통, 6개월 할인 → 9월 14일까지 할인',
  },
};

export function parseDate(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text));
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  // Date.UTC는 0~99년을 1900년대로 바꾸므로 현실적인 범위만 받는다.
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
  return { y, m: mo, d };
}

export function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function formatDate({ y, m, d }) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// 비교용 정수(YYYYMMDD)
const key = ({ y, m, d }) => y * 10000 + m * 100 + d;

function shiftMonth(y, m, n) {
  const idx = y * 12 + (m - 1) + n;
  return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
}

export function addDays(date, n) {
  const t = new Date(Date.UTC(date.y, date.m - 1, date.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

export function discountEnd(method, start, months) {
  if (method === 'includeStartMonth' || method === 'fromNextMonth') {
    const offset = method === 'includeStartMonth' ? months - 1 : months;
    const { y, m } = shiftMonth(start.y, start.m, offset);
    return { y, m, d: daysInMonth(y, m) };
  }
  if (method === 'byDays') {
    // 민법 제160조처럼 마지막 달의 같은 날짜 전날에 끝난다.
    // 같은 날짜가 없으면(1월 31일 + 1개월) 그 달 말일에 끝난다.
    const { y, m } = shiftMonth(start.y, start.m, months);
    const last = daysInMonth(y, m);
    if (start.d > last) return { y, m, d: last };
    return addDays({ y, m, d: start.d }, -1);
  }
  throw new Error(`알 수 없는 계산 방식: ${method}`);
}

// 한 달 청구액(근사). 개통 전 날짜는 0원, 할인 종료일까지는 할인 요금, 그 뒤는 정상 요금.
export function monthlyBill({ y, m }, start, end, promoFee, regularFee) {
  const days = daysInMonth(y, m);
  let promoDays = 0, regularDays = 0;
  for (let d = 1; d <= days; d++) {
    const k = key({ y, m, d });
    if (k < key(start)) continue;
    if (k <= key(end)) promoDays++;
    else regularDays++;
  }
  const amount = Math.round((promoFee * promoDays + regularFee * regularDays) / days);
  return { y, m, amount, promoDays, regularDays, days };
}

export function validateInput({ start, months, promoFee, regularFee }) {
  const errors = [];
  if (!start) errors.push('개통일을 YYYY-MM-DD 형식으로 넣어 주세요.');
  if (!Number.isInteger(months) || months < 1 || months > 60) errors.push('할인 개월 수는 1~60 사이 정수로 넣어 주세요.');
  for (const [name, v] of [['할인 요금', promoFee], ['할인 후 요금', regularFee]]) {
    if (!Number.isFinite(v) || v < 0 || v > 1_000_000) errors.push(`${name}은 0~1,000,000원 사이로 넣어 주세요.`);
  }
  return errors;
}

// 개통월부터 할인 종료월 + extraMonths 까지의 월별 청구액과 요약
export function buildTimeline({ method, start, months, promoFee, regularFee, extraMonths = 3 }) {
  const end = discountEnd(method, start, months);
  const span = (end.y - start.y) * 12 + (end.m - start.m) + 1 + extraMonths;
  const rows = [];
  for (let i = 0; i < span; i++) {
    rows.push(monthlyBill(shiftMonth(start.y, start.m, i), start, end, promoFee, regularFee));
  }
  const firstFullRegular = rows.find((r) => r.regularDays === r.days);
  return {
    method,
    end,
    rows,
    increase: regularFee - promoFee,
    firstFullRegularMonth: firstFullRegular ? { y: firstFullRegular.y, m: firstFullRegular.m } : null,
  };
}

// 달력 알림(.ics) 본문. 종일 일정 하나. 사용자 기기 안에서만 만든다.
export function buildIcs({ remindDate, end, methodLabel, regularFee, now = new Date() }) {
  const ymd = (dt) => formatDate(dt).replaceAll('-', '');
  const next = addDays(remindDate, 1);
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = (s) => String(s).replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//promo-end//KO',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${ymd(remindDate)}-${ymd(end)}@promo-end`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${ymd(remindDate)}`,
    `DTEND;VALUE=DATE:${ymd(next)}`,
    `SUMMARY:${esc('휴대폰 요금 할인 종료 확인')}`,
    `DESCRIPTION:${esc(`할인 종료 예정일 ${formatDate(end)} (${methodLabel} 기준 계산). 이후 월 ${regularFee.toLocaleString('ko-KR')}원. 실제 날짜는 계약서·이용약관으로 확인하세요.`)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

// RFC 5545 3.1: 한 줄은 75옥텟을 넘지 않게, 넘으면 CRLF + 공백으로 접는다. UTF-8 문자 중간에서 자르지 않는다.
export function foldLine(line) {
  const enc = new TextEncoder();
  const parts = [];
  let cur = '', bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    const limit = parts.length === 0 ? 75 : 74; // 이어지는 줄은 앞 공백 1옥텟
    if (bytes + n > limit) { parts.push(cur); cur = ''; bytes = 0; }
    cur += ch;
    bytes += n;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

// 데이터 소진 후 속도로 볼 수 있는 유튜브 화질.
// 출처: YouTube 고객센터 "시스템 요구사항 및 YouTube 지원 기기" 권장 지속 속도
// https://support.google.com/youtube/answer/78358?hl=ko (2026-10-11 확인)
export const YOUTUBE_SPEEDS = [
  { quality: 'SD 360p', mbps: 0.7 },
  { quality: 'SD 480p', mbps: 1.1 },
  { quality: 'HD 720p', mbps: 2.5 },
  { quality: 'HD 1080p', mbps: 5 },
  { quality: '4K UHD', mbps: 20 },
];

export function speedCheck(mbps) {
  return YOUTUBE_SPEEDS.map((s) => ({ ...s, ok: mbps >= s.mbps }));
}
