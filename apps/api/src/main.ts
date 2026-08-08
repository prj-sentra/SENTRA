import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const webOrigin = process.env.WEB_ORIGIN;
  if (!webOrigin) throw new Error('WEB_ORIGIN is required');
  const parsedOrigin = new URL(webOrigin);
  if (parsedOrigin.origin !== webOrigin || (process.env.NODE_ENV === 'production' && parsedOrigin.protocol !== 'https:')) {
    throw new Error('WEB_ORIGIN must be an exact origin and use HTTPS in production');
  }
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: webOrigin,
    credentials: true,
  });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
