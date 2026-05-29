// ---------------------------------------------------------------------------
// Type utilities (mirrored from asure.identity.api/src/core/common/TypeUtils)
// ---------------------------------------------------------------------------

type Owned<T> = T & { readonly __owned: unique symbol };

type DeepReadonly<T> =
	T extends Function ? T :
	T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } :
	T;

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
// Chat completion response envelope
// ---------------------------------------------------------------------------

type ToolCallMessage = {
	role: "assistant";
	content: string | null;
	tool_calls?: ToolCallResponse[];
};

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

// What you append to the conversation after running a tool call.
type ToolResultMessage = {
	role: "tool";
	tool_call_id: string;
	content: string;
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export type {
	JSONSchemaProperty,
	ToolDefinition,
	Tool,
	ToolName,
	ReadTool,
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
};
