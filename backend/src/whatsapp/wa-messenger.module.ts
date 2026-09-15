import { Module } from '@nestjs/common';
import { InboxModule } from '../inbox/inbox.module';
import { WaMessengerService } from './wa-messenger.service';

@Module({
  imports: [InboxModule],
  providers: [WaMessengerService],
  exports: [WaMessengerService],
})
export class WaMessengerModule {}
