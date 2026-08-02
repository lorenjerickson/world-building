import { Module } from '@nestjs/common';
import { RuleApiActorGuard } from '../rules/api/rule-api-actor';
import { MediaAssetsController } from './media-assets.controller';
import { PayloadMediaAssetsRepository } from './payload-media-assets.repository';
import { CharacterArtController } from '../character-art.controller';

@Module({
  controllers: [MediaAssetsController, CharacterArtController],
  providers: [RuleApiActorGuard, PayloadMediaAssetsRepository],
  exports: [PayloadMediaAssetsRepository],
})
export class MediaAssetsModule {}
