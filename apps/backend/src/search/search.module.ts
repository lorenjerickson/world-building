import { Module } from '@nestjs/common';
import { RulesModule } from '../rules/rules.module';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  imports: [RulesModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
