// ---------------------------------------------------------------------------
// Type utilities (mirrored from asure.identity.api/src/core/common/TypeUtils)
// ---------------------------------------------------------------------------

type Owned<T> = T & { readonly __owned: unique symbol };

// Treats every primitive (including branded primitives like `string & {brand}`)
// as a leaf — without the explicit `string | number | ...` clause, the
// brand-object portion of `Validated<string, P>` triggers the `object` branch
// and `keyof T` walks the underlying String prototype, destroying the brand +
// template-literal structure. Deviates from the asure.identity.api source by
// adding the primitive clause; the rest of the recursion is identical.
type DeepReadonly<T> =
	T extends Function ? T :
	T extends string | number | bigint | boolean | symbol | null | undefined ? T :
	T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } :
	T;

// ── Compile-time assertions ────────────────────────────────────────
// `type _ = Assert<Equal<A, B>>` errors at typecheck-time when A ≠ B.
type Assert<T extends true> = T;
type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

// ---------------------------------------------------------------------------
// Brand + refinement composition
//
// Each predicate stores itself in a *unique* field (`__brand__${B}`) so that
// multiple refinements compose via intersection without colliding on a shared
// key. `Validated<T, "URL"> & Validated<T, "NonEmpty">` carries both fields
// independently, making a doubly-refined value structurally distinct from
// either single brand. This is the closest TS gets to refinement types.
// ---------------------------------------------------------------------------

// Distributive: when B is a union, the result is a union of individually
// branded types (`(T & brandA) | (T & brandB)`), not a single object carrying
// every brand at once. That keeps `Validated<T, "https">` a subtype of
// `Validated<T, "http" | "https">` after distribution.
type Brand<T, B extends string> = B extends string
	? T & { readonly [K in `__brand__${B}`]: true }
	: never;

type Validated<T, P extends string> = P extends string
	? Brand<T, `validated.${P}`>
	: never;

// Web protocols we accept for URL refinements.
type WebProtocol = "http" | "https";

type NonEmptyString = Validated<string, "NonEmpty">;
type TrimmedString = Validated<string, "Trimmed">;

// URLString is parametric over its protocol. The underlying string is a
// template literal that pins the scheme at the type level. Default to either
// http or https; HTTPSURL nails it down further.
type URLString<TProto extends WebProtocol = WebProtocol> = Validated<
	`${TProto}://${string}`,
	`URL.${TProto}`
>;
type HTTPURL = URLString<"http">;
type HTTPSURL = URLString<"https">;

// Paths use template literals to encode shape at the type level. AbsolutePath
// is guaranteed to start with `/` at compile time when constructed from a
// literal; RelativePath is a runtime-checked brand (TS can't express the
// negative pattern "does not start with /").
type AbsolutePath = Validated<`/${string}`, "AbsolutePath">;
type RelativePath = Validated<string, "RelativePath">;
type FilePath = AbsolutePath | RelativePath;

type ApiKey = Validated<string, "ApiKey">;
type PromptFlag = Validated<"-p", "PromptFlag">;
type ShellCommand = Validated<string, "ShellCommand">;

// Provenance brands for raw, pre-validation inputs. `EnvVar` tags any string
// read from `process.env`; `CliArg` tags any string read from `process.argv`.
// Neither carries a value-shape predicate — they only record *where the
// string came from*, so downstream validators (asApiKey, asURLString, …) can
// accept any branded raw input and produce the final type-level refinement.
type EnvVar = Validated<string, "EnvVar">;
type CliArg = Validated<string, "CliArg">;

// ---------------------------------------------------------------------------
// JSON Schema + Tool definitions
// ---------------------------------------------------------------------------

type JSONSchemaProperty = {
	readonly type:
	| "string"
	| "number"
	| "integer"
	| "boolean"
	| "array"
	| "object"
	| "null";
	readonly description?: string;
	readonly enum?: ReadonlyArray<unknown>;
	readonly items?: JSONSchemaProperty;
	readonly properties?: Readonly<Record<string, JSONSchemaProperty>>;
	readonly required?: ReadonlyArray<string>;
};

type ToolDefinition<TName extends string> = {
	readonly type: "function";
	readonly function: {
		readonly name: TName;
		readonly description: string;
		readonly parameters: {
			readonly type: "object";
			readonly properties: Readonly<Record<string, JSONSchemaProperty>>;
			readonly required: ReadonlyArray<string>;
		};
	};
};

