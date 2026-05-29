import OpenAI from "openai";
import type {
  ApiKey,
  CliArg,
  DeepReadonly,
  EnvVar,
  HTTPSURL,
  HTTPURL,
  NonEmptyString,
  Owned,
  PromptFlag,
} from "../common/types";
import { deepFreeze } from "../common/deepFreeze";
import {
  asApiKey,
  asCliArg,
  asEnvVar,
  asNonEmptyString,
  asPromptFlag,
  asURLString,
} from "../common/refinements";
import {
  InvalidCliArgumentsError,
  MissingEnvVarError,
} from "../common/Error";
import { runAgentLoop } from "../common/loop";
import { DEFAULT_BASE_URL } from "../common/constants";

// ── Entrypoint ────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Clone process.argv before freezing so we never reach into the live, mutable
  // host array; from here on the snapshot is immutable.
  const argv: DeepReadonly<Owned<ReadonlyArray<string>>> = deepFreeze<
    ReadonlyArray<string>
  >([...process.argv]);
  // Tag every raw input with its source so the type carries provenance:
  // `CliArg` for anything off process.argv, `EnvVar` for anything off
  // process.env. The downstream refinement constructors (asApiKey, asURLString,
  // …) accept either brand (both extend `string`) and produce the final
  // value-shape refinement on top.
  const rawFlag: CliArg | undefined = asCliArg(argv[2]);
  const rawPrompt: CliArg | undefined = asCliArg(argv[3]);
  const rawApiKey: EnvVar | undefined = asEnvVar(process.env.OPENROUTER_API_KEY);
  const rawBaseURL: EnvVar | NonEmptyString =
    asEnvVar(process.env.OPENROUTER_BASE_URL) ?? DEFAULT_BASE_URL;

  if (rawApiKey === undefined) {
    throw new MissingEnvVarError("OPENROUTER_API_KEY");
  }
  if (rawFlag === undefined || rawPrompt === undefined) {
    throw new InvalidCliArgumentsError("error: -p flag is required");
  }

  const apiKey: ApiKey = asApiKey(rawApiKey, "OPENROUTER_API_KEY");
  // `asURLString` dispatches between asHTTPURL and asHTTPSURL based on the
  // scheme, so the return type is the precise `HTTPURL | HTTPSURL` brand
  // union — not the broader URLString<WebProtocol>. CodeCrafters runs the
  // harness against http://localhost; production deployments hit https://.
  const baseURL: HTTPURL | HTTPSURL = asURLString(
    rawBaseURL,
    "OPENROUTER_BASE_URL",
  );
  const flag: PromptFlag = asPromptFlag(rawFlag);
  const prompt: NonEmptyString = asNonEmptyString(rawPrompt, "prompt");
  void flag; // -p is validated, then discarded — only `prompt` is used downstream.

  const client: OpenAI = new OpenAI({ apiKey, baseURL });

  await runAgentLoop(client, prompt);
}

main();
