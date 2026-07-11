import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GenerateController } from './generate.controller';
import { GenerateService } from './generate.service';
import { World } from './entities/world.entity';
import { GraphModule } from '../graph/graph.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([World]),
    GraphModule,
  ],
  controllers: [GenerateController],
  providers: [GenerateService],
})
export class GenerateModule {}
