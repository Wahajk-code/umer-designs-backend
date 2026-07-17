import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { EventEmitterModule } from '@nestjs/event-emitter';
import configuration, { AppConfig } from '@/config/configuration';
import { envValidationSchema } from '@/config/env.validation';
import { AllExceptionsFilter } from '@/common/filters/all-exceptions.filter';
import { InternalAttestationGuard } from '@/common/guards/internal-attestation.guard';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { SecurityModule } from '@/common/security/security.module';
import { PrismaModule } from '@/modules/prisma/prisma.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { UsersModule } from '@/modules/users/users.module';
import { CloudinaryModule } from '@/modules/cloudinary/cloudinary.module';
import { DesignsModule } from '@/modules/designs/designs.module';
import { PaymentsModule } from '@/modules/payments/payments.module';
import { OrdersModule } from '@/modules/orders/orders.module';
import { ModificationsModule } from '@/modules/modifications/modifications.module';
import { MeetingsModule } from '@/modules/meetings/meetings.module';
import { WhiteboardModule } from '@/modules/whiteboard/whiteboard.module';
import { MailModule } from '@/modules/mail/mail.module';
import { NotificationsModule } from '@/modules/notifications/notifications.module';
import { PaymentLinksModule } from '@/modules/payment-links/payment-links.module';
import { ReferralsModule } from '@/modules/referrals/referrals.module';
import { ContactModule } from '@/modules/contact/contact.module';
import { WebhooksModule } from '@/modules/webhooks/webhooks.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: false },
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const rl = config.get('rateLimit', { infer: true });
        return [
          { name: 'default', ttl: rl.default.ttlMs, limit: rl.default.limit },
          { name: 'auth', ttl: rl.auth.ttlMs, limit: rl.auth.limit },
          { name: 'payment', ttl: rl.payment.ttlMs, limit: rl.payment.limit },
        ];
      },
    }),
    EventEmitterModule.forRoot(),
    SecurityModule,
    PrismaModule,
    AuthModule,
    UsersModule,
    CloudinaryModule,
    DesignsModule,
    PaymentsModule,
    OrdersModule,
    ModificationsModule,
    MeetingsModule,
    WhiteboardModule,
    MailModule,
    NotificationsModule,
    PaymentLinksModule,
    ReferralsModule,
    ContactModule,
    WebhooksModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: InternalAttestationGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
