"use client";

interface LandingViewProps {
  onDemoLogin?: () => void;
  isDemoMode?: boolean;
}

export function LandingView({ onDemoLogin, isDemoMode = false }: LandingViewProps) {
  const loginUrl = "/api/auth/login";
  const signupUrl = "/api/auth/login?screen_hint=signup";

  return (
    <div className="landing-container">
      {isDemoMode && (
        <div className="demo-banner">
          <span>⚠️ <strong>Auth0 Demo Mode:</strong> Environment variables not configured in `.env.local`. Registration/Login will run in local simulation mode.</span>
          {onDemoLogin && (
            <button className="demo-bypass-btn" onClick={onDemoLogin}>
              Enter Local Demo
            </button>
          )}
        </div>
      )}

      {/* Hero Section */}
      <header className="landing-hero">
        <span className="eyebrow">The GameMaster's Companion</span>
        <h1>Forge Lore. Build Worlds.</h1>
        <p className="hero-sub">
          An AI-assisted campaign builder and chronicle keeper designed to organize and enrich your tabletop tabletop RPG campaigns. Connect factions, characters, and realms in a semantic lore graph.
        </p>
        
        <div className="hero-actions">
          {isDemoMode ? (
            <button className="primary-action btn-lg" onClick={onDemoLogin}>
              Begin World Building (Demo)
            </button>
          ) : (
            <a href={loginUrl} className="primary-action btn-lg">
              Begin World Building
            </a>
          )}
          <div className="auth-row">
            <span>Already have an account?</span>
            {isDemoMode ? (
              <button className="link-btn" onClick={onDemoLogin}>Log In</button>
            ) : (
              <a href={loginUrl} className="link-btn">Log In</a>
            )}
            <span className="divider">|</span>
            {isDemoMode ? (
              <button className="link-btn" onClick={onDemoLogin}>Register</button>
            ) : (
              <a href={signupUrl} className="link-btn">Register</a>
            )}
          </div>
        </div>
      </header>

      {/* Product Features Grid */}
      <section className="features-grid">
        <div className="feature-card">
          <div className="feature-icon">✨</div>
          <h3>AI-Assisted Storytelling</h3>
          <p>
            Co-create with an advanced AI assistant. Generate rich campaign backstories, describe mystical relics, and detail historical conflicts using simple natural language prompts.
          </p>
        </div>

        <div className="feature-card">
          <div className="feature-icon">📜</div>
          <h3>Chronicle Keeper</h3>
          <p>
            Maintain a persistent, searchable archive of all your realms, kingdoms, factions, and items. Log and organize every creation so you can reference it mid-session.
          </p>
        </div>

        <div className="feature-card">
          <div className="feature-icon">🕸️</div>
          <h3>Everything Connected</h3>
          <p>
            Track how characters, locations, and groups connect. Define relations like <em>ruler of</em>, <em>allied with</em>, or <em>nemesis of</em>, and view your campaign as an interactive network of links.
          </p>
        </div>
      </section>

      {/* CTA Footer */}
      <footer className="landing-footer">
        <h2>Ready to build your next campaign?</h2>
        <p>Join other GameMasters and players in crafting deep, interconnected lore in minutes.</p>
        <div className="footer-actions">
          {isDemoMode ? (
            <button className="primary-action" onClick={onDemoLogin}>
              Create Free Account
            </button>
          ) : (
            <a href={signupUrl} className="primary-action">
              Create Free Account
            </a>
          )}
        </div>
      </footer>
    </div>
  );
}
