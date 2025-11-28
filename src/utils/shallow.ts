// Shallow clone and copy utilities
export function shallowClone<T>(obj: T): T {
  // TODO: Implement shallow clone
  return { ...obj as any };
}

export function shallowCopy<T extends object>(source: T, target: T): void {
  // TODO: Implement shallow copy
  Object.assign(target, source);
}
