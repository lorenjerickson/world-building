CREATE TABLE "search_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "actorId" varchar NOT NULL,
  "recordType" varchar NOT NULL,
  "recordId" varchar NOT NULL,
  "title" varchar NOT NULL,
  "summary" text NOT NULL,
  "href" varchar NOT NULL,
  "searchableText" text NOT NULL,
  "searchVector" tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("summary", '')), 'B') ||
    setweight(to_tsvector('english', coalesce("searchableText", '')), 'C')
  ) STORED,
  "updatedAt" timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "UQ_search_document_actor_record"
    UNIQUE ("actorId", "recordType", "recordId")
);

CREATE INDEX "IDX_search_document_actor"
  ON "search_documents" ("actorId");

CREATE INDEX "IDX_search_document_vector"
  ON "search_documents" USING GIN ("searchVector");
