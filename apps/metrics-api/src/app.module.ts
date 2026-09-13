import { Module } from '@nestjs/common';
import { SpendController } from './modules/spend/spend.controller';
import { SpendService } from './modules/spend/spend.service';

@Module({
  imports: [],
  controllers: [SpendController],
  providers: [SpendService],
})
export class AppModule {}
