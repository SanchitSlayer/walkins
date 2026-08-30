import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(cookieParser());
  app.enableCors({
    origin: `http://localhost:${process.env.WEB_PORT ?? 3000}`,
    credentials: true,
  });
  await app.listen(process.env.API_PORT ?? 4000);
}

bootstrap();
