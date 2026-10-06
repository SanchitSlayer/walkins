import "reflect-metadata";
import { HttpAdapterHost, NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module";
import { DomainErrorFilter } from "./common/domain-error.filter";
import { WEB_ORIGINS } from "./common/web-origins";

async function bootstrap() {
  // rawBody keeps the exact bytes of each request beside the parsed JSON: a
  // payment webhook's signature covers those bytes, not a re-serialisation.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.use(cookieParser());
  app.enableCors({ origin: WEB_ORIGINS, credentials: true });
  app.useGlobalFilters(new DomainErrorFilter(app.get(HttpAdapterHost).httpAdapter));
  await app.listen(process.env.API_PORT ?? 4000);
}

bootstrap();
