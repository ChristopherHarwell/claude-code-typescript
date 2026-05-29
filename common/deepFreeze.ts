import type { DeepReadonly, Owned } from "./types";

// ── deepFreeze (standalone) ────────────────────────────────────────────────
//
// Recursively freezes an object and all of its nested own-key properties.
// Primitives, `null`, and `undefined` pass through unchanged. `Date`,
// `RegExp`, and `Function` instances are frozen at the top level only — the
// walk does not recurse into their internals (their own keys are not
// enumerated for further freezing beyond the call already taken).
//
// Mirrored from asure.identity.api/src/core/common/deepFreeze.ts so module-
// level helpers can use it without DI access.
export function deepFreeze<T>(obj: T): DeepReadonly<Owned<T>> {
	const isNotObjectOrFunction: boolean =
		obj === null || (typeof obj !== "object" && typeof obj !== "function");

	if (isNotObjectOrFunction) {
		return obj as DeepReadonly<Owned<T>>;
	}

	// Date/RegExp/Function are frozen at the top level only — their internal
	// own keys are not walked. Recursing into them would freeze unrelated
	// captured state (e.g. an `inner` object hung off a function instance) and
	// yield surprising deep-freeze side effects on engine-managed slots.
	const isOpaqueLeaf: boolean =
		typeof obj === "function" || obj instanceof Date || obj instanceof RegExp;

	if (isOpaqueLeaf) {
		return Object.freeze(obj) as DeepReadonly<Owned<T>>;
	}

	const keys: ReadonlyArray<PropertyKey> = Reflect.ownKeys(obj as object);

	keys.forEach((key: PropertyKey): void => {
		const property: unknown = (obj as Record<PropertyKey, unknown>)[key];
		const shouldFreeze: boolean =
			!!property &&
			(typeof property === "object" || typeof property === "function") &&
			!Object.isFrozen(property);
		if (shouldFreeze) {
			deepFreeze(property);
		}
	});

	return Object.freeze(obj) as DeepReadonly<Owned<T>>;
}
