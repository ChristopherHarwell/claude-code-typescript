import OpenAI from "openai";
import type {
  ApiKey,
  ChatCompletionResponse,
  Choice,
  ConversationMessage,
  DeepReadonly,
  HTTPSURL,
  NonEmptyString,
  Owned,
  ParsedToolCall,
  PromptFlag,
  ToolCallMessage,
  ToolCallResponse,
  ToolResultMessage,
  UserMessage,
} from "../common/types";
import {
  READ_FILE_PATH_SCHEMA,
  TOOLS,
  executeToolCall,
  handleResponse,
  implementations,
  narrowToolCall,
  parseToolCall,
} from "../common/tools";
import { deepFreeze } from "../common/deepFreeze";
import {
  asApiKey,
  asHTTPSURL,
  asNonEmptyString,
  asPromptFlag,
} from "../common/refinements";
import {
  EmptyChoicesError,
  InvalidCliArgumentsError,
  MaxIterationsExceededError,
  MissingEnvVarError,
} from "../common/Error";

// ── Agent loop ────────────────────────────────────────────────────

const MODEL_ID: NonEmptyString = "anthropic/claude-haiku-4.5" as NonEmptyString;
const MAX_ITERATIONS: number = 50;

// One iteration: send the transcript, append the assistant reply, dispatch any
// tool calls, append their results, and recurse with a fresh frozen transcript.
// No mutable binding crosses an iteration boundary.
async function step(
  client: OpenAI,
  messages: DeepReadonly<Owned<ReadonlyArray<ConversationMessage>>>,
  iteration: number,
): Promise<void> {
  if (iteration >= MAX_ITERATIONS) {
    throw new MaxIterationsExceededError(MAX_ITERATIONS);
  }

  const sdkResponse: OpenAI.Chat.Completions.ChatCompletion =
    await client.chat.completions.create({
      model: MODEL_ID,
      messages: [
        ...messages,
      ] as unknown as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      tools: TOOLS as unknown as OpenAI.Chat.Completions.ChatCompletionTool[],
    });

  const response: ChatCompletionResponse =
    sdkResponse as unknown as ChatCompletionResponse;

  if (!response.choices || response.choices.length === 0) {
    throw new EmptyChoicesError();
  }

  const choice: Choice = response.choices[0];
  const assistantMessage: ToolCallMessage = choice.message;
  const calls: DeepReadonly<Owned<ReadonlyArray<ToolCallResponse>>> =
    deepFreeze<ReadonlyArray<ToolCallResponse>>([
      ...(assistantMessage.tool_calls ?? []),
    ]);

  // Terminal step: model produced a final assistant message with no tool calls.
  if (calls.length === 0) {
    console.log(assistantMessage.content);
    return;
  }

  // Dispatch every tool call and build the corresponding tool-result messages.
  // Single-call path uses executeToolCall + parseToolCall directly (also
  // exercises narrowToolCall and READ_FILE_PATH_SCHEMA for visibility).
  // Multi-call path delegates to handleResponse, which fans out internally.
  const toolResults: DeepReadonly<Owned<ReadonlyArray<ToolResultMessage>>> =
    calls.length === 1
      ? await runSingleCall(calls[0])
      : await handleResponse(response, implementations);

  return step(
    client,
    deepFreeze<ReadonlyArray<ConversationMessage>>([
      ...messages,
      assistantMessage,
      ...toolResults,
    ]),
    iteration + 1,
  );
}

async function runSingleCall(
  call: DeepReadonly<ToolCallResponse>,
): Promise<DeepReadonly<Owned<ReadonlyArray<ToolResultMessage>>>> {
  const narrowed: DeepReadonly<Owned<ToolCallResponse>> = narrowToolCall(call);
  const parsed: DeepReadonly<Owned<ParsedToolCall>> = parseToolCall(narrowed);
  console.error(
    `[tool] ${parsed.name}(${JSON.stringify(parsed.args)}) — file_path schema: ${READ_FILE_PATH_SCHEMA.type}`,
  );
  const content: string = await executeToolCall(narrowed, implementations);
  return deepFreeze<ReadonlyArray<ToolResultMessage>>([
    deepFreeze<ToolResultMessage>({
      role: "tool",
      tool_call_id: narrowed.id,
      content,
    }),
  ]);
}

// ── Entrypoint ────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Clone process.argv before freezing so we never reach into the live, mutable
  // host array; from here on the snapshot is immutable.
  const argv: DeepReadonly<Owned<ReadonlyArray<string>>> = deepFreeze<
    ReadonlyArray<string>
  >([...process.argv]);
  const rawFlag: string | undefined = argv[2];
  const rawPrompt: string | undefined = argv[3];
  const rawApiKey: string | undefined = process.env.OPENROUTER_API_KEY;
  const rawBaseURL: string =
    process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";

  if (rawApiKey === undefined) {
    throw new MissingEnvVarError("OPENROUTER_API_KEY");
  }
  if (rawFlag === undefined || rawPrompt === undefined) {
    throw new InvalidCliArgumentsError("error: -p flag is required");
  }

  const apiKey: ApiKey = asApiKey(rawApiKey, "OPENROUTER_API_KEY");
  const baseURL: HTTPSURL = asHTTPSURL(rawBaseURL, "OPENROUTER_BASE_URL");
  const flag: PromptFlag = asPromptFlag(rawFlag);
  const prompt: NonEmptyString = asNonEmptyString(rawPrompt, "prompt");
  void flag; // -p is validated, then discarded — only `prompt` is used downstream.

  const client: OpenAI = new OpenAI({ apiKey, baseURL });

  const initial: DeepReadonly<Owned<ReadonlyArray<ConversationMessage>>> =
    deepFreeze<ReadonlyArray<ConversationMessage>>([
      deepFreeze<UserMessage>({ role: "user", content: prompt }),
    ]);

  await step(client, initial, 0);
}

main();
