import type {
	AbsolutePath,
	ApiKey,
	CliArg,
	EnvVar,
	FilePath,
	HTTPSURL,
	HTTPURL,
	NonEmptyString,
	PromptFlag,
	RelativePath,
	ShellCommand,
	TrimmedString,
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

function asNonEmptyString(value: string, field: string): NonEmptyString {
	if (value.length === 0) {
		throw new EmptyStringError(field);
	}
	return value as NonEmptyString;
}

function asTrimmedString(value: string, field: string): TrimmedString {
	if (value !== value.trim()) {
		throw new EmptyStringError(field);
	}
	return value as TrimmedString;
}

// Strict per-protocol validators. Each parses the URL, then verifies the
// scheme prefix matches its expected template-literal shape before branding.

function asHTTPURL(value: string, field: string): HTTPURL {
	try {
		new URL(value);
	} catch {
		throw new InvalidUrlError(field, value);
	}
	if (!value.startsWith("http://")) {
		throw new InvalidUrlError(field, value);
	}
	return value as HTTPURL;
}

function asHTTPSURL(value: string, field: string): HTTPSURL {
	try {
		new URL(value);
	} catch {
		throw new InvalidUrlError(field, value);
	}
	if (!value.startsWith("https://")) {
		throw new InvalidUrlError(field, value);
	}
	return value as HTTPSURL;
}

// Smart dispatcher: validates that `value` is a parseable http:// or https://
// URL and routes to the appropriate per-protocol validator so the return type
// is the *precise* brand (`HTTPURL | HTTPSURL`), not just the broader union.
// Thanks to distributive `Validated`, this is structurally identical to
// `URLString<WebProtocol>` but narrows naturally on the consumer side via the
// underlying template-literal-typed string.
function asURLString(value: string, field: string): HTTPURL | HTTPSURL {
	if (value.startsWith("https://")) {
		return asHTTPSURL(value, field);
	}
	if (value.startsWith("http://")) {
		return asHTTPURL(value, field);
	}
	throw new InvalidUrlError(field, value);
}

function asApiKey(value: string, field: string): ApiKey {
	asNonEmptyString(value, field);
	return value as ApiKey;
}

function asPromptFlag(value: string): PromptFlag {
	if (value !== "-p") {
		throw new UnexpectedFlagError("-p", value);
	}
	return value as PromptFlag;
}

// Path refinements. AbsolutePath narrows to `\`/${string}\`` at the type
// level when constructed from a literal; runtime check validates dynamic
// strings. RelativePath is brand-only — TS can't express "does not start with
// /" as a negative template literal pattern.

function asAbsolutePath(value: string, field: string): AbsolutePath {
	asNonEmptyString(value, field);
	if (!value.startsWith("/")) {
		throw new InvalidPathError(field, value, "absolute");
	}
	return value as AbsolutePath;
}

function asRelativePath(value: string, field: string): RelativePath {
	asNonEmptyString(value, field);
	if (value.startsWith("/")) {
		throw new InvalidPathError(field, value, "relative");
	}
	return value as RelativePath;
}

// Accepts either shape; the caller gets the discriminated `FilePath` union
// and can narrow further with `.startsWith("/")` if needed.
function asFilePath(value: string, field: string): FilePath {
	return value.startsWith("/")
		? asAbsolutePath(value, field)
		: asRelativePath(value, field);
}

function asShellCommand(value: string, field: string): ShellCommand {
	asNonEmptyString(value, field);
	return value as ShellCommand;
}

// ── Provenance tags ────────────────────────────────────────────────
//
// Pre-validation source tags. Neither checks the value shape — they only
// record where the string came from so the type system can distinguish a raw
// CLI arg from a raw env var before any further refinement runs. Both pass
// `undefined` through unchanged so consumers can use `??` for defaults.

function asEnvVar(value: string | undefined): EnvVar | undefined {
	return value === undefined ? undefined : (value as EnvVar);
}

function asCliArg(value: string | undefined): CliArg | undefined {
	return value === undefined ? undefined : (value as CliArg);
}

export {
	asNonEmptyString,
	asTrimmedString,
	asHTTPURL,
	asHTTPSURL,
	asURLString,
	asApiKey,
	asPromptFlag,
	asAbsolutePath,
	asRelativePath,
	asFilePath,
	asShellCommand,
	asEnvVar,
	asCliArg,
};
