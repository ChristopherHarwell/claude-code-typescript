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
export type { Tool, ToolName, ReadTool };

