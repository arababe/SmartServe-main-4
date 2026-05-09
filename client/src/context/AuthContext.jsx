import { createContext, useContext, useState, useEffect } from "react";
import api from "../utils/api";

// ──────────────────────────────────────────────────────
// AUTHENTICATION CONTEXT
// Ginagamit para i-share ang login state sa buong app
// Lahat ng components na need ng user info ay pwede mag-access dito
// ──────────────────────────────────────────────────────

const AuthContext = createContext(null);

// ──────────────────────────────────────────────────────
// AUTH PROVIDER COMPONENT
// Ito ang nagbibigay ng authentication data sa lahat ng child components
// Dito ginagawa ang login, register, logout functions
// ──────────────────────────────────────────────────────
export function AuthProvider({ children }) {
  // ──────────────────────────────────────────────────────
  // USER STATE - nagse-save ng current logged-in user
  // Kapag nag-refresh ang page, babalik pa rin ang user data
  // ──────────────────────────────────────────────────────
  const [user, setUser] = useState(() => {
    try {
      // Kunin ang saved user data from localStorage
      const stored = localStorage.getItem("smartserve_user");
      // Kapag may saved data, i-convert to object, else null
      return stored ? JSON.parse(stored) : null;
    } catch {
      // Kapag may error sa localStorage, return null
      return null;
    }
  });

  // ──────────────────────────────────────────────────────
  // LOADING STATE - para sa loading spinner habang naglo-login/register
  // ──────────────────────────────────────────────────────
  const [loading, setLoading] = useState(false);

  // ──────────────────────────────────────────────────────
  // AUTO-SETUP NG AUTHORIZATION HEADER
  // Kapag may user na, automatic na lagyan ng Bearer token ang lahat ng API calls
  // ──────────────────────────────────────────────────────
  useEffect(() => {
    if (user?.token) {
      // May token? Lagyan ng Authorization header ang lahat ng API requests
      api.defaults.headers.common["Authorization"] = `Bearer ${user.token}`;
    } else {
      // Walang token? Tanggalin ang Authorization header
      delete api.defaults.headers.common["Authorization"];
    }
  }, [user]);

  // ──────────────────────────────────────────────────────
  // LOGIN FUNCTION - para mag-sign in ang user
  // ──────────────────────────────────────────────────────
  const login = async (username, password) => {
    setLoading(true); // Ipakita na loading
    try {
      // I-send ang username at password sa server
      const { data } = await api.post("/auth/login", { username, password });
      // I-save ang user data sa state
      setUser(data);
      // I-save sa localStorage para di mawala pag refresh
      localStorage.setItem("smartserve_user", JSON.stringify(data));
      // I-set ang authorization header para sa future API calls
      api.defaults.headers.common["Authorization"] = `Bearer ${data.token}`;
      return { success: true }; // Success!
    } catch (err) {
      // May error? Return the error message
      return { success: false, message: err.response?.data?.message || "Login failed" };
    } finally {
      setLoading(false); // Itigil ang loading
    }
  };

  // ──────────────────────────────────────────────────────
  // REGISTER FUNCTION - para mag-sign up ang user
  // Hindi automatic na maglo-login, kailangan pa approve ng admin
  // ──────────────────────────────────────────────────────
  const register = async (formData) => {
    setLoading(true); // Ipakita na loading
    try {
      // I-send ang registration form sa server
      const { data } = await api.post("/auth/register", formData);
      // HINDI mag-sign in automatically - kailangan approve muna ng admin
      return { success: true, message: data.message, isApproved: data.isApproved };
    } catch (err) {
      // May error? Return the error message
      return { success: false, message: err.response?.data?.message || "Registration failed" };
    } finally {
      setLoading(false); // Itigil ang loading
    }
  };

  // ──────────────────────────────────────────────────────
  // LOGOUT FUNCTION - para mag-sign out ang user
  // ──────────────────────────────────────────────────────
  const logout = () => {
    setUser(null); // Tanggalin ang user data
    localStorage.removeItem("smartserve_user"); // Tanggalin sa localStorage
    delete api.defaults.headers.common["Authorization"]; // Tanggalin ang auth header
  };

  // ──────────────────────────────────────────────────────
  // PROVIDER RETURN - ibibigay ang auth data sa lahat ng child components
  // ──────────────────────────────────────────────────────
  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

// ──────────────────────────────────────────────────────
// USE AUTH HOOK - para madaling mag-access ng auth data sa components
// Gagamitin sa loob ng AuthProvider lang
// ──────────────────────────────────────────────────────
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
