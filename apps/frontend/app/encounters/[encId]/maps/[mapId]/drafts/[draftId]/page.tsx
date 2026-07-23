import { EncounterAuthoringEditor } from './encounter-authoring-editor';

export default async function EncounterDraftPage({ params }: { params: Promise<{ encId: string; mapId: string; draftId: string }> }) {
  return <EncounterAuthoringEditor {...await params} />;
}
