import { Controller, Post, Put, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { GenerateService } from './generate.service';
import { GenerateDto } from './dto/generate.dto';
import { GenerateElementDto } from './dto/generate-element.dto';

@Controller('api/generate')
export class GenerateController {
  constructor(private readonly generateService: GenerateService) {}

  @Post('world')
  @HttpCode(HttpStatus.OK)
  async generate(@Body() generateDto: GenerateDto) {
    return this.generateService.generate(generateDto.prompt);
  }

  @Put('world/:id')
  @HttpCode(HttpStatus.OK)
  async updateWorld(
    @Param('id') id: string,
    @Body() body: { metadata: any; description?: string; triples?: any[] }
  ) {
    return this.generateService.updateWorld(id, body.metadata, body.description, body.triples);
  }

  @Post('world/:id/:elementType')
  @HttpCode(HttpStatus.OK)
  async generateElement(
    @Param('id') worldId: string,
    @Param('elementType') elementType: 'location' | 'character' | 'organization' | 'event' | 'item',
    @Body() generateElementDto: GenerateElementDto,
  ) {
    return this.generateService.generateElement(worldId, elementType, generateElementDto);
  }
}

