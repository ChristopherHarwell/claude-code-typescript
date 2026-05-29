// ---------------------------------------------------------------------------
// Type utilities (mirrored from asure.identity.api/src/core/common/TypeUtils)
// ---------------------------------------------------------------------------

type Owned<T> = T & { readonly __owned: unique symbol };

type DeepReadonly<T> =
	T extends Function ? T :
	T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } :
	T;

// ---------------------------------------------------------------------------
// Refinement / branded types
//
// Brand<T, B> tags a primitive so it can only be produced by a validator
// (see common/refinements.ts) — preventing arbitrary `string` from flowing
// into positions that demand a validated shape.
// ---------------------------------------------------------------------------

type Brand<T, B extends string> = T & { readonly __brand: B };

type NonEmptyString = Brand<string, "NonEmptyString">;
type URLString = Brand<string, "URLString">;
type ApiKey = Brand<string, "ApiKey">;
type PromptFlag = Brand<"-p", "PromptFlag">;
type FilePath = Brand<string, "FilePath">;

// ---------------------------------------------------------------------------
// JSON Schema + Tool definitions (original)
// ---------------------------------------------------------------------------

type JSONSchemaProperty = {
	type: "string" | "number" | "integer" | "boolean" | "array" | "object" | "null";
	description?: string;
	enum?: readonly unknown[];
	items?: JSONSchemaProperty;
	properties?: Record<string, JSONSchemaProperty>;
	required?: readonly string[];
};

type ToolDefinition<TName extends string> = {
	type: "function";
	function: {
		name: TName;
		description: string;
		parameters: {
			type: "object";
			properties: Record<string, JSONSchemaProperty>;
			required: readonly string[];
		};
	};
};

type ToolName = "Read" | "Write" | "Edit" | "Bash";
type Tool = ToolDefinition<ToolName>;


type ReadTool = ToolDefinition<"Read">;
type WriteTool = ToolDefinition<"Write">;

// ---------------------------------------------------------------------------
// Tool call responses (subset of ToolDefinition: keeps `name`, drops
// description/parameters, adds `id` + stringified `arguments`)
// ---------------------------------------------------------------------------

type ToolCallResponse<TName extends ToolName = ToolName> = {
	id: string;
	type: "function";
	function: {
		name: TName;
		arguments: string; // JSON-encoded string, parse before use
	};
};

// ---------------------------------------------------------------------------
// Per-tool argument shapes
// ---------------------------------------------------------------------------

// Source of truth for parsed argument shapes, one entry per ToolName.
type ToolArgs = {
	Read: { file_path: string };
	Write: { file_path: string; content: string };
	Edit: { file_path: string; old_string: string; new_string: string };
	Bash: { command: string; timeout?: number };
};

// Zero-runtime guard: this errors if ToolArgs ever drifts from ToolName
// (add a tool to the union, forget it here, get a compile error).
type _Assert<T extends true> = T;
type _ToolArgsComplete = _Assert<
	[Exclude<ToolName, keyof ToolArgs>] extends [never] ? true : false
>;

// Discriminated union keyed on `name` so `args` stays correlated to the tool.
type ParsedToolCall = {
	[K in ToolName]: {
		id: string;
		name: K;
		args: ToolArgs[K];
	};
}[ToolName];



// ---------------------------------------------------------------------------
// Conversation primitives
//
// Role is the closed set of speakers in the transcript. RoleContent is the
// generic { role, content } pair shared by every message; the variants below
// extend it with extras (`tool_calls`, `tool_call_id`) and pick content types.
// ---------------------------------------------------------------------------

type Role = "user" | "assistant" | "tool";

type RoleContent<TRole extends Role, TContent = string> = {
	readonly role: TRole;
	readonly content: TContent;
};

// ---------------------------------------------------------------------------
// Chat completion response envelope
// ---------------------------------------------------------------------------

// Assistant content is `string | null` (null when the message is *only* tool
// calls). `tool_calls` is wrapped in Partial so it can be omitted entirely on
// terminal assistant messages.
type ToolCallMessage =
	RoleContent<"assistant", string | null>
	& Partial<{ readonly tool_calls: ReadonlyArray<ToolCallResponse> }>;

type Choice = {
	index: number;
	message: ToolCallMessage;
	finish_reason: "stop" | "length" | "tool_calls" | "content_filter";
};

type ChatCompletionResponse = {
	choices: Choice[];
};

// The contract you implement: one handler per tool, each receiving args typed
// to that specific tool and returning the result as a string (sync or async).
type ToolImplementations = {
	[K in ToolName]: (args: ToolArgs[K]) => string | Promise<string>;
};

// What you append to the conversation after running a tool call. Extends the
// shared { role, content } base with the id linking it to the assistant's call.
type ToolResultMessage = RoleContent<"tool"> & {
	readonly tool_call_id: string;
};

// ---------------------------------------------------------------------------
// Conversation transcript
// ---------------------------------------------------------------------------

// The initial user prompt at the head of the conversation — just the base.
type UserMessage = RoleContent<"user">;

// Discriminated union of every message that can appear in the transcript the
// agent loop sends back to the model. `role` is the discriminant.
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
	ToolCallResponse,
	ToolArgs,
	ParsedToolCall,
	ToolCallMessage,
	ToolImplementations,
	ToolResultMessage,
	Choice,
	ChatCompletionResponse,
	DeepReadonly,
	Owned,
	Brand,
	NonEmptyString,
	URLString,
	ApiKey,
	PromptFlag,
	FilePath,
	UserMessage,
	ConversationMessage,
	Role,
	RoleContent,
};
