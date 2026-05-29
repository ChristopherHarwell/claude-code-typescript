// ── Error taxonomy ─────────────────────────────────────────────────
//
// Every thrown error in this project should extend AppError so a caller can
// dispatch on `kind` (string literal) or `code` (stable numeric id) without
// regex-matching messages.
//
// Code ranges:
//   1xxx — configuration / startup
//   2xxx — input validation / refinement
//   3xxx — protocol / API response
//   4xxx — tool execution

const ERROR_CODES = {
	MissingEnvVar:           1001,
	InvalidCliArguments:     1002,
	EmptyString:             2001,
	InvalidUrl:              2002,
	UnexpectedFlag:          2003,
	EmptyChoices:            3001,
	UnsupportedToolCallType: 3002,
	UnknownToolName:         3003,
	ToolNotImplemented:      4001,
	MaxIterationsExceeded:   5001,
} as const;

type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
type ErrorKind = keyof typeof ERROR_CODES;

abstract class AppError extends Error {
	public abstract readonly kind: ErrorKind;
	public abstract readonly code: ErrorCode;
}

class MissingEnvVarError extends AppError {
	public override readonly name: "MissingEnvVarError" = "MissingEnvVarError";
	public readonly kind: "MissingEnvVar" = "MissingEnvVar";
	public readonly code: typeof ERROR_CODES.MissingEnvVar = ERROR_CODES.MissingEnvVar;
	public readonly variable: string;
	public constructor(variable: string) {
		super(`${variable} is not set`);
		this.variable = variable;
		Object.freeze(this);
	}
}

class InvalidCliArgumentsError extends AppError {
	public override readonly name: "InvalidCliArgumentsError" = "InvalidCliArgumentsError";
	public readonly kind: "InvalidCliArguments" = "InvalidCliArguments";
	public readonly code: typeof ERROR_CODES.InvalidCliArguments = ERROR_CODES.InvalidCliArguments;
	public constructor(message: string) {
		super(message);
		Object.freeze(this);
	}
}

class EmptyStringError extends AppError {
	public override readonly name: "EmptyStringError" = "EmptyStringError";
	public readonly kind: "EmptyString" = "EmptyString";
	public readonly code: typeof ERROR_CODES.EmptyString = ERROR_CODES.EmptyString;
	public readonly field: string;
	public constructor(field: string) {
		super(`${field} must be a non-empty string`);
		this.field = field;
		Object.freeze(this);
	}
}

class InvalidUrlError extends AppError {
	public override readonly name: "InvalidUrlError" = "InvalidUrlError";
	public readonly kind: "InvalidUrl" = "InvalidUrl";
	public readonly code: typeof ERROR_CODES.InvalidUrl = ERROR_CODES.InvalidUrl;
	public readonly field: string;
	public readonly value: string;
	public constructor(field: string, value: string) {
		super(`${field} is not a valid URL: ${value}`);
		this.field = field;
		this.value = value;
		Object.freeze(this);
	}
}

class UnexpectedFlagError extends AppError {
	public override readonly name: "UnexpectedFlagError" = "UnexpectedFlagError";
	public readonly kind: "UnexpectedFlag" = "UnexpectedFlag";
	public readonly code: typeof ERROR_CODES.UnexpectedFlag = ERROR_CODES.UnexpectedFlag;
	public readonly expected: string;
	public readonly received: string;
	public constructor(expected: string, received: string) {
		super(`expected the ${expected} flag, got: ${received}`);
		this.expected = expected;
		this.received = received;
		Object.freeze(this);
	}
}

class EmptyChoicesError extends AppError {
	public override readonly name: "EmptyChoicesError" = "EmptyChoicesError";
	public readonly kind: "EmptyChoices" = "EmptyChoices";
	public readonly code: typeof ERROR_CODES.EmptyChoices = ERROR_CODES.EmptyChoices;
	public constructor() {
		super("no choices in response");
		Object.freeze(this);
	}
}

class UnsupportedToolCallTypeError extends AppError {
	public override readonly name: "UnsupportedToolCallTypeError" = "UnsupportedToolCallTypeError";
	public readonly kind: "UnsupportedToolCallType" = "UnsupportedToolCallType";
	public readonly code: typeof ERROR_CODES.UnsupportedToolCallType = ERROR_CODES.UnsupportedToolCallType;
	public readonly callType: string;
	public constructor(callType: string) {
		super(`unsupported tool call type: ${callType}`);
		this.callType = callType;
		Object.freeze(this);
	}
}

class UnknownToolNameError extends AppError {
	public override readonly name: "UnknownToolNameError" = "UnknownToolNameError";
	public readonly kind: "UnknownToolName" = "UnknownToolName";
	public readonly code: typeof ERROR_CODES.UnknownToolName = ERROR_CODES.UnknownToolName;
	public readonly toolName: string;
	public constructor(toolName: string) {
		super(`unknown tool name: ${toolName}`);
		this.toolName = toolName;
		Object.freeze(this);
	}
}

class ToolNotImplementedError extends AppError {
	public override readonly name: "ToolNotImplementedError" = "ToolNotImplementedError";
	public readonly kind: "ToolNotImplemented" = "ToolNotImplemented";
	public readonly code: typeof ERROR_CODES.ToolNotImplemented = ERROR_CODES.ToolNotImplemented;
	public readonly toolName: string;
	public constructor(toolName: string) {
		super(`${toolName} tool not implemented`);
		this.toolName = toolName;
		Object.freeze(this);
	}
}

class MaxIterationsExceededError extends AppError {
	public override readonly name: "MaxIterationsExceededError" = "MaxIterationsExceededError";
	public readonly kind: "MaxIterationsExceeded" = "MaxIterationsExceeded";
	public readonly code: typeof ERROR_CODES.MaxIterationsExceeded = ERROR_CODES.MaxIterationsExceeded;
	public readonly limit: number;
	public constructor(limit: number) {
		super(`agent loop exceeded max iterations: ${limit}`);
		this.limit = limit;
		Object.freeze(this);
	}
}

Object.freeze(ERROR_CODES);

export {
	ERROR_CODES,
	AppError,
	MissingEnvVarError,
	InvalidCliArgumentsError,
	EmptyStringError,
	InvalidUrlError,
	UnexpectedFlagError,
	EmptyChoicesError,
	UnsupportedToolCallTypeError,
	UnknownToolNameError,
	ToolNotImplementedError,
	MaxIterationsExceededError,
};
export type { ErrorCode, ErrorKind };
