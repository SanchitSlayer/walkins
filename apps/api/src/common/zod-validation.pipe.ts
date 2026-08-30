import { BadRequestException, PipeTransform } from "@nestjs/common";
import type { z, ZodSchema } from "zod";

export class ZodValidationPipe<T extends ZodSchema> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException(result.error.flatten());
    }
    return result.data;
  }
}
