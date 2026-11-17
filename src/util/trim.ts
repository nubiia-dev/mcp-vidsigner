/**
 * Removes every trailing occurrence of any character in `chars` from `value`.
 *
 * Linear-time replacement for `value.replace(/x+$/, '')`: that regex backtracks quadratically on
 * long inputs with many `x` that do not end the string (CodeQL `js/polynomial-redos`), and the
 * inputs here (URLs, hosts, free text) come from the environment or from the model.
 *
 * @param value - String to trim.
 * @param chars - Characters to strip from the end, e.g. `'/'` or `'.,;:!?'`.
 * @returns `value` without the trailing characters.
 */
export function trimEnd(value: string, chars: string): string {
  let end = value.length;
  while (end > 0 && chars.includes(value.charAt(end - 1))) end--;
  return value.slice(0, end);
}
