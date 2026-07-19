import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { GraphModule } from './graph/graph.module';
import { GenerateModule } from './generate/generate.module';
import { UploadsController } from './uploads.controller';
import { CharacterArtController } from './character-art.controller';
import { CmsModule } from './cms/cms.module';
import { applicationEntities } from './database/entities';
import { applicationMigrations } from './database/migrations';
import { RulesModule } from './rules/rules.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL || 'postgresql://worldbuilder:password123@db:5432/worlddb',
      entities: applicationEntities,
      migrations: applicationMigrations,
      migrationsRun: true,
      synchronize: false,
    }),
    GraphModule,
    GenerateModule,
    CmsModule,
    RulesModule,
  ],
  controllers: [AppController, UploadsController, CharacterArtController],
  providers: [AppService],
})
export class AppModule {}
