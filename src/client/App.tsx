import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import Login from "./pages/Login";
import Library from "./pages/Library";
import NewUniverse from "./pages/NewUniverse";
import UniverseManager from "./pages/UniverseManager";
import StoryBuilder from "./pages/StoryBuilder";
import ReadingMode from "./pages/ReadingMode";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-stone-400">Loading...</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, isAdmin, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-stone-400">Loading...</p>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  if (!isAdmin) return <Navigate to="/library" replace />;

  return <>{children}</>;
}

function AppRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50">
        <p className="text-stone-400">Loading...</p>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/library"
        element={<ProtectedRoute><Library /></ProtectedRoute>}
      />
      <Route
        path="/new-universe"
        element={<ProtectedRoute><NewUniverse /></ProtectedRoute>}
      />
      <Route
        path="/universe-manager"
        element={<AdminRoute><UniverseManager /></AdminRoute>}
      />
      <Route
        path="/story-builder"
        element={<ProtectedRoute><StoryBuilder /></ProtectedRoute>}
      />
      <Route
        path="/reading/:storyId"
        element={<ProtectedRoute><ReadingMode /></ProtectedRoute>}
      />
      <Route
        path="/"
        element={
          user ? <Navigate to="/library" replace /> : <Navigate to="/login" replace />
        }
      />
      {/* Catch-all redirect */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <div className="min-h-screen bg-stone-50">
        <AppRoutes />
      </div>
    </AuthProvider>
  );
}
