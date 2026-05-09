import {
  createContext, // Para gumawa ng context object na pwedeng i-share sa buong app
  useContext,    // Para kunin ang current context value sa custom hook
  useState,      // Para i-hold ang student auth state
  useEffect      // Para mag-run ng side effect kapag nagbago ang student data
} from "react";
import api from "../utils/api";            // Axios instance na may shared base URL + Authorization header para sa general auth requests
import studentApi from "../utils/studentApi"; // Axios instance na may student token interceptor para sa student-only refresh/me requests

const StudentAuthContext = createContext(null); // Context object para sa student auth data

export function StudentAuthProvider({ children }) {
  // ──────────────────────────────────────────────────────
  // STUDENT STATE
  // Nagho-hold ng current naka-login na student
  // Kung may saved data sa localStorage, babasahin agad
  // ──────────────────────────────────────────────────────
  const [student, setStudent] = useState(() => {
    try {
      const stored = localStorage.getItem("smartserve_student");
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const [loading, setLoading] = useState(false); // Para malaman kung naglo-load ang auth action

  // ──────────────────────────────────────────────────────
  // SET AUTH TOKEN SA API HELPER
  // Kapag may student token, automatic na ilalagay sa Authorization header
  // ──────────────────────────────────────────────────────
  useEffect(() => {
    if (student?.token) {
      api.defaults.headers.common["Authorization"] = `Bearer ${student.token}`;
    }
  }, [student]);

  // ──────────────────────────────────────────────────────
  // LOGIN FUNCTION
  // Tatry mag-login gamit ang schoolId at password
  // Pag success, ise-save ang student data at token
  // ──────────────────────────────────────────────────────
  const login = async (schoolId, password) => {
    setLoading(true);
    try {
      const { data } = await api.post("/student/auth/login", { schoolId, password });
      setStudent(data);
      localStorage.setItem("smartserve_student", JSON.stringify(data));
      api.defaults.headers.common["Authorization"] = `Bearer ${data.token}`;
      return { success: true };
    } catch (err) {
      return { success: false, message: err.response?.data?.message || "Login failed" };
    } finally {
      setLoading(false);
    }
  };

  // ──────────────────────────────────────────────────────
  // REFRESH STUDENT FUNCTION
  // Kukunin ang latest student info mula sa server
  // Useful kapag may nagbago sa profile o points
  // ──────────────────────────────────────────────────────
  const refreshStudent = async () => {
    try {
      const { data } = await studentApi.get("/student/auth/me");
      const updated = { ...student, ...data };
      setStudent(updated);
      localStorage.setItem("smartserve_student", JSON.stringify(updated));
    } catch { /* silent */ }
  };

  // ──────────────────────────────────────────────────────
  // LOGOUT FUNCTION
  // Tatanggal ng student session at localStorage data
  // ──────────────────────────────────────────────────────
  const logout = () => {
    setStudent(null);
    localStorage.removeItem("smartserve_student");
  };

  // ──────────────────────────────────────────────────────
  // PROVIDER RETURN
  // Ibinibigay ang auth state at functions sa mga anak components
  // ──────────────────────────────────────────────────────
  return (
    <StudentAuthContext.Provider value={{ student, loading, login, logout, refreshStudent }}>
      {children}
    </StudentAuthContext.Provider>
  );
}

// ──────────────────────────────────────────────────────
// CUSTOM HOOK
// Gamitin sa components para madaling mag-access ng student auth data
// ──────────────────────────────────────────────────────
export function useStudentAuth() {
  const ctx = useContext(StudentAuthContext);
  if (!ctx) throw new Error("useStudentAuth must be used within StudentAuthProvider");
  return ctx;
}
