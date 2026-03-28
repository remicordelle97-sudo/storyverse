import { Routes, Route, Navigate } from "react-router-dom";
import Onboarding from "./pages/Onboarding";
import Dashboard from "./pages/Dashboard";
import StoryBuilder from "./pages/StoryBuilder";
import ReadingMode from "./pages/ReadingMode";
import Library from "./pages/Library";

export default function App() {
  const universeId = localStorage.getItem("universeId");

  return (
    <div className="min-h-screen bg-stone-50">
      <Routes>
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/story-builder" element={<StoryBuilder />} />
        <Route path="/reading/:storyId" element={<ReadingMode />} />
        <Route path="/library" element={<Library />} />
        <Route
          path="/"
          element={
            universeId ? (
              <Navigate to="/dashboard" replace />
            ) : (
              <Navigate to="/onboarding" replace />
            )
          }
        />
      </Routes>
    </div>
  );
}
