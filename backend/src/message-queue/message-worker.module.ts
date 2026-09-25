import { Module } from '@nestjs/common';
import { WebhookModule } from '../webhook/webhook.module';
import { MessageWorker } from './message.worker';

// One-directional import (this -> Webhook) so WebhookModule never needs to
// know about the queue consumer, avoiding a module cycle.
@Module({
  imports: [WebhookModule],
  providers: [MessageWorker],
})
export class MessageWorkerModule {}
