import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getAdminUsers, impersonateUser, resetUser } from "../api/client";
import { useAuth } from "../auth/AuthContext";

export default function AdminDashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user: currentUser, startImpersonation } = useAuth();
  const [resettingId, setResettingId] = useState<string | null>(null);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: getAdminUsers,
  });

  const handleImpersonate = async (userId: string) => {
    try {
      const { accessToken, user } = await impersonateUser(userId);
      startImpersonation(accessToken, user);
      navigate("/library");
    } catch (e: any) {
      alert(e.message || "Impersonation failed");
    }
  };

  const handleReset = async (u: any) => {
    const ok = confirm(
      `Reset ${u.email}?\n\nThis will delete ${u.storyCount} ${u.storyCount === 1 ? "story" : "stories"} and ${u.universeCount} ${u.universeCount === 1 ? "universe" : "universes"}. ` +
        `They'll be sent through onboarding on their next login. This cannot be undone.`
    );
    if (!ok) return;
    setResettingId(u.id);
    try {
      const result = await resetUser(u.id);
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      alert(
        `Reset complete. Deleted ${result.storiesDeleted} stories and ${result.universesDeleted} universes.`
      );
    } catch (e: any) {
      alert(e.message || "Reset failed");
    } finally {
      setResettingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-amber-950/5">
      {/* Header */}
      <div className="max-w-6xl mx-auto px-4 pt-6 pb-4">
        <div className="flex items-center justify-between">
          <h1
            className="text-3xl font-bold text-amber-900"
            style={{ fontFamily: "Lexend, sans-serif" }}
          >
            Admin Dashboard
          </h1>
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate("/admin/templates")}
              className="text-sm text-amber-800 hover:text-amber-900 transition-colors font-medium"
            >
              Manage default universes
            </button>
            <button
              onClick={() => navigate("/library")}
              className="text-sm text-stone-400 hover:text-stone-600 transition-colors"
            >
              Back to Library
            </button>
          </div>
        </div>
      </div>

      {/* Users table */}
      <div className="max-w-6xl mx-auto px-4 py-4">
        <div className="bg-white rounded-xl shadow-sm border border-stone-200 overflow-hidden">
          {isLoading ? (
            <div className="py-20 text-center">
              <p className="text-stone-400">Loading users...</p>
            </div>
          ) : (
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-stone-200 bg-stone-50">
                  <th className="px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wider">
                    User
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wider">
                    Email
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wider">
                    Plan
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wider">
                    Role
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wider">
                    Universes
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wider">
                    Stories
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wider">
                    Created
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {users.map((u: any) => (
                  <tr key={u.id} className="hover:bg-stone-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {u.picture ? (
                          <img
                            src={u.picture}
                            alt=""
                            className="w-7 h-7 rounded-full"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <div className="w-7 h-7 rounded-full bg-stone-200 flex items-center justify-center text-xs text-stone-500">
                            {u.name?.[0] || "?"}
                          </div>
                        )}
                        <span className="text-sm font-medium text-stone-700">
                          {u.name || "Unknown"}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-stone-500">
                      {u.email}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                          u.plan === "premium"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-stone-100 text-stone-500"
                        }`}
                      >
                        {u.plan}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                          u.role === "admin"
                            ? "bg-red-100 text-red-700"
                            : "bg-stone-100 text-stone-500"
                        }`}
                      >
                        {u.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-stone-600 text-center">
                      {u.universeCount}
                    </td>
                    <td className="px-4 py-3 text-sm text-stone-600 text-center">
                      {u.storyCount}
                    </td>
                    <td className="px-4 py-3 text-sm text-stone-400">
                      {new Date(u.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      {u.id !== currentUser?.id && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleImpersonate(u.id)}
                            className="text-xs px-3 py-1.5 bg-amber-100 text-amber-700 rounded-lg hover:bg-amber-200 transition-colors font-medium"
                          >
                            View
                          </button>
                          <button
                            onClick={() => handleReset(u)}
                            disabled={resettingId === u.id}
                            className="text-xs px-3 py-1.5 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors font-medium disabled:opacity-50"
                          >
                            {resettingId === u.id ? "Resetting..." : "Reset"}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
