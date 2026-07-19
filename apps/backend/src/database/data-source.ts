import 'dotenv/config';
import { DataSource } from 'typeorm';

import { applicationEntities } from './entities';
import { applicationMigrations } from './migrations';

export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL || 'postgresql://worldbuilder:password123@localhost:5432/worlddb',
  entities: applicationEntities,
  migrations: applicationMigrations,
  migrationsRun: false,
  synchronize: false,
});
