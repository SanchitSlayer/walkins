import "reflect-metadata";
import { HttpAdapterHost, NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module";
import { DomainErrorFilter } from "./common/domain-error.filter";
import { WEB_ORIGINS } from "./common/web-origins";

async function bootstrap() {
  // rawBody keeps the exact bytes of each request beside the parsed JSON: a
  // payment webhook's signature covers those bytes, not a re-serialisation.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  // Browsers reach the API through the web app's /api proxy, so the socket's
  // address is always the proxy's. Trusting X-Forwarded-For from loopback
  // only makes request.ip the visitor's address, which per-address limits
  // need. Next's dev server passes on a client-supplied X-Forwarded-For, so in
  // production a reverse proxy in front must overwrite it (see README).
  app.set("trust proxy", "loopback");
  app.use(cookieParser());
  app.enableCors({ origin: WEB_ORIGINS, credentials: true });
  app.useGlobalFilters(new DomainErrorFilter(app.get(HttpAdapterHost).httpAdapter));
  await app.listen(process.env.API_PORT ?? 4000);
}

bootstrap();
