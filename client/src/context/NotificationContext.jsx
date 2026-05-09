import {
  createContext,     // Gumagawa ng React Context para i-share ang notification data
  useContext,        // Ginagamit sa useNotifications hook para kunin ang context value
  useState,          // Para sa notifications array at unread count state
  useEffect,         // Para sa Socket.IO connection at cleanup
  useRef,            // Para sa socket reference at latest notification ID tracker
  useCallback        // Para i-memoize ang functions (fetchNotifications, markAllRead, markOneRead)
} from "react";
import { io } from "socket.io-client";  // Para sa real-time WebSocket connection
import toast from "react-hot-toast";     // Para sa popup notification toasts
import api from "../utils/api";          // Custom API utility para sa HTTP requests

// ──────────────────────────────────────────────────────
// NOTIFICATION CONTEXT
// Ginagamit para i-manage ang notifications sa buong app
// May real-time updates via Socket.IO at fallback na polling
// ──────────────────────────────────────────────────────

const NotificationContext = createContext(null);

// ──────────────────────────────────────────────────────
// TYPE LABEL MAP - para sa notification labels
// Ginagamit para i-convert ang notification type sa readable text
// ──────────────────────────────────────────────────────
const TYPE_LABEL = {
  order_placed:    "New Order",        // Bagong order
  order_status:    "Order Update",     // Update sa order status
  byoc_awarded:    "Eco Points",       // Eco points awarded
  reward_redeemed: "Reward Redeemed",  // Reward redeemed
};

/**
 * role  : "admin" | "student" - kung sino ang user
 * token : JWT string - para sa authentication
 * id    : user/student ObjectId string (students only) - student ID
 */
