import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { World } from './entities/world.entity';
import { GraphService } from '../graph/graph.service';
import { GenerateElementDto } from './dto/generate-element.dto';
import { LlmService } from '../llm/llm.service';


@Injectable()
export class GenerateService {
  private readonly logger = new Logger(GenerateService.name);

  constructor(
    @InjectRepository(World)
    private readonly worldsRepository: Repository<World>,
    private readonly graphService: GraphService,
    private readonly llmService: LlmService,
  ) {}

  private cleanJsonString(str: string): string {
    return str.replace(/```json/g, '').replace(/```/g, '').trim();
  }

  private generateFallbackWorld(prompt: string) {
    const promptLower = prompt.toLowerCase();
    
    let name = 'Aethelgard';
    let description = 'A classic high-fantasy realm of magic, ancient forests, and legendary kingdoms.';
    let places = ['Eldoria', 'Whispering Woods', 'Shadow Spire'];
    let characters = ['King Aethelred', 'Sylvia the Ranger', 'Malakar the Necromancer'];
    let triples = [
      { subject: 'King Aethelred', predicate: 'rules', object: 'Eldoria' },
      { subject: 'Sylvia the Ranger', predicate: 'guards', object: 'Whispering Woods' },
      { subject: 'Malakar the Necromancer', predicate: 'lurksIn', object: 'Shadow Spire' },
      { subject: 'Malakar the Necromancer', predicate: 'enemyOf', object: 'King Aethelred' },
      { subject: 'Sylvia the Ranger', predicate: 'allyOf', object: 'King Aethelred' }
    ];

    if (promptLower.includes('cyberpunk') || promptLower.includes('sci-fi') || promptLower.includes('space') || promptLower.includes('future')) {
      name = 'Neo-Kyoto 2099';
      description = 'A sprawling cyberpunk metropolis illuminated by neon signs and shadowed by megacorporations.';
      places = ['Sector 7 Slums', 'Arasaka Tower', 'Netspace Grid'];
      characters = ['Dexter the Netrunner', 'CEO Tanaka', 'Cyber-Ninja Ren'];
      triples = [
        { subject: 'CEO Tanaka', predicate: 'controls', object: 'Arasaka Tower' },
        { subject: 'Dexter the Netrunner', predicate: 'hacks', object: 'Netspace Grid' },
        { subject: 'Cyber-Ninja Ren', predicate: 'worksFor', object: 'CEO Tanaka' },
        { subject: 'Dexter the Netrunner', predicate: 'enemyOf', object: 'CEO Tanaka' },
        { subject: 'Cyber-Ninja Ren', predicate: 'hunts', object: 'Dexter the Netrunner' }
      ];
    } else if (promptLower.includes('dark') || promptLower.includes('gothic') || promptLower.includes('horror') || promptLower.includes('shadow')) {
      name = 'Sanguinia';
      description = 'A dark, mist-shrouded gothic land ruled by vampire lords and plagued by nightmares.';
      places = ['Castle Dracula', 'Gallowmote Village', 'Screaming Catacombs'];
      characters = ['Lord Vlad', 'Father Gabriel', 'The Weeping Banshee'];
      triples = [
        { subject: 'Lord Vlad', predicate: 'rules', object: 'Castle Dracula' },
        { subject: 'Father Gabriel', predicate: 'protects', object: 'Gallowmote Village' },
        { subject: 'The Weeping Banshee', predicate: 'haunts', object: 'Screaming Catacombs' },
        { subject: 'Lord Vlad', predicate: 'terrorizes', object: 'Gallowmote Village' },
        { subject: 'Father Gabriel', predicate: 'enemyOf', object: 'Lord Vlad' }
      ];
    } else if (promptLower.trim().length > 0) {
      const capitalizedPrompt = prompt.charAt(0).toUpperCase() + prompt.slice(1);
      name = `The Lands of ${capitalizedPrompt}`;
      description = `A unique realm created by the spark of "${prompt}". It is a place of deep mysteries and legends waiting to unfold.`;
      places = [`${capitalizedPrompt} Keep`, `Whispering Valleys`, `Echoing Caves`];
      characters = [`Champion of ${capitalizedPrompt}`, `Elder of the Valleys`, `The Shadow Beast`];
      triples = [
        { subject: `Champion of ${capitalizedPrompt}`, predicate: `defends`, object: `${capitalizedPrompt} Keep` },
        { subject: `Elder of the Valleys`, predicate: `advises`, object: `Whispering Valleys` },
        { subject: `The Shadow Beast`, predicate: `haunts`, object: `Echoing Caves` },
        { subject: `The Shadow Beast`, predicate: `enemyOf`, object: `Champion of ${capitalizedPrompt}` }
      ];
    }

    return { name, description, places, characters, triples };
  }

