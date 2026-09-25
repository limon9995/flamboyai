import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { PageModule } from '../page/page.module';
import { ProductsModule } from '../products/products.module';
import { OrdersModule } from '../orders/orders.module';
import { CallModule } from '../call/call.module';
import { PrintModule } from '../print/print.module';
import { MemoModule } from '../memo/memo.module';
import { BotKnowledgeModule } from '../bot-knowledge/bot-knowledge.module';
import { AccountingModule } from '../accounting/accounting.module';
import { CrmModule } from '../crm/crm.module';
import { CourierModule } from '../courier/courier.module';
import { FollowUpModule } from '../followup/followup.module';
import { BroadcastModule } from '../broadcast/broadcast.module';
import { VisionOpsModule } from '../vision-ops/vision-ops.module';
import { OcrModule } from '../ocr/ocr.module';
import { SpamCheckerModule } from '../spam-checker/spam-checker.module';
import { AdminModule } from '../admin/admin.module';
import { TelegramModule } from '../telegram/telegram.module';
import { PricingModule } from '../pricing/pricing.module';
import { InboxModule } from '../inbox/inbox.module';
import { ClientDashboardService } from './client-dashboard.service';
import { ClientDashboardController } from './client-dashboard.controller';

@Module({
  imports: [
    MulterModule.register({ limits: { fileSize: 10 * 1024 * 1024 } }),
    PrismaModule,
    AuthModule,
    PageModule,
    ProductsModule,
    OrdersModule,
    CallModule,
    PrintModule,
    MemoModule,
    BotKnowledgeModule,
    VisionOpsModule,
    OcrModule,
    SpamCheckerModule,
    AccountingModule,
    CrmModule,
    CourierModule,
    FollowUpModule,
    BroadcastModule,
    AdminModule,
    TelegramModule,
    PricingModule,
    InboxModule,
  ],
  providers: [ClientDashboardService],
  controllers: [ClientDashboardController],
  exports: [ClientDashboardService],
})
export class ClientDashboardModule {}
