import "reflect-metadata";
import { HttpAdapterHost, NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module";
import { DomainErrorFilter } from "./common/domain-error.filter";
import { WEB_ORIGINS } from "./common/web-origins";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(cookieParser());
  app.enableCors({ origin: WEB_ORIGINS, credentials: true });
  app.useGlobalFilters(new DomainErrorFilter(app.get(HttpAdapterHost).httpAdapter));
  await app.listen(process.env.API_PORT ?? 4000);
}

bootstrap();
