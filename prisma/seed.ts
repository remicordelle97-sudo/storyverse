import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Clean existing data
  await prisma.timelineEvent.deleteMany();
  await prisma.storyCharacter.deleteMany();
  await prisma.scene.deleteMany();
  await prisma.story.deleteMany();
  await prisma.relationship.deleteMany();
  await prisma.character.deleteMany();
  await prisma.universe.deleteMany();
  await prisma.child.deleteMany();
  await prisma.family.deleteMany();

  const family = await prisma.family.create({
    data: {
      name: "The Johnson Family",
      email: "parent@example.com",
      preferredLanguage: "en",
    },
  });

  const child = await prisma.child.create({
    data: {
      familyId: family.id,
      name: "Mia",
      age: 5,
      ageGroup: "5-7",
    },
  });

  const universe = await prisma.universe.create({
    data: {
      familyId: family.id,
      name: "The Golden Savanna",
      settingDescription:
        "A vast, sun-drenched savanna filled with golden grasses, towering baobab trees, winding rivers, and hidden waterfalls. Home to a community of brave and friendly animals who go on adventures together.",
      themes: JSON.stringify(["lions", "friendship", "exploration", "courage"]),
      mood: "exciting adventures",
      avoidThemes: "No scary villains, no death",
    },
  });

  const leo = await prisma.character.create({
    data: {
      universeId: universe.id,
      name: "Leo the Lion",
      speciesOrType: "Lion",
      personalityTraits: JSON.stringify(["brave", "curious", "kind"]),
      appearance: "A young lion with a golden mane and warm amber eyes",
      specialDetail: "Always carries a tiny blue backpack",
      role: "main",
    },
  });

  const zuri = await prisma.character.create({
    data: {
      universeId: universe.id,
      name: "Zuri the Zebra",
      speciesOrType: "Zebra",
      personalityTraits: JSON.stringify(["funny", "loyal", "cautious"]),
      appearance: "A small zebra with bright eyes and an expressive face",
      specialDetail:
        "Has one stripe that zigzags differently from all the others",
      role: "supporting",
    },
  });

  await prisma.relationship.create({
    data: {
      characterAId: leo.id,
      characterBId: zuri.id,
      description:
        "Best friends since they were young. Leo is braver, Zuri is wiser.",
    },
  });

  // We need a placeholder story for timeline events
  const placeholderStory = await prisma.story.create({
    data: {
      universeId: universe.id,
      childId: child.id,
      title: "The Beginning",
      mood: "exciting adventures",
      ageGroup: "5-7",
      status: "published",
    },
  });

  await prisma.timelineEvent.create({
    data: {
      universeId: universe.id,
      storyId: placeholderStory.id,
      characterId: leo.id,
      eventSummary:
        "Discovered a hidden waterfall at the edge of the savanna",
      significance: "major",
    },
  });

  await prisma.timelineEvent.create({
    data: {
      universeId: universe.id,
      storyId: placeholderStory.id,
      characterId: zuri.id,
      eventSummary:
        "Learned to jump over the wide river on the third try",
      significance: "minor",
    },
  });

  console.log("Seed complete:");
  console.log(`  Family: ${family.name} (${family.id})`);
  console.log(`  Child: ${child.name} (${child.id})`);
  console.log(`  Universe: ${universe.name} (${universe.id})`);
  console.log(`  Characters: ${leo.name}, ${zuri.name}`);
  console.log(`  Timeline events: 2`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
