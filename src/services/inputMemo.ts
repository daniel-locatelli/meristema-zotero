/**
 * One value kept for as long as the inputs it was built from hold still, each
 * input compared by identity. The renderer orders its edges this way (B89): a
 * pan or zoom frame changes none of what decides the order, so it reuses the
 * last frame's instead of filtering, sorting and keying every edge again.
 *
 * `reuse: false` rebuilds whatever the inputs say. The caller passes it when it
 * cannot vouch that an input was not mutated in place, as the owner does with
 * the model's edge array.
 */
export interface InputMemo<I extends Record<string, unknown>, V> {
  get(inputs: I, build: () => V, reuse?: boolean): V;
}

export function createInputMemo<
  I extends Record<string, unknown>,
  V,
>(): InputMemo<I, V> {
  let last: { inputs: I; value: V } | null = null;
  const same = (left: I, right: I): boolean => {
    const keys = Object.keys(right);
    if (Object.keys(left).length !== keys.length) return false;
    return keys.every((key) => Object.is(left[key], right[key]));
  };
  return {
    get: (inputs, build, reuse = true) => {
      if (reuse && last && same(last.inputs, inputs)) return last.value;
      const value = build();
      last = { inputs: { ...inputs }, value };
      return value;
    },
  };
}
