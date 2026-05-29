import { readFile } from "node:fs/promises";
import OpenAI from "openai";
import type {
  DeepReadonly,
  Owned,
  ToolArgs,
  ToolCallResponse,
  ToolImplementations,
  ToolName,
} from "../common/types";
import { executeToolCall, readTool } from "../common/tools";
import { deepFreeze } from "../common/deepFreeze";

// ── Tool implementations ──────────────────────────────────────────
// Deeply frozen at module load so no caller can swap or mutate a handler.

const implementations: DeepReadonly<Owned<ToolImplementations>> = deepFreeze<ToolImplementations>({
  Read: async (args: Readonly<ToolArgs["Read"]>): Promise<string> =>
    readFile(args.file_path, "utf8"),
  Write: async (_args: Readonly<ToolArgs["Write"]>): Promise<string> => {
    throw new Error("Write tool not implemented");
  },
  Edit: async (_args: Readonly<ToolArgs["Edit"]>): Promise<string> => {
    throw new Error("Edit tool not implemented");
  },
  Bash: async (_args: Readonly<ToolArgs["Bash"]>): Promise<string> => {
    throw new Error("Bash tool not implemented");
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

type FunctionToolCall = Readonly<{
  readonly id: string;
  readonly type: "function";
  readonly function: Readonly<{ readonly name: string; readonly arguments: string }>;
}>;

function hasFunctionField(
  call: Readonly<{ readonly type: string }>,
): call is FunctionToolCall {
  return call.type === "function" && "function" in call;
}

function toToolCallResponse(
  call: Readonly<{ readonly type: string }>,
): DeepReadonly<Owned<ToolCallResponse>> {
  if (!hasFunctionField(call)) {
    throw new Error(`unsupported tool call type: ${call.type}`);
  }
  if (!isToolName(call.function.name)) {
    throw new Error(`unknown tool name: ${call.function.name}`);
  }
  return deepFreeze<ToolCallResponse>({
    id: call.id,
    type: "function",
    function: {
      name: call.function.name,
      arguments: call.function.arguments,
    },
  });
}

// ── Entrypoint ────────────────────────────────────────────────────

async function main(): Promise<void> {
  const argv: ReadonlyArray<string> = process.argv;
  const flag: string | undefined = argv[2];
  const prompt: string | undefined = argv[3];
  const apiKey: string | undefined = process.env.OPENROUTER_API_KEY;
  const baseURL: string =
    process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }
  if (flag !== "-p" || !prompt) {
    throw new Error("error: -p flag is required");
  }

  const client: OpenAI = new OpenAI({ apiKey, baseURL });

  const response = await client.chat.completions.create({
    model: "anthropic/claude-haiku-4.5",
    messages: [{ role: "user", content: prompt }],
    tools: [readTool],
  });

  if (!response.choices || response.choices.length === 0) {
    throw new Error("no choices in response");
  }

  const message = response.choices[0].message;
  const rawCall = message.tool_calls?.[0];

  if (!rawCall) {
    console.log(message.content);
    return;
  }

  const toolCall: DeepReadonly<Owned<ToolCallResponse>> = toToolCallResponse(rawCall);
  const result: string = await executeToolCall(toolCall, implementations);
  process.stdout.write(result);
}

main();
