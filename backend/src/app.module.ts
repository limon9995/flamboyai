import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';

import { CommonModule } from './common/common.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProductsModule } from './products/products.module';
import { OrdersModule } from './orders/orders.module';
import { WebhookModule } from './webhook/webhook.module';
import { AgentsModule } from './agents/agents.module';
import { MessengerModule } from './messenger/messenger.module';
import { OcrQueueModule } from './ocr-queue/ocr-queue.module';
import { OcrModule } from './ocr/ocr.module';
import { BotModule } from './bot/bot.module';
import { PageModule } from './page/page.module';
import { PrintModule } from './print/print.module';
import { MemoModule } from './memo/memo.module';
import { AdminModule } from './admin/admin.module';
import { ClientDashboardModule } from './client-dashboard/client-dashboard.module';
import { AuthModule } from './auth/auth.module';
import { CallModule } from './call/call.module';
import { ConversationContextModule } from './conversation-context/conversation-context.module';
import { FacebookModule } from './facebook/facebook.module';
import { AccountingModule } from './accounting/accounting.module';
import { CrmModule } from './crm/crm.module';
import { CourierModule } from './courier/courier.module';
import { FollowUpModule } from './followup/followup.module';
import { BroadcastModule } from './broadcast/broadcast.module';
import { V9SchedulerModule } from './scheduler/scheduler.module';
import { CatalogModule } from './catalog/catalog.module';
import { BillingModule } from './billing/billing.module';
import { WalletModule } from './wallet/wallet.module';
import { WhisperModule } from './whisper/whisper.module';
import { MessageQueueModule } from './message-queue/message-queue.module';
import { ChatModule } from './chat/chat.module';
import { AiGenerateModule } from './ai-generate/ai-generate.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { InstagramModule } from './instagram/instagram.module';
import { EmbeddingModule } from './embedding/embedding.module';
import { AutoPostModule } from './auto-post/auto-post.module';
import { SupportChatModule } from './support-chat/support-chat.module';
import { PaymentVerifyModule } from './payment-verify/payment-verify.module';
import { SmsGatewayModule } from './sms-gateway/sms-gateway.module';
import { UniversityModule } from './university/university.module';
import { TelegramModule } from './telegram/telegram.module';
import { PublicOrderModule } from './public-order/public-order.module';
import { RestaurantModule } from './restaurant/restaurant.module';
import { ReviewsModule } from './reviews/reviews.module';
import { PricingModule } from './pricing/pricing.module';
import { PartnerModule } from './partner/partner.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),

    // ── FIX: Rate limiting ───────────────────────────────────────────────────
    // Global: 200 requests per minute per IP
    // Auth endpoints get a tighter limit via @Throttle() decorator
    ThrottlerModule.forRoot([
      {
        name: 'global',
        ttl: 60_000, // 1 minute window
        limit: 600, // max 600 requests per IP per minute
      },
      {
        name: 'auth',
        ttl: 300_000, // 5 minute window
        limit: 10, // max 10 login attempts per IP per 5 minutes
      },
      {
        name: 'chat',
        ttl: 60_000, // 1 minute window
        limit: 20, // max 20 chat messages per IP per minute
      },
    ]),

    CommonModule,
    PrismaModule,
    ProductsModule,
    OrdersModule,
    WebhookModule,
    AgentsModule,
    MessengerModule,
    OcrQueueModule,
    OcrModule,
    BotModule,
    PageModule,
    PrintModule,
    MemoModule,
    AdminModule,
    ClientDashboardModule,
    AuthModule,
    CallModule,
    ChatModule,
    AiGenerateModule,
    WhatsappModule,
    InstagramModule,
    ConversationContextModule,
    FacebookModule,
    AccountingModule,
    CrmModule,
    CourierModule,
    FollowUpModule,
    BroadcastModule,
    V9SchedulerModule,
    CatalogModule,
    BillingModule,
    WalletModule,
    PartnerModule,
    WhisperModule,
    MessageQueueModule,
    EmbeddingModule,
    AutoPostModule,
    SupportChatModule,
    PaymentVerifyModule,
    SmsGatewayModule,
    UniversityModule,
    TelegramModule,
    PublicOrderModule,
    RestaurantModule,
    ReviewsModule,
    PricingModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Apply global throttle guard to all routes
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