export function NotificationProvider({ role, token, id, onNotification, children }) {
  // ──────────────────────────────────────────────────────
  // STATE VARIABLES
  // ──────────────────────────────────────────────────────

  // Listahan ng lahat ng notifications
  const [notifications, setNotifications] = useState([]);

  // Bilang ng unread notifications (para sa badge)
  const [unread, setUnread] = useState(0);

  // Reference sa Socket.IO connection
  const socketRef = useRef(null);

  // Track ng pinakabagong notification ID na na-toast na
  // Para di mag-re-toast kapag nagpo-poll
  const latestIdRef = useRef(null);

  // In local dev, connect to the same origin so Vite proxies the socket to the backend.
  // In production (Vercel serverless), socket.io is unavailable — skip entirely unless
  // an explicit VITE_SOCKET_URL is configured.
  const isLocalDev = typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

  let SOCKET_URL = null;
  if (import.meta.env.VITE_SOCKET_URL) {
    // May explicit na socket URL sa environment
    SOCKET_URL = import.meta.env.VITE_SOCKET_URL;
  } else if (isLocalDev) {
    // Local dev: same origin, Vite will proxy to backend
    SOCKET_URL = window.location.origin;
  }

  // ──────────────────────────────────────────────────────
  // FETCH NOTIFICATIONS FUNCTION
  // Kuha ng notifications from REST API
  // ──────────────────────────────────────────────────────
  const fetchNotifications = useCallback(async () => {
    if (!token) return; // Walang token? Wag mag-fetch
    try {
      // Different endpoint para admin vs student
      const endpoint = role === "admin" ? "/notifications/admin" : "/notifications/student";
      const { data } = await api.get(endpoint, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const incoming = data.notifications || [];

      // On subsequent polls, toast any notifications newer than what we last saw
      if (latestIdRef.current !== null && incoming.length > 0) {
        // Kunin ang mga ID na meron na
        const prevIds = new Set(
          notifications.map ? notifications.map((n) => n._id) : []
        );
        // Filter ang mga brand new at unread
        const brandNew = incoming.filter((n) => !prevIds.has(n._id) && !n.read);
        brandNew.forEach((n) => {
          if (onNotification) onNotification(n); // Callback function
          toast(n.body, { // Ipakita ang toast notification
            icon: role === "admin" ? "🔔" : "✨",
            duration: 4000,
            style: { fontSize: "13px", maxWidth: "320px" },
          });
        });
      }

      // Update ang latest ID tracker
      if (incoming.length > 0) latestIdRef.current = incoming[0]._id;
      setNotifications(incoming); // Update ang notifications list
      setUnread(data.unread || 0); // Update ang unread count
    } catch {
      // Non-fatal error, wag i-interrupt ang app
    }
  }, [token, role]); // eslint-disable-line react-hooks/exhaustive-deps

  // ──────────────────────────────────────────────────────
  // MARK ALL READ FUNCTION
  // Gawin read lahat ng notifications
  // ──────────────────────────────────────────────────────
  const markAllRead = useCallback(async () => {
    if (!token) return;
    try {
      // Different endpoint para admin vs student
      const endpoint = role === "admin" ? "/notifications/admin/read-all" : "/notifications/student/read-all";
      await api.patch(endpoint, {}, {
        headers: { Authorization: `Bearer ${token}` },
      });
      // Update ang local state - mark all as read
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnread(0); // Reset unread count to 0
    } catch {
      // Silent fail, wag i-interrupt ang user
    }
  }, [token, role]);

  // ──────────────────────────────────────────────────────
  // MARK ONE READ FUNCTION
  // Gawin read ang isang specific notification
  // ──────────────────────────────────────────────────────
  const markOneRead = useCallback(async (notifId) => {
    try {
      // Mark as read sa server
      await api.patch(`/notifications/${notifId}/read`, {}, {
        headers: { Authorization: `Bearer ${token}` },
      });
      // Update ang local state
      setNotifications((prev) =>
        prev.map((n) => (n._id === notifId ? { ...n, read: true } : n))
      );
      // Bawasan ang unread count
      setUnread((c) => Math.max(0, c - 1));
    } catch {
      // Silent fail
    }
  }, [token]);

  // ──────────────────────────────────────────────────────
  // SOCKET.IO CONNECTION OR POLLING FALLBACK
  // Real-time notifications via WebSocket, or polling every 8 seconds
  // ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!token) return;

    fetchNotifications(); // Initial fetch

    if (!SOCKET_URL) {
      // Vercel serverless: poll every 8 seconds for new notifications
      const interval = setInterval(fetchNotifications, 8000);
      return () => clearInterval(interval);
    }

    // May socket URL - connect via Socket.IO
    const socket = io(SOCKET_URL, {
      transports: ["websocket", "polling"], // Try WebSocket first, fallback to polling
      auth: { token }, // Send token for authentication
      reconnectionAttempts: 5, // Try to reconnect 5 times
    });
    socketRef.current = socket;

    // Kapag connected na
    socket.on("connect", () => {
      if (role === "admin") {
        socket.emit("join:admin"); // Join admin room
      } else {
        socket.emit("join:student", { studentId: id }); // Join student room
      }
      
    });

    // Kapag may bagong notification galing sa server
    socket.on("notification", (notif) => {
      // Add sa dulo ng list (pinakabago sa taas)
      setNotifications((prev) => [notif, ...prev].slice(0, 50)); // Limit to 50
      setUnread((c) => c + 1); // Dagdagan ang unread count
      if (onNotification) onNotification(notif); // Call callback

      // Ipakita ang toast notification
      toast(notif.body, {
        icon: role === "admin" ? "🔔" : "✨",
        duration: 4000,
        style: { fontSize: "13px", maxWidth: "320px" },
      });
    });

    // Kapag may connection error
    socket.on("connect_error", () => {
      // Socket unavailable - fall back to silent polling
    });

    // Cleanup function
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token, role, id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ──────────────────────────────────────────────────────
  // PROVIDER RETURN - ibigay ang notification data sa child components
  // ──────────────────────────────────────────────────────
  return (
    <NotificationContext.Provider
      value={{ notifications, unread, markAllRead, markOneRead, fetchNotifications }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

// ──────────────────────────────────────────────────────
// USE NOTIFICATIONS HOOK - para madaling mag-access ng notification data
// ──────────────────────────────────────────────────────
export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error("useNotifications must be used within NotificationProvider");
  return ctx;
}
