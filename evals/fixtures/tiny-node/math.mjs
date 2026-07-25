// A tiny math module for the agentic eval fixture.
//
// `add` is correct and covered by math.test.mjs (that test passes as shipped).
// `rangeSum` carries a SEEDED off-by-one bug: it is meant to return the sum of
// 1..n inclusive, but the loop stops at n-1, so rangeSum(5) returns 10 (1+2+3+4)
// instead of 15. It is deliberately left UNTESTED so `node --test` passes on the
// seed — a bug-fix eval case exercises fixing it and adding a repro test.

export function add(a, b) {
  return a + b;
}

export function rangeSum(n) {
  let total = 0;
  for (let i = 1; i < n; i++) {
    total += i;
  }
  return total;
}