  async generate(prompt: string): Promise<any> {
    this.logger.log(`Starting generation for prompt: "${prompt}"`);
    let worldData: any;

    if (this.llmService.isConfigured) {
      try {
        this.logger.log(`Using ${this.llmService.provider} for RPG World generation...`);
        const systemPrompt = `You are an RPG World Builder. Generate a fantasy or sci-fi world based on the user's prompt. 
You must output a JSON response in the following schema:
{
  "name": "World Name",
  "description": "A paragraph describing the world",
  "places": ["Place A", "Place B"],
  "characters": ["Character A", "Character B"],
  "triples": [
    {"subject": "Character A", "predicate": "residesIn", "object": "Place A"},
    {"subject": "Character B", "predicate": "enemyOf", "object": "Character A"}
  ]
}
Ensure the JSON is valid. Only return the raw JSON object, no markdown styling. Do not wrap in backticks.`;

        const completion = await this.llmService.complete({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt }
          ],
          responseFormat: 'json',
        });

        this.logger.log(`${completion.provider} responded. Processing JSON...`);
        const cleaned = this.cleanJsonString(completion.text);
        worldData = JSON.parse(cleaned);
      } catch (error) {
        this.logger.error('LLM generation failed or parsed incorrectly, falling back to mock generator', error);
        worldData = this.generateFallbackWorld(prompt);
      }
    } else {
      this.logger.log(`${this.llmService.provider} is not configured. Using local procedural mock generator...`);
      worldData = this.generateFallbackWorld(prompt);
    }

    // 1. Save metadata to PostgreSQL database
    const world = new World();
    world.prompt = prompt;
    world.generatedContent = worldData.description || 'No description generated.';
    world.metadata = {
      name: worldData.name,
      places: worldData.places,
      characters: worldData.characters,
    };
    
    const savedWorld = await this.worldsRepository.save(world);
    this.logger.log(`Saved world metadata to PostgreSQL database: ${savedWorld.id}`);

    // 2. Save graph triples to LevelGraph
    if (worldData.triples && Array.isArray(worldData.triples)) {
      const triplesToInsert = worldData.triples.map(t => ({
        subject: String(t.subject).trim(),
        predicate: String(t.predicate).trim(),
        object: String(t.object).trim()
      }));

      // Add parent container links
      if (worldData.name) {
        if (worldData.places) {
          worldData.places.forEach((p: string) => {
            triplesToInsert.push({ subject: worldData.name, predicate: 'containsPlace', object: String(p).trim() });
          });
        }
        if (worldData.characters) {
          worldData.characters.forEach((c: string) => {
            triplesToInsert.push({ subject: worldData.name, predicate: 'hasCharacter', object: String(c).trim() });
          });
        }
      }

      try {
        await this.graphService.put(triplesToInsert);
        savedWorld.metadata = { ...savedWorld.metadata, triples: triplesToInsert };
        await this.worldsRepository.save(savedWorld);
        this.logger.log(`Saved ${triplesToInsert.length} triples to LevelGraph`);
      } catch (graphError) {
        this.logger.error('Failed to write triples to LevelGraph database', graphError);
      }
    }

    // 3. Return the response in the exact schema expected by the frontend API route
    return {
      status: 'success',
      generated_content: `**${worldData.name}**\n\n${worldData.description}\n\n**Key Characters:** ${worldData.characters?.join(', ') || 'None'}\n**Key Places:** ${worldData.places?.join(', ') || 'None'}`,
      world_metadata: {
        id: savedWorld.id,
        name: worldData.name,
        places: worldData.places,
        characters: worldData.characters,
        createdAt: savedWorld.createdAt
      }
    };
  }

  async updateWorld(id: string, metadata: any, description?: string, triples?: any[]): Promise<any> {
    this.logger.log(`Updating world metadata for world: ${id}`);
    const world = await this.worldsRepository.findOne({ where: { id } });
    if (!world) {
      throw new Error(`World not found with ID ${id}`);
    }

    world.metadata = metadata;
    if (description) {
      world.generatedContent = description;
    }

    const savedWorld = await this.worldsRepository.save(world);

    if (triples && Array.isArray(triples)) {
      const triplesToInsert = triples.map(t => ({
        subject: String(t.subject).trim(),
        predicate: String(t.predicate).trim(),
        object: String(t.object).trim()
      }));
      try {
        await this.graphService.put(triplesToInsert);
        this.logger.log(`Saved ${triplesToInsert.length} triples to LevelGraph for world update`);
      } catch (graphError) {
        this.logger.error('Failed to write triples to LevelGraph database', graphError);
      }
    }

    return {
      status: 'success',
      world: savedWorld
    };
  }

  async deleteWorld(id: string): Promise<{ deleted: true; id: string }> {
    const world = await this.worldsRepository.findOne({ where: { id } });
    if (!world) {
      throw new NotFoundException({
        code: 'WORLD_NOT_FOUND',
        message: 'The requested world was not found.',
        retryable: false,
      });
    }

    const triples = Array.isArray(world.metadata?.triples)
      ? world.metadata.triples.filter((triple: any) =>
        triple && typeof triple.subject === 'string' && typeof triple.predicate === 'string' && typeof triple.object === 'string')
      : [];
    await this.graphService.del(triples);
    await this.worldsRepository.remove(world);
    this.logger.log(`Deleted world ${id} and ${triples.length} associated graph triples.`);
    return { deleted: true, id };
  }

  async generateElement(worldId: string, elementType: string, dto: GenerateElementDto): Promise<any> {
    this.logger.log(`Generating element of type ${elementType} for world ${worldId} with prompt: "${dto.prompt}"`);
    const world = await this.worldsRepository.findOne({ where: { id: worldId } });
    if (!world) {
      throw new Error(`World not found with ID ${worldId}`);
    }

    const worldName = world.metadata?.name || 'Unnamed World';
    const worldDesc = world.generatedContent || '';

    let parentLocationName = '';
    let parentLocationDesc = '';
    if (dto.parentId && world.metadata?.locations) {
      const parentLoc = world.metadata.locations.find((l: any) => l.id === dto.parentId);
      if (parentLoc) {
        parentLocationName = parentLoc.name;
        parentLocationDesc = parentLoc.description;
      }
    }

    let elementData: any;
    if (this.llmService.isConfigured) {
      try {
        this.logger.log(`Using ${this.llmService.provider} for RPG Element generation...`);

        let contextPrompt = `The overarching world is called "${worldName}". Its setting/description is: "${worldDesc}".`;
        if (dto.parentId && parentLocationName) {
          contextPrompt += ` This new ${elementType} is located/nested directly within the parent location "${parentLocationName}" (which is described as: "${parentLocationDesc}"). Ensure its lore fits the parent context.`;
        }

        const systemPrompt = `You are an RPG World Builder. Generate a new ${elementType} for the RPG campaign world.
${contextPrompt}

You must output a JSON response in the following schema:
{
  "name": "Name of the generated ${elementType}",
  "description": "A description of the generated ${elementType}",
  "relations": [
    {"subject": "Name of the generated ${elementType}", "predicate": "relationType", "object": "Related Entity"}
  ]
}

Ensure the relations list connects this new element to the world or parent location, and other characters, places, or factions where appropriate.
Ensure the JSON is valid. Only return the raw JSON object, no markdown styling. Do not wrap in backticks.`;

        const completion = await this.llmService.complete({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: dto.prompt }
          ],
          responseFormat: 'json',
        });

        const cleaned = this.cleanJsonString(completion.text);
        elementData = JSON.parse(cleaned);
      } catch (error) {
        this.logger.error('LLM generation for element failed, falling back to mock generator', error);
        elementData = this.generateFallbackElement(worldName, elementType, dto.prompt, parentLocationName);
      }
    } else {
      this.logger.log(`${this.llmService.provider} is not configured. Using local procedural mock generator for element...`);
      elementData = this.generateFallbackElement(worldName, elementType, dto.prompt, parentLocationName);
    }

    return {
      status: 'success',
      element: {
        name: elementData.name,
        description: elementData.description,
        relations: elementData.relations || []
      }
    };
  }

  private generateFallbackElement(worldName: string, elementType: string, prompt: string, parentLocationName?: string): any {
    const capitalizedPrompt = prompt.charAt(0).toUpperCase() + prompt.slice(1);
    
    let name = '';
    let description = '';
    let relations: any[] = [];
    
    if (elementType === 'location') {
      name = capitalizedPrompt.includes('Keep') || capitalizedPrompt.includes('City') || capitalizedPrompt.includes('Sanctuary') 
        ? capitalizedPrompt 
        : `The ${capitalizedPrompt} Keep`;
      description = `A location in ${worldName}. It is known as ${name} and is described as: "${prompt}".`;
      relations = [
        { subject: name, predicate: 'locatedIn', object: parentLocationName || worldName }
      ];
    } else if (elementType === 'character') {
      name = `Agent ${capitalizedPrompt}`;
      description = `A notable NPC in ${worldName} who is: "${prompt}".`;
      relations = [
        { subject: name, predicate: 'livesIn', object: parentLocationName || worldName },
        { subject: worldName, predicate: 'hasCharacter', object: name }
      ];
    } else if (elementType === 'organization') {
      name = `The ${capitalizedPrompt} Faction`;
      description = `An influential group operating in ${worldName}, established around: "${prompt}".`;
      relations = [
        { subject: name, predicate: 'operatesIn', object: parentLocationName || worldName }
      ];
    } else if (elementType === 'event') {
      name = `The ${capitalizedPrompt} Conflict`;
      description = `A historic event that shaped ${worldName}: "${prompt}".`;
      relations = [
        { subject: name, predicate: 'occurredIn', object: parentLocationName || worldName }
      ];
    } else { // item
      name = `The ${capitalizedPrompt} Artifact`;
      description = `A relic of power in ${worldName}: "${prompt}".`;
      relations = [
        { subject: name, predicate: 'locatedIn', object: parentLocationName || worldName }
      ];
    }
    
    return { name, description, relations };
  }

}
