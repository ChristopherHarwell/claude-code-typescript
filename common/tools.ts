import { readFile, writeFile } from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { Buffer } from "node:buffer";
import type {
	BashTool,
	ChatCompletionResponse,
	DeepReadonly,
	ExecOutput,
	FilePath,
	JSONSchemaProperty,
	Owned,
	ParsedToolCall,
	RawFunctionCall,
	ReadTool,
	ShellCommand,
	Tool,
	ToolArgs,
	ToolCallResponse,
	ToolDefinition,
	ToolImplementation,
	ToolImplementations,
	ToolName,
	ToolResultMessage,
	ToolResults,
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

// ── Shell execution ───────────────────────────────────────────────
// Promise-based wrapper around child_process.exec. Captures stdout + stderr
// and resolves with a structured ToolResults["Bash"] in both success and
// failure paths — the encoder decides how to render it on the wire.

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
): Promise<ToolResults["Bash"]> {
	try {
		const result: ExecOutput = await execAsync(command, {
			encoding: "utf8",
			timeout,
		});
		return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
	} catch (err: unknown) {
		if (err !== null && typeof err === "object") {
			const e: Readonly<{
				readonly stdout?: unknown;
				readonly stderr?: unknown;
				readonly code?: unknown;
			}> = err as Readonly<{
				readonly stdout?: unknown;
				readonly stderr?: unknown;
				readonly code?: unknown;
			}>;
			const stdout: string = typeof e.stdout === "string" ? e.stdout : "";
			const stderr: string = typeof e.stderr === "string" ? e.stderr : "";
			const exitCode: number = typeof e.code === "number" ? e.code : 1;
			return { stdout, stderr, exitCode };
		}
		return { stdout: "", stderr: String(err), exitCode: 1 };
	}
}

// ── Tool registry ─────────────────────────────────────────────────

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

// ── Tool implementations (handler + encoder per tool) ──────────────
// Each entry is a ToolImplementation<K>: a strongly-typed handler that
// returns ToolResults[K], paired with an encoder that serializes that result
// to the string the API requires on the wire. K is the dependent binding —
// the handler/encoder pair for "Read" only ever sees ToolArgs["Read"] /
// ToolResults["Read"], and so on.

const readImpl: ToolImplementation<"Read"> = {
	handle: async (
		args: DeepReadonly<ToolArgs["Read"]>,
	): Promise<ToolResults["Read"]> => {
		const path: FilePath = asFilePath(args.file_path, "Read.file_path");
		const contents: string = await readFile(path, "utf8");
		return deepFreeze<ToolResults["Read"]>({ contents });
	},
	encode: (result: DeepReadonly<ToolResults["Read"]>): string => result.contents,
};

const writeImpl: ToolImplementation<"Write"> = {
	handle: async (
		args: DeepReadonly<ToolArgs["Write"]>,
	): Promise<ToolResults["Write"]> => {
		const path: FilePath = asFilePath(args.file_path, "Write.file_path");
		await writeFile(path, args.content, "utf8");
		return deepFreeze<ToolResults["Write"]>({
			path,
			bytesWritten: Buffer.byteLength(args.content, "utf8"),
		});
	},
	encode: (result: DeepReadonly<ToolResults["Write"]>): string =>
		`File written successfully: ${result.path} (${result.bytesWritten} bytes)`,
};

const editImpl: ToolImplementation<"Edit"> = {
	handle: async (
		_args: DeepReadonly<ToolArgs["Edit"]>,
	): Promise<ToolResults["Edit"]> => {
		throw new ToolNotImplementedError("Edit");
	},
	encode: (result: DeepReadonly<ToolResults["Edit"]>): string =>
		`Edit applied: ${result.replacements} replacement(s) in ${result.path}`,
};

const bashImpl: ToolImplementation<"Bash"> = {
	handle: async (
		args: DeepReadonly<ToolArgs["Bash"]>,
	): Promise<ToolResults["Bash"]> => {
		const command: ShellCommand = asShellCommand(args.command, "Bash.command");
		return runShellCommand(command, args.timeout);
	},
	encode: (result: DeepReadonly<ToolResults["Bash"]>): string => {
		const captured: string = `${result.stdout}${result.stderr}`;
		if (result.exitCode === 0) {
			return captured;
		}
		return `${captured}${captured.length > 0 ? "\n" : ""}Error: command exited with code ${result.exitCode}`;
	},
};

const implementations: DeepReadonly<Owned<ToolImplementations>> = deepFreeze<
	ToolImplementations
>({
	Read: readImpl,
	Write: writeImpl,
	Edit: editImpl,
	Bash: bashImpl,
});

// `_AssertImplementationsKeys` (in types.ts) verifies at typecheck that the
// registry covers exactly ToolName.

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
// so `impls[name].handle(args)` and `impls[name].encode(result)` type-check
// instead of hitting the union-of-functions problem you'd get on the parsed
// discriminated union directly. This is the load-bearing dependent-type call.
function _invoke<K extends ToolName>(
	impls: DeepReadonly<ToolImplementations>,
	name: K,
	args: DeepReadonly<ToolArgs[K]>,
): Promise<string> {
	const impl: DeepReadonly<ToolImplementation<K>> = impls[name];
	return impl
		.handle(args)
		.then((result: ToolResults[K]): string =>
			impl.encode(result as DeepReadonly<ToolResults[K]>),
		);
}

// Parse one tool call's arguments and dispatch to its implementation+encoder.
async function executeToolCall(
	call: DeepReadonly<ToolCallResponse>,
	impls: DeepReadonly<ToolImplementations>,
): Promise<string> {
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
			async (
				call: DeepReadonly<ToolCallResponse>,
			): Promise<ToolResultMessage> =>
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
