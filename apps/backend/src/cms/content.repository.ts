export type ActorContext = {
  auth0Subject: string;
};

export type WorldContent = {
  id: number;
  externalId: string;
  title: string;
  summary: string;
  body: unknown;
};

export abstract class ContentRepository {
  abstract getWorld(id: number, actor: ActorContext): Promise<WorldContent>;
}
