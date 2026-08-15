import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { PrismaService } from './prisma.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Allow React frontend to call the backend
  app.enableCors({
  origin: [
    'http://localhost:5173',
    'https://keystone-assignment-1.onrender.com',
  ],
});

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  const prisma = app.get(PrismaService);
  await prisma.enableShutdownHooks(app);

  await app.listen(Number(process.env.PORT ?? 3000));
}

bootstrap();