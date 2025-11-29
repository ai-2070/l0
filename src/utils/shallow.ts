// Shallow clone and copy utilities

/**
 * Shallow clone an object. Handles null/undefined, primitives, arrays, and plain objects.
 * @param obj - Object to clone
 * @returns Shallow clone of the object
 */
export function shallowClone<T>(obj: T): T {
  // Handle null/undefined
  if (obj === null || obj === undefined) {
    return obj;
  }

  // Handle primitives (string, number, boolean, symbol, bigint)
  if (typeof obj !== "object") {
    return obj;
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    return [...obj] as T;
  }

  // Handle plain objects
  return { ...(obj as object) } as T;
}

/**
 * Shallow copy properties from source to target object.
 * @param source - Source object to copy from
 * @param target - Target object to copy to
 */
export function shallowCopy<T extends object>(source: T, target: T): void {
  Object.assign(target, source);
}
