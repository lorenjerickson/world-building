import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { GenerateService } from './generate.service';
import { GenerateDto } from './dto/generate.dto';

@Controller('api/generate')
export class GenerateController {
  constructor(private readonly generateService: GenerateService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async generate(@Body() generateDto: GenerateDto) {
    return this.generateService.generate(generateDto.prompt);
  }
}
