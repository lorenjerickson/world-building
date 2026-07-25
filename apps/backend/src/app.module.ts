import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './database/prisma.module';
import { GraphModule } from './graph/graph.module';
import { GenerateModule } from './generate/generate.module';
import { UploadsController } from './uploads.controller';
import { CharacterArtController } from './character-art.controller';
import { CmsModule } from './cms/cms.module';
import { RulesModule } from './rules/rules.module';
import { EncountersModule } from './encounters/encounters.module';
import { RealtimeModule } from './realtime/realtime.module';

@Module({
  imports: [
    PrismaModule,
    GraphModule,
    GenerateModule,
    CmsModule,
    RulesModule,
    EncountersModule,
    RealtimeModule,
  ],
  controllers: [AppController, UploadsController, CharacterArtController],
  providers: [AppService],
})
export class AppModule {}
