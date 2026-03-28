interface TimelineEventProps {
  event: {
    id: string;
    eventSummary: string;
    significance: string;
    character: { name: string };
  };
}

export default function TimelineEvent({ event }: TimelineEventProps) {
  return (
    <div className="flex items-start gap-3 py-2">
      <div
        className={`mt-1.5 w-2.5 h-2.5 rounded-full flex-shrink-0 ${
          event.significance === "major" ? "bg-primary" : "bg-stone-300"
        }`}
      />
      <div>
        <span className="text-sm font-medium text-stone-700">
          {event.character.name}
        </span>
        <p className="text-sm text-stone-500">{event.eventSummary}</p>
      </div>
    </div>
  );
}
