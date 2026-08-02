import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './database/prisma.module';
import { GraphModule } from './graph/graph.module';
import { GenerateModule } from './generate/generate.module';
import { CmsModule } from './cms/cms.module';
import { RulesModule } from './rules/rules.module';
import { EncountersModule } from './encounters/encounters.module';
import { RealtimeModule } from './realtime/realtime.module';
import { SearchModule } from './search/search.module';
import { CharacterAssetsModule } from './character-assets/character-assets.module';
import { MediaAssetsModule } from './media-assets/media-assets.module';
import { WorldsModule } from './worlds/worlds.module';

@Module({
  imports: [
    PrismaModule,
    GraphModule,
    GenerateModule,
    CmsModule,
    RulesModule,
    EncountersModule,
    RealtimeModule,
    SearchModule,
    CharacterAssetsModule,
    MediaAssetsModule,
    WorldsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
