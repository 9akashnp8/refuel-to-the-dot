import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNum, toKmPerLitre, ceilTo, computeRefuel } from '../calc.js';

const base = {
  tank: 50,
  segments: 8,
  pickupLevel: 4,
  nowLevel: 2,
  pickupOdo: 12000,
  nowOdo: 12310,
  remainingKm: 40,
  efficiency: 15,
  efficiencyUnit: 'kmpl',
  fills: [],
  margin: 0,
  price: NaN,
};

test('parseNum handles locales and separators', () => {
  assert.equal(parseNum('15.5'), 15.5);
  assert.equal(parseNum('15,5'), 15.5);
  assert.equal(parseNum('12,310'), 12310);
  assert.equal(parseNum('1,234.5'), 1234.5);
  assert.equal(parseNum('1.234,5'), 1234.5);
  assert.equal(parseNum('0,500'), 0.5);
  assert.equal(parseNum(' 42 '), 42);
  assert.ok(Number.isNaN(parseNum('')));
  assert.ok(Number.isNaN(parseNum('abc')));
  assert.ok(Number.isNaN(parseNum(null)));
});

test('efficiency conversion', () => {
  assert.equal(toKmPerLitre(15, 'kmpl'), 15);
  assert.equal(toKmPerLitre(5, 'l100'), 20);
  assert.ok(Number.isNaN(toKmPerLitre(0, 'kmpl')));
});

test('ceilTo avoids float noise', () => {
  assert.equal(ceilTo(13.3, 0.1).toFixed(1), '13.3');
  assert.equal(ceilTo(13.31, 0.1).toFixed(1), '13.4');
});

test('consumption method: example from the design notes', () => {
  const r = computeRefuel({ ...base, fills: [{ litres: 10 }] });
  assert.equal(r.primaryKey, 'consumption');
  const c = r.methods.consumption;
  assert.equal(c.driven, 310);
  assert.equal(c.totalKm, 350);
  assert.ok(Math.abs(c.burned - 23.333) < 0.01);
  assert.equal(r.litres.toFixed(1), '13.4');
});

test('gauge method used when odometer is missing', () => {
  const r = computeRefuel({ ...base, pickupOdo: NaN });
  assert.equal(r.primaryKey, 'gauge');
  // 2 bars short of 6.25 L each = 12.5 L, plus 40/15 = 2.667 L
  assert.ok(Math.abs(r.methods.gauge.need - 15.1667) < 0.001);
  assert.equal(r.litres.toFixed(1), '15.2');
  assert.deepEqual(r.methods.consumption.missing, ['odometer at pickup']);
});

test('margin and price', () => {
  const r = computeRefuel({ ...base, fills: [{ litres: 10 }], margin: 0.5, price: 105.5 });
  assert.equal(r.litres.toFixed(1), '13.9');
  assert.equal(r.amount, Math.ceil(13.9 * 105.5));
});

test('no fuel needed when already above pickup level', () => {
  const r = computeRefuel({ ...base, fills: [{ litres: 30 }], margin: 0.5 });
  assert.equal(r.noFuelNeeded, true);
  assert.equal(r.litres, 0);
});

test('L/100 km input', () => {
  const r = computeRefuel({ ...base, efficiency: 5, efficiencyUnit: 'l100' });
  // 350 km at 20 km/L = 17.5 L
  assert.equal(r.litres.toFixed(1), '17.5');
});

test('odometer going backwards falls back to gauge', () => {
  const r = computeRefuel({ ...base, nowOdo: 11000 });
  assert.equal(r.methods.consumption.ok, false);
  assert.ok(r.methods.consumption.issue);
  assert.equal(r.primaryKey, 'gauge');
});

test('methods disagreeing by more than a bar raises a warning', () => {
  // Consumption says 23.3 L needed; gauge says 15.2 L.
  const r = computeRefuel(base);
  assert.equal(r.methodsAgree, false);
  assert.ok(r.warnings.some((w) => w.includes('differ')));
});

test('methods agreeing within a bar: no warning', () => {
  const r = computeRefuel({ ...base, fills: [{ litres: 10 }] });
  assert.equal(r.methodsAgree, true);
  assert.equal(r.warnings.length, 0);
});

test('warns when more than the tank can take', () => {
  const r = computeRefuel({ ...base, nowLevel: 7, pickupOdo: 0, nowOdo: 600 });
  assert.ok(r.warnings.some((w) => w.includes('free space')));
});

test('nothing computed with no inputs', () => {
  const r = computeRefuel({
    tank: NaN, segments: 8, pickupLevel: null, nowLevel: null, pickupOdo: NaN, nowOdo: NaN,
    remainingKm: NaN, efficiency: NaN, efficiencyUnit: 'kmpl', fills: [], margin: 0.5, price: NaN,
  });
  assert.equal(r.primaryKey, null);
  assert.equal(r.litres, null);
});