type ToolName = "Read" | "Write" | "Edit" | "Bash";
type Tool = ToolDefinition<ToolName>;

type ReadTool = ToolDefinition<"Read">;
type WriteTool = ToolDefinition<"Write">;
type BashTool = ToolDefinition<"Bash">;

// ---------------------------------------------------------------------------
// Dependent per-tool maps
//
// ToolArgs and ToolResults are keyed by ToolName. Everything downstream
// (handlers, encoders, the parsed call, the dispatcher) is parameterized by
// K extends ToolName, so the static types of `args` and `result` are
// *computed from the value* in `name`. This is TypeScript's tightest
// approximation of dependent typing.
// ---------------------------------------------------------------------------

type ToolArgs = {
	readonly Read: { readonly file_path: string };
	readonly Write: { readonly file_path: string; readonly content: string };
	readonly Edit: {
		readonly file_path: string;
		readonly old_string: string;
		readonly new_string: string;
	};
	readonly Bash: { readonly command: string; readonly timeout?: number };
};

// Each tool's result carries the refined types it produced — `path: FilePath`
// here, not raw `string`, so the brand survives all the way to the encoder
// and can't be replaced with an un-validated string anywhere downstream.
type ToolResults = {
	readonly Read: { readonly contents: string };
	readonly Write: {
		readonly path: FilePath;
		readonly bytesWritten: number;
	};
	readonly Edit: {
		readonly path: FilePath;
		readonly replacements: number;
	};
	readonly Bash: {
		readonly stdout: string;
		readonly stderr: string;
		readonly exitCode: number;
	};
};

// Per-K handler + encoder. The handler returns a strongly-typed ToolResults[K];
// the encoder serializes it to the wire string required by the tool message.
type ToolHandler<K extends ToolName> = (
	args: DeepReadonly<ToolArgs[K]>,
) => Promise<ToolResults[K]>;

type ToolEncoder<K extends ToolName> = (
	result: DeepReadonly<ToolResults[K]>,
) => string;

// Bundle handler + encoder so dispatch can keep both ends of the K binding
// without extra indirection.
type ToolImplementation<K extends ToolName> = {
	readonly handle: ToolHandler<K>;
	readonly encode: ToolEncoder<K>;
};

type ToolImplementations = {
	readonly [K in ToolName]: ToolImplementation<K>;
};

// ---------------------------------------------------------------------------
// Compile-time consistency guards
//
// These error at typecheck if the per-tool maps ever drift from ToolName, or
// if a brand collision happens. Pure type-level — zero JS emitted.
// ---------------------------------------------------------------------------

type _AssertArgsKeys = Assert<Equal<keyof ToolArgs, ToolName>>;
type _AssertResultsKeys = Assert<Equal<keyof ToolResults, ToolName>>;
type _AssertHTTPSIsURL = Assert<
	[HTTPSURL] extends [URLString<WebProtocol>] ? true : false
>;
type _AssertAbsolutePathIsFilePath = Assert<
	[AbsolutePath] extends [FilePath] ? true : false
>;
// Different validators MUST produce non-substitutable types — a NonEmptyString
// must not be assignable to an ApiKey just because they're both branded strings.
type _AssertBrandsDistinct = Assert<
	Equal<NonEmptyString extends ApiKey ? true : false, false>
>;
type _AssertImplementationsKeys = Assert<
	Equal<keyof ToolImplementations, ToolName>
>;

// Sentinel that references every project-wide compile-time invariant. The
// individual `_Assert…` aliases above are load-bearing — their declarations
// run the checks — but they appear "unused" to noUnusedLocals. Unifying them
// here makes each name referenced exactly once at the type level, so
// `--noUnusedLocals` stays happy without changing any runtime behavior.
type _ProjectInvariants =
	| _AssertArgsKeys
	| _AssertResultsKeys
	| _AssertHTTPSIsURL
	| _AssertAbsolutePathIsFilePath
	| _AssertBrandsDistinct
	| _AssertImplementationsKeys;

// ---------------------------------------------------------------------------
// Shell execution types (consumed by common/tools.ts)
// ---------------------------------------------------------------------------

type ExecOutput = Readonly<{ stdout: string; stderr: string }>;

