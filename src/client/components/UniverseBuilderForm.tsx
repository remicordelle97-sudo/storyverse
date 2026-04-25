import { useState } from "react";

const THEME_OPTIONS = [
  "Space",
  "Ocean",
  "Forest",
  "Fairy tale",
  "Magic",
  "Dinosaurs",
  "Robots",
  "Farm",
  "Sports",
  "Everyday adventures",
];

const TRAIT_OPTIONS = [
  "Brave",
  "Curious",
  "Shy",
  "Funny",
  "Kind",
  "Clever",
  "Caring",
  "Mischievous",
  "Determined",
  "Gentle",
];

export interface CharacterPhoto {
  mimeType: string;
  data: string; // raw base64 (no "data:..." prefix)
  previewUrl: string; // data:image/...;base64,... for the <img> preview
}

interface ManualSupporting {
  name: string;
  species: string;
  traits: string[];
  customTrait: string;
  photo: CharacterPhoto | null;
}

export interface UniverseBuilderPayload {
  universeName: string;
  themes: string[];
  hero: {
    name: string;
    species: string;
    traits: string[];
    photo?: { mimeType: string; data: string };
  };
  supporting:
    | "auto"
    | {
        name: string;
        species: string;
        traits: string[];
        photo?: { mimeType: string; data: string };
      }[];
}

const ALLOWED_PHOTO_MIME = ["image/jpeg", "image/png", "image/webp"];
const MAX_PHOTO_BYTES = 4 * 1024 * 1024; // 4MB raw → ~5.5MB base64

async function readPhotoFile(file: File): Promise<CharacterPhoto> {
  if (!ALLOWED_PHOTO_MIME.includes(file.type)) {
    throw new Error("Please upload a JPG, PNG, or WebP image.");
  }
  if (file.size > MAX_PHOTO_BYTES) {
    throw new Error("Photo is too large (max 4MB).");
  }
  const dataUrl: string = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
  const [meta, raw] = dataUrl.split(",");
  const match = meta.match(/data:(.+?);base64/);
  if (!match) throw new Error("Could not read image data.");
  return { mimeType: match[1], data: raw, previewUrl: dataUrl };
}

interface UniverseBuilderFormProps {
  onSubmit: (payload: UniverseBuilderPayload) => Promise<void>;
  onCancel?: () => void;
  cancelLabel?: string;
  submitLabel?: string;
  title?: string;
  subtitle?: string;
}

/**
 * Reusable universe-builder form. Used both during onboarding (step 2)
 * and on the /new-universe page so the two flows are consistent.
 */
