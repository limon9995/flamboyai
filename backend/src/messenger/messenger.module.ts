import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { InboxModule } from '../inbox/inbox.module';
import { MessengerService } from './messenger.service';

@Module({
  imports: [CommonModule, InboxModule],
  providers: [MessengerService],
  exports: [MessengerService],
})
export class MessengerModule {}
