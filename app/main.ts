import OpenAI from "openai";
import type {
  ApiKey,
  ChatCompletionResponse,
  Choice,
  DeepReadonly,
  NonEmptyString,
  Owned,
  ParsedToolCall,
  PromptFlag,
  ToolCallMessage,
  ToolCallResponse,
  ToolResultMessage,
  URLString,
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
  asNonEmptyString,
  asPromptFlag,
  asURLString,
} from "../common/refinements";
import {
  EmptyChoicesError,
  InvalidCliArgumentsError,
  MissingEnvVarError,
} from "../common/Error";

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

  // Refine every external string before it crosses into the program.
  const apiKey: ApiKey = asApiKey(rawApiKey, "OPENROUTER_API_KEY");
  const baseURL: URLString = asURLString(rawBaseURL, "OPENROUTER_BASE_URL");
  const flag: PromptFlag = asPromptFlag(rawFlag);
  const prompt: NonEmptyString = asNonEmptyString(rawPrompt, "prompt");
  void flag; // -p is validated, then discarded — only `prompt` is used downstream.

  const client: OpenAI = new OpenAI({ apiKey, baseURL });

  const sdkResponse: OpenAI.Chat.Completions.ChatCompletion =
    await client.chat.completions.create({
      model: "anthropic/claude-haiku-4.5",
      messages: [{ role: "user", content: prompt }],
      tools: TOOLS as unknown as OpenAI.Chat.Completions.ChatCompletionTool[],
    });

  const response: ChatCompletionResponse =
    sdkResponse as unknown as ChatCompletionResponse;

  if (!response.choices || response.choices.length === 0) {
    throw new EmptyChoicesError();
  }

  const choice: Choice = response.choices[0];
  const message: ToolCallMessage = choice.message;
  const rawCalls: DeepReadonly<Owned<ReadonlyArray<ToolCallResponse>>> =
    deepFreeze<ReadonlyArray<ToolCallResponse>>([
      ...(message.tool_calls ?? []),
    ]);

  if (rawCalls.length === 0) {
    console.log(message.content);
    return;
  }

  // Always log the first call as a typed, parsed view (uses parseToolCall +
  // ParsedToolCall + the JSONSchemaProperty for the matching param).
  const firstCall: DeepReadonly<Owned<ToolCallResponse>> = narrowToolCall(
    rawCalls[0],
  );
  const parsed: DeepReadonly<Owned<ParsedToolCall>> = parseToolCall(firstCall);
  console.error(
    `[tool] ${parsed.name}(${JSON.stringify(parsed.args)}) — file_path schema: ${READ_FILE_PATH_SCHEMA.type}`,
  );

  // Single-call path: execute one tool directly.
  // Multi-call path: dispatch every call via handleResponse → ToolResultMessage[].
  if (rawCalls.length === 1) {
    const result: string = await executeToolCall(firstCall, implementations);
    process.stdout.write(result);
    return;
  }

  const results: DeepReadonly<Owned<ReadonlyArray<ToolResultMessage>>> =
    await handleResponse(response, implementations);
  for (const r of results) {
    process.stdout.write(r.content);
  }
}

main();
