import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ClientDashboardModule } from '../client-dashboard/client-dashboard.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AssistantToolsService } from './assistant-tools.service';
import { SupportChatController } from './support-chat.controller';
import { SupportChatService } from './support-chat.service';

@Module({
  imports: [PrismaModule, AuthModule, ClientDashboardModule],
  controllers: [SupportChatController],
  providers: [SupportChatService, AssistantToolsService],
})
export class SupportChatModule {}
