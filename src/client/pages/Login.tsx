import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { FAQ_ITEMS } from "../components/faqItems";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: any) => void;
          renderButton: (element: HTMLElement, config: any) => void;
        };
      };
    };
  }
}

export default function Login() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const buttonRef = useRef<HTMLDivElement>(null);
  const [showFaq, setShowFaq] = useState(false);

  useEffect(() => {
    if (!loading && user) {
      navigate("/library");
    }
  }, [user, loading, navigate]);

  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => {
      window.google?.accounts.id.initialize({
        client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
        callback: async (response: { credential: string }) => {
          try {
            await login(response.credential);
          } catch {
            console.error("Login failed");
          }
        },
      });

      if (buttonRef.current) {
        window.google?.accounts.id.renderButton(buttonRef.current, {
          theme: "outline",
          size: "large",
          width: 320,
          text: "signin_with",
          shape: "rectangular",
        });
      }
    };
    document.head.appendChild(script);
    return () => {
      document.head.removeChild(script);
    };
  }, [login]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-800">
        <p className="text-stone-400">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
      {/* Background image — cover without stretching */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: "url(/images/MGSLx7zq.jpeg)",
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
      />
      {/* Subtle dark overlay so the login box is readable */}
      <div className="absolute inset-0 bg-black/15" />

      {/* Login card */}
      <div
        className="relative z-10 text-center px-10 py-10 rounded-2xl shadow-2xl"
        style={{
          background: "rgba(255, 253, 247, 0.45)",
          backdropFilter: "blur(8px)",
          border: "1px solid rgba(212, 197, 160, 0.3)",
          maxWidth: "400px",
          width: "100%",
        }}
      >
        {/* Decorative border */}
        <div
          className="absolute inset-3 rounded-xl pointer-events-none"
          style={{ border: "1.5px solid #D4C5A0" }}
        />

        <h1
          className="text-4xl font-bold text-stone-800 mb-2"
          style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
        >
          Storyverse
        </h1>
        <p className="text-stone-500 text-sm mb-6">
          Where every bedtime becomes an adventure
        </p>
        <div className="flex justify-center mb-6">
          <div ref={buttonRef} />
        </div>

        {/* FAQ toggle */}
        <button
          onClick={() => setShowFaq(!showFaq)}
          className="text-xs text-stone-400 hover:text-stone-600 transition-colors relative z-10"
        >
          {showFaq ? "Hide FAQ" : "FAQ"}
        </button>
        {showFaq && (
          <div className="mt-3 text-left space-y-3 relative z-10">
            {FAQ_ITEMS.map((item) => (
              <div key={item.q}>
                <h3 className="text-xs font-semibold text-stone-700">{item.q}</h3>
                <p className="text-[11px] text-stone-500 mt-0.5">{item.a}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
