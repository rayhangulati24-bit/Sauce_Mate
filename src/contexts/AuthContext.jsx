import React, { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  /** If there is no Supabase client, never block UI on "loading" (would hide all auth hero rows). */
  const [loading, setLoading] = useState(() => !!supabase);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    const subscription = data?.subscription;
    supabase.auth
      .getSession()
      .then((result) => {
        const session = result?.data?.session;
        setUser(session?.user ?? null);
      })
      .catch((err) => {
        console.error("Supabase getSession failed:", err);
      })
      .finally(() => {
        setLoading(false);
      });
    return () => {
      try {
        subscription?.unsubscribe();
      } catch (e) {
        console.error("Auth subscription cleanup:", e);
      }
    };
  }, []);

  const signUp = async (email, password, options = {}) => {
    if (!supabase) throw new Error("Supabase not configured");
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: options },
    });
    if (error) throw error;
    return data;
  };

  const signIn = async (email, password) => {
    if (!supabase) throw new Error("Supabase not configured");
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
    return data;
  };

  const signOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  };

  const value = {
    user,
    loading,
    signIn,
    signUp,
    signOut,
    isAuthEnabled: !!supabase,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
