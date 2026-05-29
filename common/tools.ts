import { readFile, writeFile } from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import type {
	BashTool,
	ChatCompletionResponse,
	DeepReadonly,
	FilePath,
	JSONSchemaProperty,
	Owned,
	ParsedToolCall,
	ReadTool,
	ShellCommand,
	Tool,
	ToolArgs,
	ToolCallResponse,
	ToolDefinition,
	ToolImplementations,
	ToolName,
	ToolResultMessage,
	WriteTool,
} from "./types";
import { deepFreeze } from "./deepFreeze";
import { asFilePath, asShellCommand } from "./refinements";
import {
	ToolNotImplementedError,
	UnknownToolNameError,
	UnsupportedToolCallTypeError,
} from "./Error";

// ── Tool definitions ──────────────────────────────────────────────

const readTool: ReadTool = deepFreeze<ReadTool>({
	type: "function",
	function: {
		name: "Read",
		description: "Read and return the contents of a file",
		parameters: {
			type: "object",
			properties: {
				file_path: {
					type: "string",
					description: "The path to the file to read",
				},
			},
			required: ["file_path"],
		},
	},
});

const writeTool: WriteTool = deepFreeze<WriteTool>({
	type: "function",
	function: {
		name: "Write",
		description: "Write content to a file",
		parameters: {
			type: "object",
			properties: {
				file_path: {
					type: "string",
					description: "The path of the file to write to",
				},
				content: {
					type: "string",
					description: "The content to write to the file",
				},
			},
			required: ["file_path", "content"],
		},
	},
});

// ── Shell execution ───────────────────────────────────────────────
// Promise-based wrapper around child_process.exec. Captures stdout + stderr
// and, on non-zero exit, returns whatever the command printed plus an error
// line so the model can see the failure context instead of just throwing.

type ExecOutput = Readonly<{ stdout: string; stderr: string }>;
const execAsync: (
	cmd: string,
	opts: Readonly<{ encoding: "utf8"; timeout?: number }>,
) => Promise<ExecOutput> = promisify(exec) as unknown as (
	cmd: string,
	opts: Readonly<{ encoding: "utf8"; timeout?: number }>,
) => Promise<ExecOutput>;

async function runShellCommand(
	command: ShellCommand,
	timeout: number | undefined,
): Promise<string> {
	try {
		const result: ExecOutput = await execAsync(command, {
			encoding: "utf8",
			timeout,
		});
		return `${result.stdout}${result.stderr}`;
	} catch (err: unknown) {
		if (err !== null && typeof err === "object") {
			const e: Readonly<{
				readonly stdout?: unknown;
				readonly stderr?: unknown;
				readonly message?: unknown;
			}> = err as Readonly<{
				readonly stdout?: unknown;
				readonly stderr?: unknown;
				readonly message?: unknown;
			}>;
			const out: string = typeof e.stdout === "string" ? e.stdout : "";
			const errOut: string = typeof e.stderr === "string" ? e.stderr : "";
			const msg: string =
				typeof e.message === "string" ? e.message : "command failed";
			const captured: string = `${out}${errOut}`;
			return `${captured}${captured.length > 0 ? "\n" : ""}Error: ${msg}`;
		}
		return `Error: ${String(err)}`;
	}
}

const bashTool: BashTool = deepFreeze<BashTool>({
	type: "function",
	function: {
		name: "Bash",
		description: "Execute a shell command",
		parameters: {
			type: "object",
			properties: {
				command: {
					type: "string",
					description: "The command to execute",
				},
			},
			required: ["command"],
		},
	},
});

// ── Tool registry ─────────────────────────────────────────────────
// Identity helper that re-binds a ToolDefinition with a tighter generic so
// every registered tool carries its name in its type. Frozen at module load.

function asToolDef<TName extends ToolName>(
	def: ToolDefinition<TName>,
): ToolDefinition<TName> {
	return def;
}

const READ_TOOL: ReadTool = asToolDef<"Read">(readTool);
const WRITE_TOOL: WriteTool = asToolDef<"Write">(writeTool);
const BASH_TOOL: BashTool = asToolDef<"Bash">(bashTool);

const READ_FILE_PATH_SCHEMA: JSONSchemaProperty =
	READ_TOOL.function.parameters.properties.file_path;

const TOOLS: DeepReadonly<Owned<ReadonlyArray<Tool>>> = deepFreeze<Tool[]>([
	READ_TOOL,
	WRITE_TOOL,
	BASH_TOOL,
]);

// ── Tool implementations ──────────────────────────────────────────
// Deeply frozen at module load so no caller can swap or mutate a handler.

