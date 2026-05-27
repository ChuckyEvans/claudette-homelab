// Converts interval values to cron expressions that fire at clock-aligned times
// ("on the dot") rather than relative to server startup.
//
// minutesToCron(5)  → '*/5 * * * *'   fires at :00, :05, :10, …
// minutesToCron(60) → '0 * * * *'     fires at top of every hour
// hoursToCron(6)    → '0 */6 * * *'   fires at 00:00, 06:00, 12:00, 18:00
// hoursToCron(24)   → '0 0 * * *'     fires once at midnight

export function minutesToCron(m) {
  if (m >= 60) return '0 * * * *'        // every hour on the dot
  return m <= 1 ? '* * * * *' : `*/${m} * * * *`
}

export function hoursToCron(h) {
  if (h >= 24) return '0 0 * * *'        // midnight daily
  return h <= 1 ? '0 * * * *' : `0 */${h} * * *`
}
