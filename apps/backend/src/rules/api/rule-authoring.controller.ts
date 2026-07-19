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

  @Post('templates/instantiate')
  instantiateTemplate(@Body() body: { template?: unknown; values?: Record<string, unknown> }) {
    const values = Object.fromEntries(
      Object.entries(body?.values ?? {}).map(([k, v]) => [
        k,
        typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? v : String(v ?? ''),
      ]),
    );
    return this.authoring.instantiateTemplate(body?.template, values);
  }

  @Post('assistant')
  sendAssistantMessage(@Body() body: { message?: string; history?: any[]; context?: { definitions?: any[] } }) {
    return this.authoring.sendAssistantMessage(
      Array.isArray(body?.history) ? body.history : [],
      typeof body?.message === 'string' ? body.message : '',
      body?.context?.definitions ?? [],
    );
  }

  @Get('assistant/tools')
  @Header('Cache-Control', 'private, max-age=3600')
  getAiToolSchemas() {
    return { tools: this.authoring.getAiToolSchemas() };
  }
}
