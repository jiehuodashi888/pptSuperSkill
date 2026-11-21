/** Preserve all own data fields across QA boundaries, including non-enumerable
 * fields, so validation cannot silently discard an unsupported semantic payload.
 * Accessors are rejected without invoking them; the resulting data is immutable.
 */
export function snapshotQaData<T>(value: T, copies = new WeakMap<object, object>()): T {
  if (typeof value === "function" || typeof value === "symbol") throw new TypeError("QA inputs must contain only data");
  if (value === null || typeof value !== "object") return value;
  const existing = copies.get(value);
  if (existing) return existing as T;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null && prototype !== Array.prototype) throw new TypeError("QA inputs must contain plain data objects");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result = Array.isArray(value) ? new Array(descriptors.length!.value as number) : {};
  copies.set(value, result);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string") throw new TypeError("QA inputs must contain string-keyed data");
    if (Array.isArray(value) && key === "length") continue;
    const descriptor = descriptors[key]!;
    if (!("value" in descriptor)) throw new TypeError("QA inputs must not contain accessors");
    Object.defineProperty(result, key, { value: snapshotQaData(descriptor.value, copies), enumerable: true, configurable: false, writable: false });
  }
  return Object.freeze(result) as T;
}
