import { type ArgumentsHost, Catch, ConflictException, type ExceptionFilter } from "@nestjs/common";
import { BaseExceptionFilter } from "@nestjs/core";
import { IllegalTransitionError, SlotFullError, StaleTransitionError } from "@walkins/db";
import type { MessageKey } from "@walkins/shared";
import { apiError } from "./api-error";

// The application state machine lives in @walkins/db and knows nothing about
// HTTP or wording. Each of its refusals means the request conflicts with the
// current state of the application or slot: a 409, worded for the person.
const WORDING = new Map<Function, MessageKey>([
  [SlotFullError, "errors.application.slotFull"],
  [IllegalTransitionError, "errors.application.illegal"],
  [StaleTransitionError, "errors.application.stale"],
]);

@Catch(IllegalTransitionError, SlotFullError, StaleTransitionError)
export class DomainErrorFilter extends BaseExceptionFilter implements ExceptionFilter {
  catch(err: Error, host: ArgumentsHost) {
    super.catch(new ConflictException(apiError(WORDING.get(err.constructor) ?? "errors.application.illegal")), host);
  }
}
