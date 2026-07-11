import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { GraphModule } from './graph/graph.module';
import { GenerateModule } from './generate/generate.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL || 'postgresql://worldbuilder:password123@db:5432/worlddb',
      autoLoadEntities: true,
      synchronize: true,
    }),
    GraphModule,
    GenerateModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