// ---------------------------------------------------------------------------
// Error taxonomy (the runtime ERROR_CODES const + class hierarchy live in
// common/Error.ts; these are the type-level surface that downstream code
// pattern-matches on).
// ---------------------------------------------------------------------------

type ErrorCode =
	| 1001
	| 1002
	| 2001
	| 2002
	| 2003
	| 2004
	| 3001
	| 3002
	| 3003
	| 4001
	| 5001;

type ErrorKind =
	| "MissingEnvVar"
	| "InvalidCliArguments"
	| "EmptyString"
	| "InvalidUrl"
	| "UnexpectedFlag"
	| "InvalidPath"
	| "EmptyChoices"
	| "UnsupportedToolCallType"
	| "UnknownToolName"
	| "ToolNotImplemented"
	| "MaxIterationsExceeded";

// ---------------------------------------------------------------------------
// Tool call responses (subset of ToolDefinition: keeps `name`, drops
// description/parameters, adds `id` + stringified `arguments`)
// ---------------------------------------------------------------------------

type ToolCallResponse<TName extends ToolName = ToolName> = {
	readonly id: string;
	readonly type: "function";
	readonly function: {
		readonly name: TName;
		readonly arguments: string; // JSON-encoded string, parse before use
	};
};

// Raw SDK-shaped function tool call, used by `narrowToolCall` for boundary
// validation before the data has been confirmed as a known ToolName.
type RawFunctionCall = Readonly<{
	readonly id: string;
	readonly type: "function";
	readonly function: Readonly<{
		readonly name: string;
		readonly arguments: string;
	}>;
}>;

// Discriminated union with `name` correlated to `args` via K — the
// per-variant `args` shape is dependent on the literal type of `name`.
type ParsedToolCall = {
	[K in ToolName]: {
		readonly id: string;
		readonly name: K;
		readonly args: ToolArgs[K];
	};
}[ToolName];

// ---------------------------------------------------------------------------
// Conversation primitives
//
// Role is the closed set of speakers. RoleContent is the generic { role,
// content } pair; the message variants below extend it.
// ---------------------------------------------------------------------------

type Role = "user" | "assistant" | "tool";

type RoleContent<TRole extends Role, TContent = string> = {
	readonly role: TRole;
	readonly content: TContent;
};

// ---------------------------------------------------------------------------
// Chat completion response envelope
// ---------------------------------------------------------------------------

type ToolCallMessage =
	RoleContent<"assistant", string | null>
	& Partial<{ readonly tool_calls: ReadonlyArray<ToolCallResponse> }>;

type Choice = {
	readonly index: number;
	readonly message: ToolCallMessage;
	readonly finish_reason: "stop" | "length" | "tool_calls" | "content_filter";
};

type ChatCompletionResponse = {
	readonly choices: ReadonlyArray<Choice>;
};

// What you append to the conversation after running a tool call.
type ToolResultMessage = RoleContent<"tool"> & {
	readonly tool_call_id: string;
};

// ---------------------------------------------------------------------------
// Conversation transcript
// ---------------------------------------------------------------------------

type UserMessage = RoleContent<"user">;
type ConversationMessage = UserMessage | ToolCallMessage | ToolResultMessage;

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export type {
	JSONSchemaProperty,
	ToolDefinition,
	Tool,
	ToolName,
	ReadTool,
	WriteTool,
	BashTool,
	ToolCallResponse,
	ToolArgs,
	ToolResults,
	ToolHandler,
	ToolEncoder,
	ToolImplementation,
	ToolImplementations,
	ParsedToolCall,
	ToolCallMessage,
	ToolResultMessage,
	Choice,
	ChatCompletionResponse,
	DeepReadonly,
	Owned,
	Brand,
	Validated,
	Assert,
	Equal,
	NonEmptyString,
	TrimmedString,
	URLString,
	HTTPURL,
	HTTPSURL,
	WebProtocol,
	AbsolutePath,
	RelativePath,
	FilePath,
	ApiKey,
	PromptFlag,
	ShellCommand,
	EnvVar,
	CliArg,
	UserMessage,
	ConversationMessage,
	Role,
	RoleContent,
	ExecOutput,
	RawFunctionCall,
	ErrorCode,
	ErrorKind,
	_ProjectInvariants,
};
