// Pure calculation logic. No DOM access here so it can be unit tested in Node.

/**
 * Parse a user-typed number. Accepts "15.5", "15,5", "12,310", "1.234,5", "1,234.5".
 * Returns NaN for empty or invalid input.
 */
export function parseNum(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (v === null || v === undefined) return NaN;
  let s = String(v).trim().replace(/[\s_']/g, '');
  if (!s) return NaN;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma !== -1 && lastDot !== -1) {
    // Whichever separator comes last is the decimal one.
    s = lastComma > lastDot
      ? s.replace(/\./g, '').replace(',', '.')
      : s.replace(/,/g, '');
  } else if (lastComma !== -1) {
    const parts = s.split(',');
    const looksLikeThousands =
      parts.length > 2 ||
      (parts.length === 2 && parts[1].length === 3 && parts[0] !== '0' && parts[0] !== '');
    s = looksLikeThousands ? parts.join('') : parts.join('.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** Convert a fuel-efficiency figure to km per litre. */
export function toKmPerLitre(value, unit) {
  if (!(value > 0)) return NaN;
  return unit === 'l100' ? 100 / value : value;
}

/** Round up to the next multiple of `step`, tolerating float noise. */
export function ceilTo(x, step) {
  return Math.ceil(x / step - 1e-9) * step;
}

export function sumFills(fills) {
  return (fills || []).reduce((s, f) => s + (f && f.litres > 0 ? f.litres : 0), 0);
}

function isLevel(x, segments) {
  return typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= segments;
}

/**
 * Work out how much fuel to add so the car is returned at its pickup level.
 *
 * Two independent methods:
 *  - consumption: litres burned over the whole trip (distance / mileage) minus
 *    litres already added. Needs odometer readings, not the gauge.
 *  - gauge: bars short of the pickup level converted to litres, plus fuel for
 *    the drive back. Needs tank size and gauge readings.
 *
 * The consumption method is preferred when available (gauge bars are coarse);
 * the gauge method is the fallback and a cross-check.
 *
 * All numeric inputs are numbers (NaN when unknown); levels are bar counts or null.
 */
export function computeRefuel(i) {
  const kmpl = toKmPerLitre(i.efficiency, i.efficiencyUnit);
  const remaining = i.remainingKm;
  const margin = i.margin > 0 ? i.margin : 0;
  const added = sumFills(i.fills);
  const hasKmpl = kmpl > 0;
  const hasRemaining = remaining >= 0;
  const driveBack = hasKmpl && hasRemaining ? remaining / kmpl : NaN;
  const hasGaugeScale = i.tank > 0 && i.segments > 0;
  const barLitres = hasGaugeScale ? i.tank / i.segments : NaN;

  const consumption = { ok: false, missing: [] };
  if (!hasKmpl) consumption.missing.push('mileage');
  if (!hasRemaining) consumption.missing.push('km to return');
  if (!(i.pickupOdo >= 0)) consumption.missing.push('odometer at pickup');
  if (!(i.nowOdo >= 0)) consumption.missing.push('odometer now');
  if (consumption.missing.length === 0) {
    const driven = i.nowOdo - i.pickupOdo;
    if (driven < 0) {
      consumption.issue = 'Odometer now is lower than at pickup.';
    } else {
      const totalKm = driven + remaining;
      const burned = totalKm / kmpl;
      Object.assign(consumption, { ok: true, driven, totalKm, burned, added, need: burned - added });
    }
  }

  const gauge = { ok: false, missing: [] };
  if (!hasKmpl) gauge.missing.push('mileage');
  if (!hasRemaining) gauge.missing.push('km to return');
  if (!(i.tank > 0)) gauge.missing.push('tank size');
  if (!(i.segments > 0)) gauge.missing.push('bars on gauge');
  if (!isLevel(i.pickupLevel, i.segments)) gauge.missing.push('fuel at pickup');
  if (!isLevel(i.nowLevel, i.segments)) gauge.missing.push('fuel now');
  if (gauge.missing.length === 0) {
    const barsShort = i.pickupLevel - i.nowLevel;
    const short = barsShort * barLitres;
    Object.assign(gauge, {
      ok: true,
      barsShort,
      barLitres,
      short,
      driveBack,
      need: short + driveBack,
    });
  }

  const res = {
    kmpl,
    driveBack,
    margin,
    added,
    barLitres,
    methods: { consumption, gauge },
    primaryKey: consumption.ok ? 'consumption' : gauge.ok ? 'gauge' : null,
    warnings: [],
    litres: null,
    amount: null,
    noFuelNeeded: false,
  };
  if (!res.primaryKey) return res;

  const raw = res.methods[res.primaryKey].need;
  res.raw = raw;
  if (raw <= 0) {
    res.noFuelNeeded = true;
    res.litres = 0;
  } else {
    res.litres = ceilTo(raw + margin, 0.1);
  }
  if (i.price > 0) res.amount = Math.ceil(res.litres * i.price - 1e-9);

  if (consumption.ok && gauge.ok) {
    res.methodDiff = Math.abs(consumption.need - gauge.need);
    res.methodsAgree = res.methodDiff <= barLitres;
    if (!res.methodsAgree) {
      res.warnings.push(
        `The two methods differ by ${res.methodDiff.toFixed(1)} L, more than one bar. ` +
          'Check the mileage figure and the gauge readings.'
      );
    }
  }

  if (hasGaugeScale && isLevel(i.nowLevel, i.segments)) {
    const space = i.tank - i.nowLevel * barLitres;
    res.spaceInTank = space;
    if (res.litres > space + barLitres) {
      res.warnings.push(
        `That is more than the ~${space.toFixed(1)} L of free space the gauge shows. ` +
          'Double-check your readings.'
      );
    }
  }

  return res;
}
