import axios from "axios";

const BACKEND_URL =
  process.env.REACT_APP_BACKEND_URL ||
  (process.env.NODE_ENV === "development" ? "http://localhost:8002" : "");
export const API = `${BACKEND_URL}/api`;
export const BACKEND_ORIGIN = BACKEND_URL;

export const api = axios.create({
  baseURL: API,
  withCredentials: true,
});

// Attach Authorization header from localStorage as fallback (so testing-agent
// tokens passed via Bearer also work even if 3rd-party cookies are blocked).
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("petbill_session_token");
  if (token && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default api;
