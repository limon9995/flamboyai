import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { PartnerController } from './partner.controller';
import { PartnerService } from './partner.service';

@Global()
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [PartnerController],
  providers: [PartnerService],
  exports: [PartnerService],
})
export class PartnerModule {}
