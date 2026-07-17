import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { IoAdapter } from '@nestjs/platform-socket.io';
import helmet from 'helmet';
import { AppModule } from '@/app.module';
import { AppConfig } from '@/config/configuration';
import { PrismaService } from '@/modules/prisma/prisma.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService<AppConfig, true>);

  app.use(helmet());
  // Socket.IO gateway (whiteboard) rides the same HTTP server; reachable
  // only via the frontend's WS proxy, never directly — see WhiteboardGateway.
  app.useWebSocketAdapter(new IoAdapter(app));

  app.enableCors({
    origin: config.get('corsAllowedOrigin', { infer: true }),
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const prismaService = app.get(PrismaService);
  await prismaService.enableShutdownHooks(app);

  if (config.get('nodeEnv', { infer: true }) !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Umer Designs API (internal)')
      .setDescription(
        'Server-to-server API. Only ever called by the Next.js BFF layer with a signed internal header — never reachable from the browser. This Swagger UI is for local development reference only.',
      )
      .setVersion('0.1')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document);
  }

  const port = config.get('port', { infer: true });
  await app.listen(port);
  Logger.log(`Umer Designs API listening on port ${port}`, 'Bootstrap');
}

void bootstrap();
