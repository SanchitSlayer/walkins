import { type ArgumentsHost, Catch, ConflictException, type ExceptionFilter } from "@nestjs/common";
import { BaseExceptionFilter } from "@nestjs/core";
import { IllegalTransitionError, SlotFullError, StaleTransitionError } from "@walkins/db";

// The application state machine lives in @walkins/db and knows nothing about
// HTTP. Each of its refusals means the request conflicts with the current
// state of the application or slot, which is a 409 with the reason as-is.
@Catch(IllegalTransitionError, SlotFullError, StaleTransitionError)
export class DomainErrorFilter extends BaseExceptionFilter implements ExceptionFilter {
  catch(err: Error, host: ArgumentsHost) {
    super.catch(new ConflictException(err.message), host);
  }
}
