import {
  Body,
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { RuleApiActorGuard } from './rule-api-actor';
import { RuleAuthoringService } from './rule-authoring.service';

@Controller('api/rule-authoring')
@UseGuards(RuleApiActorGuard)
export class RuleAuthoringController {
  constructor(private readonly authoring: RuleAuthoringService) {}

  @Get('metamodel')
  @Header('Cache-Control', 'private, max-age=3600')
  getMetamodel() {
    return this.authoring.getMetamodel();
  }

  @Get('definition-types/:type/descriptor')
  @Header('Cache-Control', 'private, max-age=3600')
  getDescriptor(@Param('type') type: string) {
    const descriptor = this.authoring.getDescriptor(type);
    if (!descriptor) {
      throw new NotFoundException({
        code: 'RULE_DEFINITION_TYPE_NOT_FOUND',
        message: `Definition type '${type}' is not part of the active metamodel.`,
        retryable: false,
      });
    }
    return descriptor;
  }

  @Post('validate')
  validate(@Body() body: { definitions?: unknown[] }) {
    return this.authoring.validate(Array.isArray(body?.definitions) ? body.definitions : []);
  }

  @Post('preview')
  preview(@Body() body: { definitions?: any[]; operationId?: string; context?: any }) {
    return this.authoring.preview(body?.definitions ?? [], body?.operationId ?? '', body?.context);
  }

  @Post('fixtures/run')
  runFixtures(@Body() body: { definitions?: any[]; fixtures?: any[] }) {
    return this.authoring.runFixtures(body?.definitions ?? [], body?.fixtures ?? []);
  }
}
