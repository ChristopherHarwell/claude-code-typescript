import type {
	AbsolutePath,
	ApiKey,
	FilePath,
	HTTPSURL,
	NonEmptyString,
	PromptFlag,
	RelativePath,
	ShellCommand,
	TrimmedString,
	URLString,
} from "./types";
import {
	EmptyStringError,
	InvalidPathError,
	InvalidUrlError,
	UnexpectedFlagError,
} from "./Error";

// ── Refinement constructors ────────────────────────────────────────
//
// Each constructor validates the input and returns the same string value
// tagged with a nominal brand. Once branded, the value cannot be substituted
// by a raw `string` at call sites that demand the brand. Brands compose: a
// value can carry multiple `Validated<T, P>` brands simultaneously (each
// predicate occupies a unique `__brand__validated.${P}` field), so a doubly-
// refined value is structurally distinct from a singly-refined one.

export function asNonEmptyString(value: string, field: string): NonEmptyString {
	if (value.length === 0) {
		throw new EmptyStringError(field);
	}
	return value as NonEmptyString;
}

export function asTrimmedString(value: string, field: string): TrimmedString {
	if (value !== value.trim()) {
		throw new EmptyStringError(field);
	}
	return value as TrimmedString;
}

// Validates that `value` parses as a URL with an `http:` or `https:` scheme.
// Returns the broader `URLString<WebProtocol>` brand (either protocol).
export function asURLString(value: string, field: string): URLString {
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw new InvalidUrlError(field, value);
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new InvalidUrlError(field, value);
	}
	return value as URLString;
}

// Stricter variant: rejects any URL that isn't `https://…`. The return type is
// `HTTPSURL = URLString<"https">`, which (thanks to distributive `Validated`)
// is a subtype of the broader `URLString<WebProtocol>`.
export function asHTTPSURL(value: string, field: string): HTTPSURL {
	asURLString(value, field);
	if (!value.startsWith("https://")) {
		throw new InvalidUrlError(field, value);
	}
	return value as HTTPSURL;
}

export function asApiKey(value: string, field: string): ApiKey {
	asNonEmptyString(value, field);
	return value as ApiKey;
}

export function asPromptFlag(value: string): PromptFlag {
	if (value !== "-p") {
		throw new UnexpectedFlagError("-p", value);
	}
	return value as PromptFlag;
}

// Path refinements. AbsolutePath narrows to `\`/${string}\`` at the type
// level when constructed from a literal; runtime check validates dynamic
// strings. RelativePath is brand-only — TS can't express "does not start with
// /" as a negative template literal pattern.

export function asAbsolutePath(value: string, field: string): AbsolutePath {
	asNonEmptyString(value, field);
	if (!value.startsWith("/")) {
		throw new InvalidPathError(field, value, "absolute");
	}
	return value as AbsolutePath;
}

export function asRelativePath(value: string, field: string): RelativePath {
	asNonEmptyString(value, field);
	if (value.startsWith("/")) {
		throw new InvalidPathError(field, value, "relative");
	}
	return value as RelativePath;
}

// Accepts either shape; the caller gets the discriminated `FilePath` union
// and can narrow further with `.startsWith("/")` if needed.
export function asFilePath(value: string, field: string): FilePath {
	return value.startsWith("/")
		? asAbsolutePath(value, field)
		: asRelativePath(value, field);
}

export function asShellCommand(value: string, field: string): ShellCommand {
	asNonEmptyString(value, field);
	return value as ShellCommand;
}
