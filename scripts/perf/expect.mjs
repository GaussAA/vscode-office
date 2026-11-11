/** The perf gate's only assertion primitive: throw, and the runner records a failure. */
export function expect(condition, message) {
  if (!condition) throw new Error(message);
}
