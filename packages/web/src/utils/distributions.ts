/**
 * Statistical distribution functions for realistic demo data generation.
 *
 * Pure functions with no dependencies — suitable for use in data generators.
 */

/**
 * Box-Muller transform: generates two independent standard normal N(0,1) samples
 * from two uniform random samples.
 */
export function boxMuller(): [number, number] {
  let u1 = Math.random();
  let u2 = Math.random();
  // Avoid log(0)
  while (u1 === 0) u1 = Math.random();
  while (u2 === 0) u2 = Math.random();

  const r = Math.sqrt(-2 * Math.log(u1));
  const theta = 2 * Math.PI * u2;
  return [r * Math.cos(theta), r * Math.sin(theta)];
}

/**
 * Log-normal sample calibrated so E[X] = mean.
 *
 * Uses mu = ln(mean) - sigma²/2 so the expected value equals `mean`.
 * sigma controls spread: 0.3 = tight cluster, 0.5 = moderate, 0.8+ = wide.
 *
 * @param mean  - Target expected value (must be > 0)
 * @param sigma - Log-normal sigma (spread parameter). 0 returns mean exactly.
 * @returns A positive number drawn from the log-normal distribution.
 */
export function logNormal(mean: number, sigma: number): number {
  if (mean <= 0) return 0;
  if (sigma === 0) return mean;

  const mu = Math.log(mean) - (sigma * sigma) / 2;
  const [z] = boxMuller();
  return Math.exp(mu + sigma * z);
}

/**
 * Poisson sample using Knuth's algorithm.
 * Fine for lambda < ~30 (our use case: activities per week ≤ 7).
 *
 * @param lambda - Expected value (rate parameter). 0 returns 0.
 * @returns A non-negative integer drawn from the Poisson distribution.
 */
export function poisson(lambda: number): number {
  if (lambda <= 0) return 0;

  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;

  do {
    k++;
    p *= Math.random();
  } while (p > L);

  return k - 1;
}
