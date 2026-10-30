import { BadRequestException, PipeTransform } from "@nestjs/common";
import { describeIssue, DEFAULT_LOCALE, issueText, translate } from "@walkins/shared";
import type { z, ZodSchema } from "zod";

// Refuses with the first problem, worded for a person (see
// packages/shared/src/validation.ts), and names the field so a form can
// point at it. params.field is the field's key, for the web app to word.
export class ZodValidationPipe<T extends ZodSchema> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const [issue] = result.error.issues;
      const { key, values, field, fieldKey } = describeIssue(issue);
      throw new BadRequestException({
        code: key,
        message: issueText(issue, (k, v) => translate(DEFAULT_LOCALE, k, v)),
        params: { ...values, field: fieldKey },
        field,
      });
    }
    return result.data;
  }
}
