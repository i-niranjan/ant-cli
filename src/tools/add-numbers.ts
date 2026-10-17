import { z } from "zod";
import { defineTool } from "./tool.js";

// Harmless fixture tool: no files, processes, or network.
export const addNumbers = defineTool({
  name: "add_numbers",
  description: "Add two numbers and return the sum.",
  args: z.strictObject({
    a: z.number().describe("First number"),
    b: z.number().describe("Second number"),
  }),
  async execute({ a, b }) {
    return String(a + b);
  },
});
