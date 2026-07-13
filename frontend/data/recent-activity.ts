export interface CampaignSummary {
  id: string;
  title: string;
  system: string;
  activeSessions: number;
  updatedAt: string;
  changeSummary: string;
}

export interface SessionSummary {
  id: string;
  campaignId: string;
  title: string;
  playedAt: string;
  summary: string;
  highlights: string[];
}

export const campaigns: CampaignSummary[] = [
  { id: "c1", title: "The Shattered Crown", system: "D&D 5e", activeSessions: 12, updatedAt: "2026-07-10", changeSummary: "Added the Obsidian Keep encounter and updated three faction relationships." },
  { id: "c2", title: "Shadows of Aethelgard", system: "Pathfinder 2e", activeSessions: 8, updatedAt: "2026-07-06", changeSummary: "Advanced the Whispering Woods arc and prepared the ranger council." },
  { id: "c3", title: "Netrunner's Heist", system: "Cyberpunk RED", activeSessions: 4, updatedAt: "2026-06-29", changeSummary: "Revised the vault security clock and added two rival netrunners." },
];

export const sessions: SessionSummary[] = [
  { id: "s12", campaignId: "c1", title: "The Crown Beneath the Keep", playedAt: "2026-07-10", summary: "The party entered the flooded crypt, bargained with its guardian, and recovered the second crown fragment.", highlights: ["The crypt guardian became an uneasy ally", "A crown fragment revealed a map to Glassmere", "Sylvia was marked by the old king"] },
  { id: "s8", campaignId: "c2", title: "Council Under Whispering Boughs", playedAt: "2026-07-06", summary: "The heroes won the woodland council's support, but promised to resolve the blight before the next moon.", highlights: ["The ranger council pledged scouts", "The blight gained a visible countdown", "A hidden Obsidian Order agent escaped"] },
  { id: "s4", campaignId: "c3", title: "Ghosts in the Black ICE", playedAt: "2026-06-29", summary: "The crew breached the first security layer and learned their anonymous client has ties to the target corporation.", highlights: ["The vault architecture was mapped", "A rival netrunner identified the crew", "The client connection was exposed"] },
];

export function worldIdForIndex(worldIds: string[], index: number) {
  return worldIds.length > 0 ? worldIds[index % worldIds.length] : undefined;
}
