import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Clean existing data
  await prisma.storyCharacter.deleteMany();
  await prisma.scene.deleteMany();
  await prisma.story.deleteMany();
  await prisma.relationship.deleteMany();
  await prisma.character.deleteMany();
  await prisma.universe.deleteMany();
  await prisma.user.deleteMany();

  const user = await prisma.user.create({
    data: {
      googleId: "demo-user",
      email: "demo@example.com",
      name: "Demo User",
    },
  });

  const universe = await prisma.universe.create({
    data: {
      userId: user.id,
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

  console.log("Seed complete:");
  console.log(`  User: ${user.name} (${user.id})`);
  console.log(`  Universe: ${universe.name} (${universe.id})`);
  console.log(`  Characters: ${leo.name}, ${zuri.name}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
