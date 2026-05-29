import type {
	ReadTool,
	ToolName,
	ToolArgs,
	ToolCallResponse,
	ChatCompletionResponse,
	ToolImplementations,
	ParsedToolCall,
	ToolResultMessage,
} from "./types";

const readTool: ReadTool = {
	"type": "function",
	"function": {
		"name": "Read",
		"description": "Read and return the contents of a file",
		"parameters": {
			"type": "object",
			"properties": {
				"file_path": {
					"type": "string",
					"description": "The path to the file to read"
				}
			},
			"required": ["file_path"]
		}
	}
} as const;

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

/**
 * Parse a tool call's stringified arguments into a typed, discriminated result.
 *
 * NOTE: the `as` is an unchecked cast — JSON.parse returns `any`, so this trusts
 * the wire data matches ToolArgs[name]. For runtime validation, swap ToolArgs
 * for a zod (or similar) schema map and validate instead of casting.
 */
function parseToolCall(call: ToolCallResponse): ParsedToolCall {
	return {
		id: call.id,
		name: call.function.name,
		args: JSON.parse(call.function.arguments),
	} as ParsedToolCall;
}

// Generic indirection that keeps `name` and `args` correlated to the same K,
// so `impls[name](args)` type-checks instead of hitting the union-of-functions
// problem you'd get calling it directly on the discriminated union.
function _invoke<K extends ToolName>(
	impls: ToolImplementations,
	name: K,
	args: ToolArgs[K],
): string | Promise<string> {
	return impls[name](args);
}

// Parse one tool call's arguments and dispatch to its implementation.
function executeToolCall(
	call: ToolCallResponse,
	implementations: ToolImplementations,
): string | Promise<string> {
	const parsed = parseToolCall(call);
	return _invoke(implementations, parsed.name, parsed.args);
}

// Handle a full response: run every tool call in the single choice and return
// one tool-result message per call, ready to send back to the model.
async function handleResponse(
	response: ChatCompletionResponse,
	implementations: ToolImplementations,
): Promise<ToolResultMessage[]> {
	const toolCalls = response.choices[0]?.message.tool_calls ?? [];
	return Promise.all(
		toolCalls.map(async (call) => ({
			role: "tool" as const,
			tool_call_id: call.id,
			content: await executeToolCall(call, implementations),
		})),
	);
}

export { readTool, executeToolCall, handleResponse, parseToolCall };
