interface CharacterCardProps {
  character: {
    id: string;
    name: string;
    speciesOrType: string;
    personalityTraits: string;
    appearance: string;
    role: string;
  };
}

export default function CharacterCard({ character }: CharacterCardProps) {
  let traits: string[] = [];
  try {
    traits = JSON.parse(character.personalityTraits);
  } catch {
    traits = [character.personalityTraits];
  }

  return (
    <div className="bg-white rounded-xl p-5 shadow-sm border border-stone-200">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-lg">
          {character.name[0]}
        </div>
        <div>
          <h3 className="font-semibold text-stone-800">{character.name}</h3>
          <p className="text-sm text-stone-500">{character.speciesOrType}</p>
        </div>
        <span className="ml-auto text-xs px-2 py-1 rounded-full bg-secondary/10 text-secondary font-medium">
          {character.role}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {traits.map((trait) => (
          <span
            key={trait}
            className="text-xs px-2.5 py-1 rounded-full bg-stone-100 text-stone-600"
          >
            {trait}
          </span>
        ))}
      </div>
    </div>
  );
}
