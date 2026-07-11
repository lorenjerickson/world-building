import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('worlds')
export class World {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  prompt: string;

  @Column({ type: 'text' })
  generatedContent: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: any;

  @CreateDateColumn()
  createdAt: Date;
}
