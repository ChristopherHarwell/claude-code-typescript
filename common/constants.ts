import type {
	DeepReadonly,
	ErrorCode,
	ErrorKind,
	NonEmptyString,
	Owned,
	ToolName,
} from "./types";
import { deepFreeze } from "./deepFreeze";

// ── Agent loop configuration ──────────────────────────────────────

const MODEL_ID: NonEmptyString = "anthropic/claude-haiku-4.5" as NonEmptyString;

// Hard cap on recursion depth in the agent loop. The model would have to
// chain this many tool calls before the loop refuses to issue another
// chat-completions request; the typed `MaxIterationsExceededError` fires
// instead so callers can dispatch on it.
const MAX_ITERATIONS: number = 50;

// ── Network defaults ──────────────────────────────────────────────

// Used when `OPENROUTER_BASE_URL` is not set in the environment. Refined
// to `HTTPSURL` at the consumer (main.ts) so it can't silently regress to a
// raw string.
const DEFAULT_BASE_URL: NonEmptyString =
	"https://openrouter.ai/api/v1" as NonEmptyString;

// ── Error code table ──────────────────────────────────────────────
//
// `satisfies` keeps this map in lockstep with the `ErrorKind` and `ErrorCode`
// type unions in types.ts — adding an entry that isn't in either fails to
// compile.
//
// Code ranges:
//   1xxx — configuration / startup
//   2xxx — input validation / refinement
//   3xxx — protocol / API response
//   4xxx — tool execution
//   5xxx — agent loop control

const ERROR_CODES = {
	MissingEnvVar:           1001,
	InvalidCliArguments:     1002,
	EmptyString:             2001,
	InvalidUrl:              2002,
	UnexpectedFlag:          2003,
	InvalidPath:             2004,
	EmptyChoices:            3001,
	UnsupportedToolCallType: 3002,
	UnknownToolName:         3003,
	ToolNotImplemented:      4001,
	MaxIterationsExceeded:   5001,
} as const satisfies { readonly [K in ErrorKind]: ErrorCode };

// ── Tool registry constants ───────────────────────────────────────

// Closed runtime set mirroring the `ToolName` literal union. Lives here
// alongside the schema configuration so a runtime check can use it without
// pulling in the dispatch / handler module.
const TOOL_NAMES: DeepReadonly<Owned<ReadonlySet<ToolName>>> = deepFreeze(
	new Set<ToolName>(["Read", "Write", "Edit", "Bash"]),
);

export {
	MODEL_ID,
	MAX_ITERATIONS,
	DEFAULT_BASE_URL,
	ERROR_CODES,
	TOOL_NAMES,
};
