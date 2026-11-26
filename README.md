# Refuel to the Dot

Rental cars often come with a "return at the same fuel level" policy, and any extra fuel you put in is lost. This small web app tells you how much to add at your last fuel stop so you return the car at the pickup level and no higher.

It's a single static page with no build step and no backend. It can be installed to a phone's home screen and works offline. Trip data is stored only in the browser's local storage.

## How it calculates

It uses two methods side by side:

**1. By distance driven** (preferred when you have odometer readings)

```
to add = (km driven so far + km still to drive) ÷ mileage − litres already added this trip
```

This never reads the fuel gauge, so it avoids the gauge's coarse bars (one bar on a 50 L, 8-bar tank is about 6 L). Its accuracy depends on the mileage figure, so reset Trip B when you pick up the car and use its average.

**2. By fuel gauge** (fallback and cross-check)

```
to add = (pickup bars − current bars) × (tank size ÷ bars) + km still to drive ÷ mileage
```

When both methods can run, the app shows both. It warns you if they differ by more than one bar's worth of fuel, which usually means a wrong reading. A small safety margin (0.5 L by default) is added so the needle doesn't land just under the mark. If you enter a price per litre, the amount is shown too, which helps at pumps that work by amount.

## Using it

1. **At pickup:** enter tank size, mileage, the odometer reading, and tap the fuel gauge bar that matches the car.
2. **At any fuel stop:** enter the current odometer reading, the distance to the return point and the current gauge level. The answer appears in the bar at the bottom.
3. **After filling:** tap *Log fill-up* so later stops account for it.

## Development

```sh
npm test        # unit tests for the calculation (Node 18+)
npm run serve   # serve locally at http://localhost:8080
```

- `calc.js`: the calculation logic, with no DOM code
- `app.js`: the UI and local-storage handling
- `sw.js`: the offline cache. Bump `CACHE` when you ship changes.

## Hosting

Any static host works. For GitHub Pages: open **Settings → Pages**, choose *Deploy from a branch*, then pick the branch and `/ (root)`. All paths are relative, so the app works under `/<repo-name>/`.
