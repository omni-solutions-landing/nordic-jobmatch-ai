export type Result<T, E = Error> =
  | { readonly success: true; readonly value: T }
  | { readonly success: false; readonly error: E };

export const ok = <T, E = Error>(value: T): Result<T, E> => ({
  success: true,
  value,
});

export const fail = <T, E = Error>(error: E): Result<T, E> => ({
  success: false,
  error,
});

export const map = <T, U, E>(
  result: Result<T, E>,
  fn: (val: T) => U
): Result<U, E> => {
  return result.success ? ok(fn(result.value)) : result;
};

export const flatMap = <T, U, E>(
  result: Result<T, E>,
  fn: (val: T) => Result<U, E>
): Result<U, E> => {
  return result.success ? fn(result.value) : result;
};

export const fromPromise = async <T>(
  promise: Promise<T>
): Promise<Result<T, Error>> => {
  try {
    const value = await promise;
    return ok(value);
  } catch (err) {
    return fail(err instanceof Error ? err : new Error(String(err)));
  }
};
