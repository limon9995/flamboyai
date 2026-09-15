import { Module } from '@nestjs/common';
import { InboxModule } from '../inbox/inbox.module';
import { IgMessengerService } from './ig-messenger.service';

@Module({
  imports: [InboxModule],
  providers: [IgMessengerService],
  exports: [IgMessengerService],
})
export class IgMessengerModule {}
