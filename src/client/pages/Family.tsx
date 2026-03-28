import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getChildren, addChild, updateChild, deleteChild, getUniverses } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import Chip from "../components/Chip";

const AGE_GROUPS = ["2-4", "5-7", "8-10"];

function ageFromGroup(group: string) {
  const map: Record<string, number> = { "2-4": 3, "5-7": 5, "8-10": 8 };
  return map[group] || 5;
}

interface ChildForm {
  name: string;
  ageGroup: string;
}

export default function FamilyPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const queryClient = useQueryClient();

  const { data: children = [], isLoading } = useQuery({
    queryKey: ["children"],
    queryFn: getChildren,
  });

  const { data: universes = [] } = useQuery({
    queryKey: ["universes"],
    queryFn: getUniverses,
  });

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ChildForm>({ name: "", ageGroup: "" });
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const addMutation = useMutation({
    mutationFn: (data: any) => addChild(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["children"] });
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => updateChild(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["children"] });
      resetForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteChild(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["children"] });
      setConfirmDeleteId(null);
    },
  });

  const resetForm = () => {
    setForm({ name: "", ageGroup: "" });
    setShowForm(false);
    setEditingId(null);
  };

  const handleSubmit = () => {
    if (!form.name.trim() || !form.ageGroup) return;
    const data = { name: form.name, age: ageFromGroup(form.ageGroup), ageGroup: form.ageGroup };
    if (editingId) {
      updateMutation.mutate({ id: editingId, data });
    } else {
      addMutation.mutate(data);
    }
  };

  const startEdit = (child: any) => {
    setEditingId(child.id);
    setForm({ name: child.name, ageGroup: child.ageGroup });
    setShowForm(true);
  };

  const handleChildClick = (child: any) => {
    // Find universes for this child or go to onboarding
    const hasUniverse = universes.length > 0;
    if (hasUniverse) {
      localStorage.setItem("universeId", universes[0].id);
      localStorage.setItem("childId", child.id);
      navigate("/dashboard");
    } else {
      localStorage.setItem("childId", child.id);
      navigate("/onboarding");
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      {/* User bar */}
      <div className="flex items-center justify-end gap-3 mb-8">
        {user?.picture && (
          <img
            src={user.picture}
            alt=""
            className="w-8 h-8 rounded-full"
            referrerPolicy="no-referrer"
          />
        )}
        <span className="text-sm text-stone-600">{user?.name}</span>
        <button
          onClick={async () => {
            await logout();
            navigate("/login");
          }}
          className="text-sm text-stone-400 hover:text-stone-600 transition-colors"
        >
          Sign out
        </button>
      </div>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-stone-800">
          {user?.name ? `${user.name.split(" ")[0]}'s Family` : "My Family"}
        </h1>
        <p className="text-stone-500 mt-1">
          Select a child to view their stories, or manage your family below.
        </p>
      </div>

      {/* Children list */}
      {isLoading ? (
        <p className="text-stone-400">Loading...</p>
      ) : (
        <div className="space-y-3 mb-6">
          {children.map((child: any) => (
            <div
              key={child.id}
              className="bg-white rounded-xl p-5 border border-stone-200 flex items-center justify-between"
            >
              <button
                onClick={() => handleChildClick(child)}
                className="flex items-center gap-4 text-left hover:opacity-80 transition-opacity flex-1"
              >
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-lg">
                  {child.name[0]}
                </div>
                <div>
                  <h3 className="font-semibold text-stone-800">{child.name}</h3>
                  <p className="text-sm text-stone-500">
                    Age {child.age} · {child.ageGroup} years
                  </p>
                </div>
              </button>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => startEdit(child)}
                  className="text-sm text-stone-400 hover:text-primary transition-colors px-2 py-1"
                >
                  Edit
                </button>
                {confirmDeleteId === child.id ? (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => deleteMutation.mutate(child.id)}
                      className="text-sm text-red-600 hover:text-red-700 font-medium px-2 py-1"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="text-sm text-stone-400 hover:text-stone-600 px-2 py-1"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteId(child.id)}
                    className="text-sm text-stone-400 hover:text-red-500 transition-colors px-2 py-1"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          ))}

          {children.length === 0 && !showForm && (
            <div className="bg-white rounded-xl p-8 text-center border border-stone-200">
              <p className="text-stone-400 mb-4">No children added yet</p>
            </div>
          )}
        </div>
      )}

      {/* Add/Edit form */}
      {showForm ? (
        <div className="bg-white rounded-xl p-5 border border-stone-200 mb-4">
          <h3 className="font-semibold text-stone-700 mb-4">
            {editingId ? "Edit child" : "Add a child"}
          </h3>
          <label className="block text-sm font-medium text-stone-700 mb-1">
            Name
          </label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="w-full border border-stone-300 rounded-lg px-4 py-2.5 mb-4 focus:outline-none focus:ring-2 focus:ring-primary/50"
            placeholder="e.g. Mia"
          />
          <label className="block text-sm font-medium text-stone-700 mb-2">
            Age group
          </label>
          <div className="flex gap-2 mb-5">
            {AGE_GROUPS.map((g) => (
              <Chip
                key={g}
                label={g}
                selected={form.ageGroup === g}
                onClick={() => setForm((f) => ({ ...f, ageGroup: g }))}
              />
            ))}
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleSubmit}
              disabled={!form.name.trim() || !form.ageGroup}
              className="px-5 py-2.5 bg-primary text-white rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {editingId ? "Save changes" : "Add child"}
            </button>
            <button
              onClick={resetForm}
              className="px-5 py-2.5 text-stone-600 hover:text-stone-800 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="w-full py-3 border-2 border-dashed border-stone-300 rounded-xl text-stone-500 hover:border-primary hover:text-primary transition-colors font-medium"
        >
          + Add a child
        </button>
      )}
    </div>
  );
}
