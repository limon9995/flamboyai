import { forwardRef, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MessengerModule } from '../messenger/messenger.module';
import { BotKnowledgeModule } from '../bot-knowledge/bot-knowledge.module';
import { OcrModule } from '../ocr/ocr.module';
import { OcrQueueModule } from '../ocr-queue/ocr-queue.module';
import { BotModule } from '../bot/bot.module';
import { ConversationContextModule } from '../conversation-context/conversation-context.module';
import { CallModule } from '../call/call.module';
import { ProductsModule } from '../products/products.module';
import { CrmModule } from '../crm/crm.module';
import { FollowUpModule } from '../followup/followup.module';
import { BillingModule } from '../billing/billing.module';
import { VisionAnalysisModule } from '../vision-analysis/vision-analysis.module';
import { ProductMatchModule } from '../product-match/product-match.module';
import { FallbackAiModule } from '../fallback-ai/fallback-ai.module';
import { VisionOpsModule } from '../vision-ops/vision-ops.module';
import { SpamCheckerModule } from '../spam-checker/spam-checker.module';
import { EmbeddingModule } from '../embedding/embedding.module';
import { MessageQueueModule } from '../message-queue/message-queue.module';
import { ProductNameMatchModule } from '../product-name-match/product-name-match.module';
import { PaymentVerifyModule } from '../payment-verify/payment-verify.module';
import { SmsGatewayModule } from '../sms-gateway/sms-gateway.module';
import { UniversityModule } from '../university/university.module';
import { CourierModule } from '../courier/courier.module';
import { TelegramModule } from '../telegram/telegram.module';
import { OrdersModule } from '../orders/orders.module';
import { PricingModule } from '../pricing/pricing.module';
import { InboxModule } from '../inbox/inbox.module';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { SmartBotService } from '../bot/smart-bot.service';
import { DraftOrderHandler } from './handlers/draft-order.handler';
import { ProductInfoHandler } from './handlers/product-info.handler';
import { NegotiationHandler } from './handlers/negotiation.handler';

@Module({
  imports: [
    PrismaModule,
    MessengerModule,
    BotKnowledgeModule,
    OcrModule,
    OcrQueueModule,
    BotModule,
    ConversationContextModule,
    CallModule,
    ProductsModule,
    CrmModule,
    FollowUpModule,
    BillingModule,
    VisionAnalysisModule,
    ProductMatchModule,
    FallbackAiModule,
    VisionOpsModule,
    SpamCheckerModule,
    MessageQueueModule,
    EmbeddingModule,
    ProductNameMatchModule,
    forwardRef(() => PaymentVerifyModule),
    SmsGatewayModule,
    UniversityModule,
    CourierModule,
    TelegramModule,
    OrdersModule,
    PricingModule,
    InboxModule,
  ],
  controllers: [WebhookController],
  providers: [
    WebhookService,
    SmartBotService,
    DraftOrderHandler,
    ProductInfoHandler,
    NegotiationHandler,
  ],
  exports: [DraftOrderHandler, WebhookService],
})
export class WebhookModule {}
