import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDate, discountEnd, monthlyBill, buildTimeline, validateInput, buildIcs, speedCheck, formatDate,
} from './calc.js';

const d = (s) => parseDate(s);

test('parseDate는 없는 날짜를 거른다', () => {
  assert.deepEqual(d('2026-03-15'), { y: 2026, m: 3, d: 15 });
  assert.equal(d('2026-02-29'), null);
  assert.deepEqual(d('2028-02-29'), { y: 2028, m: 2, d: 29 });
  assert.equal(d('2026-13-01'), null);
  assert.equal(d('20260315'), null);
});

test('화면 예시 문구와 계산이 같다 (3월 15일 개통, 6개월)', () => {
  const s = d('2026-03-15');
  assert.equal(formatDate(discountEnd('includeStartMonth', s, 6)), '2026-08-31');
  assert.equal(formatDate(discountEnd('fromNextMonth', s, 6)), '2026-09-30');
  assert.equal(formatDate(discountEnd('byDays', s, 6)), '2026-09-14');
});

test('연도를 넘기고, 같은 날짜가 없는 달을 처리한다', () => {
  assert.equal(formatDate(discountEnd('fromNextMonth', d('2026-11-20'), 3)), '2027-02-28');
  assert.equal(formatDate(discountEnd('byDays', d('2026-01-31'), 1)), '2026-02-28');
  assert.equal(formatDate(discountEnd('byDays', d('2026-01-29'), 1)), '2026-02-28');
  assert.equal(formatDate(discountEnd('byDays', d('2027-12-31'), 2)), '2028-02-29');
  assert.equal(formatDate(discountEnd('byDays', d('2026-12-01'), 1)), '2026-12-31');
  assert.equal(formatDate(discountEnd('includeStartMonth', d('2026-12-10'), 1)), '2026-12-31');
});

test('개통한 달은 날짜 수로 일할한다', () => {
  const s = d('2026-04-16'); // 4월은 30일, 16~30일 = 15일
  const end = discountEnd('includeStartMonth', s, 6);
  const b = monthlyBill({ y: 2026, m: 4 }, s, end, 30000, 60000);
  assert.equal(b.promoDays, 15);
  assert.equal(b.amount, 15000);
});

test('요금이 바뀌는 달은 할인 일수와 정상 일수로 나눈다', () => {
  const s = d('2026-03-15');
  const end = discountEnd('byDays', s, 6); // 9월 14일까지 할인
  const b = monthlyBill({ y: 2026, m: 9 }, s, end, 30000, 60000);
  assert.equal(b.promoDays, 14);
  assert.equal(b.regularDays, 16);
  assert.equal(b.amount, Math.round((30000 * 14 + 60000 * 16) / 30));
});

test('타임라인은 개통월부터 종료월 + 3개월까지다', () => {
  const t = buildTimeline({ method: 'fromNextMonth', start: d('2026-03-15'), months: 6, promoFee: 9900, regularFee: 33000 });
  assert.equal(t.rows.length, 7 + 3);
  assert.deepEqual(t.firstFullRegularMonth, { y: 2026, m: 10 });
  assert.equal(t.increase, 23100);
  assert.ok(t.rows.slice(1, 7).every((r) => r.amount === 9900));
});

test('입력 검증', () => {
  assert.equal(validateInput({ start: d('2026-03-15'), months: 6, promoFee: 0, regularFee: 33000 }).length, 0);
  assert.equal(validateInput({ start: null, months: 0, promoFee: -1, regularFee: NaN }).length, 4);
  assert.equal(validateInput({ start: d('2026-03-15'), months: 6.5, promoFee: 1, regularFee: 1 }).length, 1);
});

test('ics 파일 형식', () => {
  const ics = buildIcs({
    remindDate: d('2026-09-07'), end: d('2026-09-14'), methodLabel: '날짜, 세는 법; 테스트', regularFee: 33000,
    now: new Date('2026-10-11T00:00:00Z'),
  });
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /DTSTART;VALUE=DATE:20260907\r\n/);
  assert.match(ics, /DTEND;VALUE=DATE:20260908\r\n/);
  assert.match(ics, /DTSTAMP:20261011T000000Z\r\n/);
  assert.match(ics.replace(/\r\n /g, ''), /날짜\\, 세는 법\\; 테스트/);
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
});

test('소진 후 속도 판정', () => {
  const r = speedCheck(1);
  assert.deepEqual(r.filter((s) => s.ok).map((s) => s.quality), ['SD 360p']);
  assert.equal(speedCheck(5).filter((s) => s.ok).length, 4);
});

test('검수 반영: 연도 범위, 빈 값, ics 줄 접기', async () => {
  const { foldLine } = await import('./calc.js');
  assert.equal(d('0026-03-15'), null);
  assert.equal(validateInput({ start: d('2026-03-15'), months: 6, promoFee: NaN, regularFee: NaN }).length, 2);
  const ics = buildIcs({
    remindDate: d('2026-09-07'), end: d('2026-09-14'), methodLabel: '개통일부터 날짜로 N개월을 센다', regularFee: 33000,
    now: new Date('2026-10-11T00:00:00Z'),
  });
  const enc = new TextEncoder();
  for (const line of ics.split('\r\n')) assert.ok(enc.encode(line).length <= 75, line);
  assert.ok(ics.includes('\r\n '));
  const long = '가'.repeat(60);
  assert.equal(foldLine(long).replace(/\r\n /g, ''), long);
});

test('ics에 그날 오전 9시 알람이 들어간다', () => {
  const ics = buildIcs({ remindDate: d('2026-09-07'), end: d('2026-09-14'), methodLabel: 'x', regularFee: 1, now: new Date('2026-10-11T00:00:00Z') });
  const lines = ics.replace(/\r\n /g, '').split('\r\n');
  const i = lines.indexOf('BEGIN:VALARM');
  assert.ok(i > 0);
  assert.deepEqual([lines[i + 1], lines[i + 3], lines[i + 4], lines[i + 5]], ['ACTION:DISPLAY', 'TRIGGER;RELATED=START:PT9H', 'END:VALARM', 'END:VEVENT']);
});

test('알림 문구는 날짜와 요금을 한 줄로', async () => {
  const { reminderText } = await import('./calc.js');
  assert.equal(reminderText(d('2026-08-31'), 9900, 33000), '휴대폰 요금 할인이 2026-08-31에 끝날 수 있음. 이후 월 33,000원(지금보다 23,100원 많음). 가입한 회사에 정확한 종료일 확인하기.');
});

test('알림 기준일은 오늘 이후의 가장 이른 후보', async () => {
  const { pickReminderEnd } = await import('./calc.js');
  const ends = [d('2026-10-31'), d('2026-09-30'), d('2026-10-19')];
  assert.equal(formatDate(pickReminderEnd(ends, d('2026-10-18')).end), '2026-10-19');
  assert.equal(formatDate(pickReminderEnd(ends, d('2026-10-19')).end), '2026-10-19');
  assert.equal(formatDate(pickReminderEnd(ends, d('2026-08-01')).end), '2026-09-30');
  const past = pickReminderEnd(ends, d('2026-11-05'));
  assert.deepEqual([formatDate(past.end), past.allPast], ['2026-10-31', true]);
});
