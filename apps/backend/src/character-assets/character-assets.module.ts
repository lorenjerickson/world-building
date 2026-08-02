import { Module } from '@nestjs/common';
import { RuleApiActorGuard } from '../rules/api/rule-api-actor';
import { CharacterAssetsController } from './character-assets.controller';
import { CharacterModelGenerationController } from './character-model-generation.controller';
import { CharacterModelGenerationService } from './character-model-generation.service';
import { PayloadCharacterAssetsRepository } from './payload-character-assets.repository';
import { MediaAssetsModule } from '../media-assets/media-assets.module';

@Module({
  imports: [MediaAssetsModule],
  controllers: [CharacterAssetsController, CharacterModelGenerationController],
  providers: [
    RuleApiActorGuard,
    PayloadCharacterAssetsRepository,
    CharacterModelGenerationService,
  ],
})
export class CharacterAssetsModule {}
