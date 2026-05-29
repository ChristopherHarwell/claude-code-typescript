import type {
	ApiKey,
	FilePath,
	NonEmptyString,
	PromptFlag,
	ShellCommand,
	URLString,
} from "./types";
import {
	EmptyStringError,
	InvalidUrlError,
	UnexpectedFlagError,
} from "./Error";

// ── Refinement constructors ────────────────────────────────────────
//
// Each constructor validates the input and returns the same string value
// tagged with a nominal brand. Once branded, the value cannot be substituted
// by a raw `string` at call sites that demand the brand.

export function asNonEmptyString(value: string, field: string): NonEmptyString {
	if (value.length === 0) {
		throw new EmptyStringError(field);
	}
	return value as NonEmptyString;
}

export function asURLString(value: string, field: string): URLString {
	try {
		new URL(value);
	} catch {
		throw new InvalidUrlError(field, value);
	}
	return value as URLString;
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

export function asFilePath(value: string, field: string): FilePath {
	asNonEmptyString(value, field);
	return value as FilePath;
}

export function asShellCommand(value: string, field: string): ShellCommand {
	asNonEmptyString(value, field);
	return value as ShellCommand;
}
