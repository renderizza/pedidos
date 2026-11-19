import { z } from "zod";
import { requiredText } from "./common";

export const categoryInputSchema = z.object({
  name: requiredText("Nome da categoria", 2, 60),
});

export type CategoryInput = z.infer<typeof categoryInputSchema>;
