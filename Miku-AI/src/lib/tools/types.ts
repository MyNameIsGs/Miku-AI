export type ToolSchema = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required: string[];
    };
  };
};

export type ToolDefinition = {
  schema: ToolSchema;
  execute: (args: Record<string, unknown>) => Promise<string> | string;
};
