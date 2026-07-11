import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { World } from './entities/world.entity';
import { GraphService } from '../graph/graph.service';
import OpenAI from 'openai';

@Injectable()
export class GenerateService {
  private readonly logger = new Logger(GenerateService.name);

  constructor(
    @InjectRepository(World)
    private readonly worldsRepository: Repository<World>,
    private readonly graphService: GraphService,
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

    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey && apiKey.trim().length > 0) {
      try {
        this.logger.log('Using OpenAI API for RPG World generation...');
        const openai = new OpenAI({ apiKey });
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

        const completion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt }
          ],
          response_format: { type: 'json_object' }
        });

        const textResponse = completion.choices[0]?.message?.content;
        this.logger.log('OpenAI API responded. Processing JSON...');
        const cleaned = this.cleanJsonString(textResponse);
        worldData = JSON.parse(cleaned);
      } catch (error) {
        this.logger.error('OpenAI generation failed or parsed incorrectly, falling back to mock generator', error);
        worldData = this.generateFallbackWorld(prompt);
      }
    } else {
      this.logger.log('OPENAI_API_KEY is not set. Using local procedural mock generator...');
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
}
