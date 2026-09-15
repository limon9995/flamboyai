import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { InboxService } from './inbox.service';
import { MessageLogService } from './message-log.service';
export { InboxService, MessageLogService };

@Module({
  imports: [PrismaModule],
  providers: [InboxService, MessageLogService],
  exports: [InboxService, MessageLogService],
})
export class InboxModule {}