const implementations: DeepReadonly<Owned<ToolImplementations>> =
	deepFreeze<ToolImplementations>({
		Read: async (args: Readonly<ToolArgs["Read"]>): Promise<string> => {
			const path: FilePath = asFilePath(args.file_path, "Read.file_path");
			return readFile(path, "utf8");
		},
		Write: async (args: Readonly<ToolArgs["Write"]>): Promise<string> => {
			const path: FilePath = asFilePath(args.file_path, "Write.file_path");
			await writeFile(path, args.content, "utf8");
			return `File written successfully: ${path}`;
		},
		Edit: async (_args: Readonly<ToolArgs["Edit"]>): Promise<string> => {
			throw new ToolNotImplementedError("Edit");
		},
		Bash: async (args: Readonly<ToolArgs["Bash"]>): Promise<string> => {
			const command: ShellCommand = asShellCommand(args.command, "Bash.command");
			return runShellCommand(command, args.timeout);
		},
	});

// ── Boundary narrowing ────────────────────────────────────────────
// The OpenAI SDK types `function.name` as `string` and the tool-call union
// may include non-function variants. Narrow at the boundary; fail loud on
// anything unexpected instead of asserting blindly downstream.

const TOOL_NAMES: DeepReadonly<Owned<ReadonlySet<ToolName>>> = deepFreeze(
	new Set<ToolName>(["Read", "Write", "Edit", "Bash"]),
);

function isToolName(name: string): name is ToolName {
	return TOOL_NAMES.has(name as ToolName);
}

type RawFunctionCall = Readonly<{
	readonly id: string;
	readonly type: "function";
	readonly function: Readonly<{
		readonly name: string;
		readonly arguments: string;
	}>;
}>;

function narrowToolCall(
	call: Readonly<{ readonly type: string }>,
): DeepReadonly<Owned<ToolCallResponse>> {
	if (call.type !== "function" || !("function" in call)) {
		throw new UnsupportedToolCallTypeError(call.type);
	}
	const fnCall: RawFunctionCall = call as RawFunctionCall;
	if (!isToolName(fnCall.function.name)) {
		throw new UnknownToolNameError(fnCall.function.name);
	}
	return deepFreeze<ToolCallResponse>({
		id: fnCall.id,
		type: "function",
		function: {
			name: fnCall.function.name,
			arguments: fnCall.function.arguments,
		},
	});
}

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
function parseToolCall(
	call: DeepReadonly<ToolCallResponse>,
): DeepReadonly<Owned<ParsedToolCall>> {
	return deepFreeze<ParsedToolCall>({
		id: call.id,
		name: call.function.name,
		args: JSON.parse(call.function.arguments),
	} as ParsedToolCall);
}

// Generic indirection that keeps `name` and `args` correlated to the same K,
// so `impls[name](args)` type-checks instead of hitting the union-of-functions
// problem you'd get calling it directly on the discriminated union.
function _invoke<K extends ToolName>(
	impls: DeepReadonly<ToolImplementations>,
	name: K,
	args: DeepReadonly<ToolArgs[K]>,
): string | Promise<string> {
	return impls[name](args as ToolArgs[K]);
}

// Parse one tool call's arguments and dispatch to its implementation.
function executeToolCall(
	call: DeepReadonly<ToolCallResponse>,
	impls: DeepReadonly<ToolImplementations>,
): string | Promise<string> {
	const parsed: DeepReadonly<Owned<ParsedToolCall>> = parseToolCall(call);
	return _invoke(impls, parsed.name, parsed.args);
}

// Handle a full response: run every tool call in the single choice and return
// one tool-result message per call, ready to send back to the model.
async function handleResponse(
	response: DeepReadonly<ChatCompletionResponse>,
	impls: DeepReadonly<ToolImplementations>,
): Promise<DeepReadonly<Owned<ReadonlyArray<ToolResultMessage>>>> {
	const toolCalls: ReadonlyArray<DeepReadonly<ToolCallResponse>> =
		response.choices[0]?.message.tool_calls ?? [];
	const results: ReadonlyArray<ToolResultMessage> = await Promise.all(
		toolCalls.map(
			async (call: DeepReadonly<ToolCallResponse>): Promise<ToolResultMessage> =>
				deepFreeze<ToolResultMessage>({
					role: "tool" as const,
					tool_call_id: call.id,
					content: await executeToolCall(call, impls),
				}),
		),
	);
	return deepFreeze<ReadonlyArray<ToolResultMessage>>(results);
}

export {
	readTool,
	writeTool,
	bashTool,
	READ_TOOL,
	WRITE_TOOL,
	BASH_TOOL,
	READ_FILE_PATH_SCHEMA,
	TOOLS,
	implementations,
	TOOL_NAMES,
	isToolName,
	narrowToolCall,
	executeToolCall,
	handleResponse,
	parseToolCall,
	asToolDef,
};