export default function UniverseBuilderForm({
  onSubmit,
  onCancel,
  cancelLabel = "Back",
  submitLabel = "Confirm",
  title = "Build your world",
  subtitle = "Choose a name, themes, and a hero. We'll handle the rest.",
}: UniverseBuilderFormProps) {
  const [universeName, setUniverseName] = useState("");
  const [themes, setThemes] = useState<string[]>([]);
  const [customTheme, setCustomTheme] = useState("");

  const [heroName, setHeroName] = useState("");
  const [heroSpecies, setHeroSpecies] = useState("");
  const [heroTraits, setHeroTraits] = useState<string[]>([]);
  const [heroCustomTrait, setHeroCustomTrait] = useState("");
  const [heroPhoto, setHeroPhoto] = useState<CharacterPhoto | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const [supportingMode, setSupportingMode] = useState<"auto" | "manual">("auto");
  const [manualSupporting, setManualSupporting] = useState<ManualSupporting[]>([
    { name: "", species: "", traits: [], customTrait: "", photo: null },
    { name: "", species: "", traits: [], customTrait: "", photo: null },
    { name: "", species: "", traits: [], customTrait: "", photo: null },
  ]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleTheme(t: string) {
    setThemes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }
  function toggleHeroTrait(t: string) {
    setHeroTraits((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }
  function updateSupporting(i: number, patch: Partial<ManualSupporting>) {
    setManualSupporting((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }
  function toggleSupportingTrait(i: number, t: string) {
    updateSupporting(i, {
      traits: manualSupporting[i].traits.includes(t)
        ? manualSupporting[i].traits.filter((x) => x !== t)
        : [...manualSupporting[i].traits, t],
    });
  }

  function combineWithCustom(list: string[], custom: string) {
    const trimmed = custom.trim();
    const filtered = list.filter((x) => x !== "Other");
    return list.includes("Other") && trimmed ? [...filtered, trimmed] : filtered;
  }

  const finalThemes = combineWithCustom(themes, customTheme);
  const finalHeroTraits = combineWithCustom(heroTraits, heroCustomTrait);

  const canSubmit =
    universeName.trim().length > 0 &&
    finalThemes.length > 0 &&
    heroName.trim().length > 0 &&
    heroSpecies.trim().length > 0 &&
    finalHeroTraits.length > 0 &&
    (supportingMode === "auto" ||
      manualSupporting.every(
        (s) =>
          s.name.trim() &&
          s.species.trim() &&
          combineWithCustom(s.traits, s.customTrait).length > 0
      ));

  // Strip the previewUrl before sending — server only needs mimeType + raw base64.
  function stripPreview(p: CharacterPhoto | null) {
    if (!p) return undefined;
    return { mimeType: p.mimeType, data: p.data };
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const supporting =
        supportingMode === "auto"
          ? "auto"
          : manualSupporting.map((s) => ({
              name: s.name.trim(),
              species: s.species.trim(),
              traits: combineWithCustom(s.traits, s.customTrait),
              photo: stripPreview(s.photo),
            }));
      await onSubmit({
        universeName: universeName.trim(),
        themes: finalThemes,
        hero: {
          name: heroName.trim(),
          species: heroSpecies.trim(),
          traits: finalHeroTraits,
          photo: stripPreview(heroPhoto),
        },
        supporting,
      });
    } catch (e: any) {
      setError(e?.message || "Something went wrong");
      setSubmitting(false);
    }
  }

  async function handleHeroPhoto(file: File | null) {
    setPhotoError(null);
    if (!file) {
      setHeroPhoto(null);
      return;
    }
    try {
      setHeroPhoto(await readPhotoFile(file));
    } catch (e: any) {
      setPhotoError(e?.message || "Could not read photo");
      setHeroPhoto(null);
    }
  }

  async function handleSupportingPhoto(i: number, file: File | null) {
    setPhotoError(null);
    if (!file) {
      updateSupporting(i, { photo: null });
      return;
    }
    try {
      const photo = await readPhotoFile(file);
      updateSupporting(i, { photo });
    } catch (e: any) {
      setPhotoError(e?.message || "Could not read photo");
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-stone-200 p-6 sm:p-8 shadow-sm space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-stone-800 mb-1">{title}</h2>
        {subtitle && <p className="text-sm text-stone-500">{subtitle}</p>}
      </div>

      <Field label="Universe name">
        <input
          value={universeName}
          onChange={(e) => setUniverseName(e.target.value)}
          maxLength={60}
          placeholder="e.g. The Whispering Woods"
          className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
        />
      </Field>

      <Field label="Themes" hint="Pick one or more.">
        <ChipPicker
          options={[...THEME_OPTIONS, "Other"]}
          selected={themes}
          onToggle={toggleTheme}
        />
        {themes.includes("Other") && (
          <input
            value={customTheme}
            onChange={(e) => setCustomTheme(e.target.value)}
            placeholder="Tell us more..."
            className="mt-3 w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          />
        )}
      </Field>

      <div>
        <h3 className="text-sm font-medium text-stone-700 mb-3">Hero</h3>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Name">
            <input
              value={heroName}
              onChange={(e) => setHeroName(e.target.value)}
              maxLength={40}
              placeholder="e.g. Mia"
              className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </Field>
          <Field label="Species or type">
            <input
              value={heroSpecies}
              onChange={(e) => setHeroSpecies(e.target.value)}
              maxLength={40}
              placeholder="e.g. Rabbit, Robot, Dragon"
              className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </Field>
        </div>
        <div className="mt-4">
          <Field label="Traits" hint="Pick one or more.">
            <ChipPicker
              options={[...TRAIT_OPTIONS, "Other"]}
              selected={heroTraits}
              onToggle={toggleHeroTrait}
            />
            {heroTraits.includes("Other") && (
              <input
                value={heroCustomTrait}
                onChange={(e) => setHeroCustomTrait(e.target.value)}
                placeholder="Tell us more..."
                className="mt-3 w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              />
            )}
          </Field>
        </div>
        <div className="mt-4">
          <Field
            label="Photo (optional)"
            hint="If your hero is a real toy, upload a photo. We'll use it to design the character. Plain background, well-lit works best."
          >
            <PhotoUpload
              photo={heroPhoto}
              onChange={handleHeroPhoto}
            />
          </Field>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium text-stone-700 mb-3">Supporting characters</h3>
        <div className="flex gap-2 mb-4">
          <ToggleButton
            active={supportingMode === "auto"}
            onClick={() => setSupportingMode("auto")}
          >
            Auto-create
          </ToggleButton>
          <ToggleButton
            active={supportingMode === "manual"}
            onClick={() => setSupportingMode("manual")}
          >
            I'll add my own
          </ToggleButton>
        </div>
        {supportingMode === "auto" ? (
          <p className="text-xs text-stone-400">
            We'll invent three friends that fit your world.
          </p>
        ) : (
          <div className="space-y-5">
            {manualSupporting.map((s, i) => (
              <div key={i} className="border border-stone-200 rounded-lg p-4 space-y-3">
                <p className="text-xs font-medium text-stone-500 uppercase tracking-wider">
                  Friend {i + 1}
                </p>
                <div className="grid sm:grid-cols-2 gap-3">
                  <Field label="Name">
                    <input
                      value={s.name}
                      onChange={(e) => updateSupporting(i, { name: e.target.value })}
                      maxLength={40}
                      placeholder="e.g. Pip"
                      className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                    />
                  </Field>
                  <Field label="Species or type">
                    <input
                      value={s.species}
                      onChange={(e) => updateSupporting(i, { species: e.target.value })}
                      maxLength={40}
                      placeholder="e.g. Owl"
                      className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                    />
                  </Field>
                </div>
                <Field label="Traits">
                  <ChipPicker
                    options={[...TRAIT_OPTIONS, "Other"]}
                    selected={s.traits}
                    onToggle={(t) => toggleSupportingTrait(i, t)}
                  />
                  {s.traits.includes("Other") && (
                    <input
                      value={s.customTrait}
                      onChange={(e) => updateSupporting(i, { customTrait: e.target.value })}
                      placeholder="Tell us more..."
                      className="mt-3 w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                    />
                  )}
                </Field>
                <Field label="Photo (optional)">
                  <PhotoUpload
                    photo={s.photo}
                    onChange={(file) => handleSupportingPhoto(i, file)}
                  />
                </Field>
              </div>
            ))}
          </div>
        )}
      </div>

      {photoError && <p className="text-xs text-red-500">{photoError}</p>}
      {error && <p className="text-xs text-red-500">{error}</p>}

      <div className="flex justify-between items-center pt-2">
        {onCancel ? (
          <button
            onClick={onCancel}
            className="text-sm text-stone-500 hover:text-stone-700 transition-colors"
            disabled={submitting}
          >
            &larr; {cancelLabel}
          </button>
        ) : (
          <span />
        )}
        <button
          onClick={handleSubmit}
          disabled={!canSubmit || submitting}
          className="px-5 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {submitting ? "Working..." : submitLabel}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-stone-600 mb-2">
        {label}
        {hint && <span className="ml-1 text-stone-400 font-normal">— {hint}</span>}
      </label>
      {children}
    </div>
  );
}

function ChipPicker({
  options,
  selected,
  onToggle,
}: {
  options: string[];
  selected: string[];
  onToggle: (option: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const isSelected = selected.includes(o);
        return (
          <button
            key={o}
            onClick={() => onToggle(o)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
              isSelected
                ? "border-primary bg-primary text-white"
                : "border-stone-200 bg-white text-stone-600 hover:border-primary/40"
            }`}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
        active
          ? "border-primary bg-primary/5 text-stone-800"
          : "border-stone-200 bg-white text-stone-500 hover:border-primary/30"
      }`}
    >
      {active ? children : children}
    </button>
  );
}

function PhotoUpload({
  photo,
  onChange,
}: {
  photo: CharacterPhoto | null;
  onChange: (file: File | null) => void;
}) {
  if (photo) {
    return (
      <div className="flex items-center gap-3">
        <img
          src={photo.previewUrl}
          alt="Uploaded"
          className="w-20 h-20 object-cover rounded-lg border border-stone-200"
        />
        <button
          type="button"
          onClick={() => onChange(null)}
          className="text-xs text-stone-500 hover:text-red-500 transition-colors"
        >
          Remove photo
        </button>
      </div>
    );
  }
  return (
    <label className="inline-flex items-center gap-2 px-3 py-2 text-xs border border-dashed border-stone-300 rounded-lg cursor-pointer hover:border-primary hover:text-primary text-stone-500 transition-colors">
      <span>Upload photo</span>
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => onChange(e.target.files?.[0] || null)}
      />
    </label>
  );
}
