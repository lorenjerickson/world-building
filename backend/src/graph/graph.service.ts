import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class GraphService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GraphService.name);
  private db: any;

  async onModuleInit() {
    try {
      this.logger.log('Initializing LevelGraph and LevelDB...');
      const dataDir = path.join(process.cwd(), 'data');
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      const dbPath = path.join(dataDir, 'levelgraph-db');

      // Load CommonJS modules to ensure compatibility with Node.js 24 runtime
      const { Level } = require('level');
      const levelgraph = require('levelgraph');

      this.db = levelgraph(new Level(dbPath));
      this.logger.log(`LevelGraph initialized successfully at path: ${dbPath}`);
    } catch (error) {
      this.logger.error('Failed to initialize LevelGraph:', error);
      throw error;
    }
  }

  async onModuleDestroy() {
    if (this.db && typeof this.db.close === 'function') {
      this.logger.log('Closing LevelGraph database...');
      try {
        await this.db.close();
      } catch (err) {
        this.logger.error('Error closing LevelGraph database', err);
      }
    }
  }

  async put(triples: any | any[]): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.put(triples, (err: any) => {
        if (err) {
          this.logger.error('Failed to write triple to LevelGraph', err);
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async del(triples: any | any[]): Promise<void> {
    const values = Array.isArray(triples) ? triples : [triples];
    if (!values.length) return;
    return new Promise((resolve, reject) => {
      this.db.del(values, (err: any) => {
        if (err) {
          this.logger.error('Failed to delete triples from LevelGraph', err);
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async get(pattern: any): Promise<any[]> {
    return new Promise((resolve, reject) => {
      this.db.get(pattern, (err: any, list: any[]) => {
        if (err) {
          this.logger.error('Failed to fetch from LevelGraph', err);
          reject(err);
        } else {
          resolve(list || []);
        }
      });
    });
  }

  async search(patterns: any[]): Promise<any[]> {
    return new Promise((resolve, reject) => {
      this.db.search(patterns, (err: any, results: any[]) => {
        if (err) {
          this.logger.error('Failed to query LevelGraph', err);
          reject(err);
        } else {
          resolve(results || []);
        }
      });
    });
  }

  v(name: string) {
    if (!this.db || typeof this.db.v !== 'function') {
      throw new Error('LevelGraph is not fully initialized');
    }
    return this.db.v(name);
  }
}
