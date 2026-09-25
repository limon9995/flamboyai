import { forwardRef, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OrdersModule } from '../orders/orders.module';
import { TelegramModule } from '../telegram/telegram.module';
import { CourierService } from './courier.service';
import { CourierAccountingService } from './courier-accounting.service';
export { CourierService, CourierAccountingService };

@Module({
  // OrdersModule now also imports CourierModule (forwardRef) so
  // OrdersService can call autoBookOnConfirm() — forwardRef needed on both
  // sides of this circular module dependency.
  imports: [PrismaModule, forwardRef(() => OrdersModule), TelegramModule],
  providers: [CourierService, CourierAccountingService],
  exports: [CourierService, CourierAccountingService],
})
export class CourierModule {}
