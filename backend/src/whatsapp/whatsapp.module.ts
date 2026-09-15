import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CommonModule } from '../common/common.module';
import { BotModule } from '../bot/bot.module';
import { BotKnowledgeModule } from '../bot-knowledge/bot-knowledge.module';
import { ConversationContextModule } from '../conversation-context/conversation-context.module';
import { CrmModule } from '../crm/crm.module';
import { CallModule } from '../call/call.module';
import { ProductsModule } from '../products/products.module';
import { FollowUpModule } from '../followup/followup.module';
import { BillingModule } from '../billing/billing.module';
import { SpamCheckerModule } from '../spam-checker/spam-checker.module';
import { CourierModule } from '../courier/courier.module';
import { TelegramModule } from '../telegram/telegram.module';
import { PaymentVerifyModule } from '../payment-verify/payment-verify.module';
import { SmsGatewayModule } from '../sms-gateway/sms-gateway.module';
import { OrdersModule } from '../orders/orders.module';
import { WaMessengerModule } from './wa-messenger.module';
import { WaWebhookController } from './wa-webhook.controller';
import { WaWebhookService } from './wa-webhook.service';
import { WaMessengerService } from './wa-messenger.service';
import { WaConnectRequestController } from './wa-connect-request.controller';
import { WaConnectRequestService } from './wa-connect-request.service';
import { DraftOrderHandler } from '../webhook/handlers/draft-order.handler';
import { AuthModule } from '../auth/auth.module';
import { SmartBotService } from '../bot/smart-bot.service';
import { MessengerModule } from '../messenger/messenger.module';
import { OcrModule } from '../ocr/ocr.module';
import { OcrQueueModule } from '../ocr-queue/ocr-queue.module';
import { VisionAnalysisModule } from '../vision-analysis/vision-analysis.module';
import { ProductMatchModule } from '../product-match/product-match.module';
import { PricingModule } from '../pricing/pricing.module';
import { InboxModule } from '../inbox/inbox.module';

@Module({
  imports: [
    PrismaModule,
    InboxModule,
    CommonModule,
    BotModule,
    BotKnowledgeModule,
    ConversationContextModule,
    CrmModule,
    CallModule,
    ProductsModule,
    FollowUpModule,
    BillingModule,
    SpamCheckerModule,
    CourierModule,
    TelegramModule,
    PaymentVerifyModule,
    SmsGatewayModule,
    OrdersModule,
    WaMessengerModule,
    AuthModule,
    MessengerModule,
    OcrModule,
    OcrQueueModule,
    VisionAnalysisModule,
    ProductMatchModule,
    PricingModule,
  ],
  controllers: [WaWebhookController, WaConnectRequestController],
  providers: [WaWebhookService, DraftOrderHandler, WaConnectRequestService, SmartBotService],
  exports: [WaMessengerModule, WaConnectRequestService],
})
export class WhatsappModule {}
