import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { z, ZodRawShape } from "zod";
import { toApiError, type ApiErrorContext } from "../../dolibarr/errors.js";
import { jsonContent, prettyJsonContent } from "./responses.js";

type InferArgs<Shape extends ZodRawShape> = z.infer<z.ZodObject<Shape>>;

type JsonToolConfig<Shape extends ZodRawShape> = {
  description: string;
  inputSchema: Shape;
  title?: string;
  annotations?: ToolAnnotations;
  // Render the success payload as indented JSON. Errors always use compact JSON.
  pretty?: boolean;
  // Enrich Dolibarr error mapping with request-specific context, such as the
  // supplier invoice ref used to explain a duplicate-ref failure.
  errorContext?: (args: InferArgs<Shape>) => ApiErrorContext;
};

// Registers an MCP tool whose handler returns a plain JSON-serializable value.
// The wrapper owns the shared boilerplate: JSON formatting of the result and
// converting thrown Dolibarr errors into a structured MCP error payload.
export function registerJsonTool<Shape extends ZodRawShape>(
  server: McpServer,
  name: string,
  config: JsonToolConfig<Shape>,
  handler: (args: InferArgs<Shape>) => Promise<unknown> | unknown,
): void {
  const { pretty, errorContext, ...toolConfig } = config;
  const formatSuccess = pretty ? prettyJsonContent : jsonContent;

  // The SDK infers callback args through its own zod-compat types, which are
  // structurally distinct from z.infer even though they describe the same shape.
  // Handler args stay type-checked against Shape at the call site above; only
  // this bridge to the SDK signature needs the cast.
  const callback = (async (args: InferArgs<Shape>) => {
    try {
      return formatSuccess(await handler(args));
    } catch (err) {
      return jsonContent(toApiError(err, errorContext?.(args)));
    }
  }) as unknown as ToolCallback<Shape>;

  server.registerTool(name, toolConfig, callback);
}
