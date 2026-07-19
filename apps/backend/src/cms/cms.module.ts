import { Module } from '@nestjs/common';
import { ContentRepository } from './content.repository';
import { PayloadContentRepository } from './payload-content.repository';

@Module({
  exports: [ContentRepository],
  providers: [
    PayloadContentRepository,
    {
      provide: ContentRepository,
      useExisting: PayloadContentRepository,
    },
  ],
})
export class CmsModule {}
