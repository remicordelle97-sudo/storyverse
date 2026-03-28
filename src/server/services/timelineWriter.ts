import prisma from "../lib/prisma.js";
import type { GeneratedStory } from "./storyGenerator.js";

export async function writeTimelineEvents(
  storyId: string,
  universeId: string,
  generatedStory: GeneratedStory
): Promise<void> {
  if (
    !generatedStory.timeline_events ||
    generatedStory.timeline_events.length === 0
  ) {
    return;
  }

  // Get all characters in the universe for name matching
  const characters = await prisma.character.findMany({
    where: { universeId },
  });

  const charNameMap = new Map<string, string>();
  for (const c of characters) {
    charNameMap.set(c.name.toLowerCase(), c.id);
    // Also map just the first part of the name (e.g. "Leo" from "Leo the Lion")
    const firstName = c.name.split(" ")[0].toLowerCase();
    charNameMap.set(firstName, c.id);
  }

  for (const event of generatedStory.timeline_events) {
    const characterId = charNameMap.get(event.character_name.toLowerCase());
    if (!characterId) {
      // Skip events for unknown characters
      continue;
    }

    await prisma.timelineEvent.create({
      data: {
        universeId,
        storyId,
        characterId,
        eventSummary: event.event_summary,
        significance: event.significance === "major" ? "major" : "minor",
      },
    });
  }
}
