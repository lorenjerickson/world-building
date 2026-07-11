"use client";

import { useUser } from "@auth0/nextjs-auth0/client";
import { useState, useEffect } from "react";
import { LandingView } from "@/components/landing-view";
import { DashboardView } from "@/components/dashboard-view";
import { WorldView } from "@/components/world-view";

interface WorldAsset {
  id: string;
  name: string;
  prompt: string;
  description: string;
  createdAt: string;
  places?: string[];
  characters?: string[];
}

export default function Home() {
  const { user, error, isLoading } = useUser();
  const [activeView, setActiveView] = useState<"landing" | "dashboard" | "world">("landing");
  const [activeWorld, setActiveWorld] = useState<WorldAsset | undefined>(undefined);
  const [worldsHistory, setWorldsHistory] = useState<WorldAsset[]>([]);
  const [isDemoUser, setIsDemoUser] = useState(false);
  const [isDemoMode, setIsDemoMode] = useState(false);

  // Enable demo mode by default to prevent developers from being blocked if Auth0 credentials are missing
  useEffect(() => {
    setIsDemoMode(true);
  }, []);

  // Sync Auth0 user to dashboard view
  useEffect(() => {
    if (user) {
      setActiveView("dashboard");
    } else if (!isDemoUser) {
      setActiveView("landing");
    }
  }, [user, isDemoUser]);

  // Load history from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("aethelgard_worlds");
    if (saved) {
      try {
        setWorldsHistory(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse local worlds history", e);
      }
    }
  }, []);

  // Save history helper
  const saveWorldToHistory = (newWorld: WorldAsset) => {
    const updated = [newWorld, ...worldsHistory.filter((w) => w.id !== newWorld.id)];
    setWorldsHistory(updated);
    localStorage.setItem("aethelgard_worlds", JSON.stringify(updated));
  };

  const handleDemoLogin = () => {
    setIsDemoUser(true);
    setActiveView("dashboard");
  };

  const handleLogout = () => {
    if (isDemoUser) {
      setIsDemoUser(false);
      setActiveView("landing");
    } else {
      window.location.href = "/api/auth/logout";
    }
  };

  const handleBeginWorldBuilding = (existingWorld?: WorldAsset) => {
    setActiveWorld(existingWorld);
    setActiveView("world");
  };

  const handleBackToDashboard = (newWorld?: WorldAsset) => {
    if (newWorld) {
      saveWorldToHistory(newWorld);
    }
    setActiveWorld(undefined);
    setActiveView("dashboard");
  };

  if (isLoading) {
    return (
      <div className="loading-screen">
        <div className="crystal-spinner">🔮</div>
        <p>Gazing into the scrying pool...</p>
      </div>
    );
  }

  // Determine active user profile
  const activeUser = user || (isDemoUser ? { name: "Demo GameMaster", email: "demo@aethelgard.net" } : null);

  if (activeView === "landing" && !activeUser) {
    return <LandingView onDemoLogin={handleDemoLogin} isDemoMode={isDemoMode} />;
  }

  if (activeView === "world" && activeUser) {
    return (
      <WorldView
        initialWorld={activeWorld}
        onBackToDashboard={handleBackToDashboard}
      />
    );
  }

  if (activeView === "dashboard" && activeUser) {
    return (
      <DashboardView
        user={activeUser}
        onLogout={handleLogout}
        onBeginWorldBuilding={handleBeginWorldBuilding}
        worldsHistory={worldsHistory}
      />
    );
  }

  return <LandingView onDemoLogin={handleDemoLogin} isDemoMode={isDemoMode} />;
}
