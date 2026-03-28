interface ChipProps {
  label: string;
  selected: boolean;
  onClick: () => void;
}

export default function Chip({ label, selected, onClick }: ChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
        selected
          ? "bg-primary text-white"
          : "bg-white text-stone-700 border border-stone-300 hover:border-primary hover:text-primary"
      }`}
    >
      {label}
    </button>
  );
}
