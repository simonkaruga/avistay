import { useNavigate } from "react-router-dom";
import { Home as HomeIcon } from "lucide-react";

export default function NotFound() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-(--bg-primary) flex flex-col items-center justify-center px-6 pb-24 text-center space-y-5">
      <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto"
        style={{ background: "rgba(31,77,54,0.08)" }}>
        <HomeIcon size={36} style={{ color: "#1f4d36" }} />
      </div>
      <div>
        <h1 className="font-display italic text-3xl text-(--text-primary) mb-2">Lost in Naivasha?</h1>
        <p className="text-(--text-muted) text-sm max-w-xs">
          This page doesn't exist. The lake is still beautiful though.
        </p>
      </div>
      <div className="flex flex-col gap-3 w-full max-w-xs">
        <button onClick={() => navigate("/")}
          className="w-full bg-forest text-white font-bold py-3.5 rounded-2xl text-sm">
          Back to home
        </button>
        <button onClick={() => navigate(-1)}
          className="w-full border border-(--border) text-(--text-muted) py-3.5 rounded-2xl text-sm font-medium">
          Go back
        </button>
      </div>
    </div>
  );
}
