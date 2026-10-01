"use strict";

// Microsoft sign-in through Supabase Auth, on only when the server's
// config.js names a Supabase project (the Railway version). The app stays
// hidden until someone is signed in, and window.appAuth.headers() gives
// app.js the access token the server checks on every /api call.
(function () {
  const config = window.APP_CONFIG || {};
  if (!config.supabaseUrl) return;

  document.documentElement.classList.add("auth-pending");
  let client = null;

  const $ = (id) => document.getElementById(id);

  function showSignedIn(session) {
    document.documentElement.classList.remove("auth-pending");
    $("auth-gate").hidden = true;
    $("auth-bar").hidden = false;
    $("auth-user").textContent = session.user.email || "Signed in";
  }

  function showSignedOut(message) {
    document.documentElement.classList.add("auth-pending");
    $("auth-gate").hidden = false;
    $("auth-bar").hidden = true;
    $("auth-message").textContent = message || "";
  }

  async function start() {
    try {
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
        script.onload = resolve;
        script.onerror = () => reject(new Error("Could not load the sign-in library"));
        document.head.append(script);
      });
    } catch (err) {
      return showSignedOut(err.message);
    }
    client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
    client.auth.onAuthStateChange((_event, session) => (session ? showSignedIn(session) : showSignedOut()));
    const { data } = await client.auth.getSession();
    data.session ? showSignedIn(data.session) : showSignedOut();
    // Microsoft sends errors back in the URL, e.g. when an account isn't allowed.
    const error = new URLSearchParams(location.hash.slice(1) || location.search).get("error_description");
    if (error && !data.session) showSignedOut(error);
  }

  async function signIn() {
    $("auth-message").textContent = "";
    const { error } = await client.auth.signInWithOAuth({
      provider: "azure",
      options: { scopes: "email", redirectTo: location.origin + location.pathname },
    });
    if (error) $("auth-message").textContent = error.message;
  }

  window.appAuth = {
    // Authorization header for this server's /api; empty when signed out.
    async headers() {
      if (!client) return {};
      const { data } = await client.auth.getSession();
      return data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {};
    },
    // The server said the token was refused (expired, or account not allowed).
    async rejected(message) {
      await client.auth.signOut();
      showSignedOut(message);
    },
  };

  document.addEventListener("DOMContentLoaded", () => {
    $("signin-btn").addEventListener("click", signIn);
    $("signout-btn").addEventListener("click", () => client.auth.signOut());
    start();
  });
})();
