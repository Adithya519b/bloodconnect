import axios from "axios";

/**
 * All dashboard API calls live here. The admin key is stored after login and
 * sent as the x-admin-key header on every request.
 *
 * Base URL: locally the Vite dev proxy handles "/api/admin". When deployed to
 * a different host than the backend, set VITE_API_URL at build time
 * (e.g. https://bloodconnect-server.onrender.com/api/admin).
 */
const api = axios.create({
  baseURL: `${import.meta.env.VITE_API_URL || ""}/api/admin`,
});

export function setAdminKey(key) {
  if (key) {
    api.defaults.headers.common["x-admin-key"] = key;
    sessionStorage.setItem("bcAdminKey", key);
  } else {
    delete api.defaults.headers.common["x-admin-key"];
    sessionStorage.removeItem("bcAdminKey");
  }
}

export function getStoredAdminKey() {
  return sessionStorage.getItem("bcAdminKey");
}

export async function fetchStats() {
  const { data } = await api.get("/stats");
  return data.stats;
}

export async function fetchRequests(limit = 10) {
  const { data } = await api.get(`/requests?limit=${limit}`);
  return data.requests;
}

export async function fetchDonors() {
  const { data } = await api.get("/donors");
  return data.donors;
}

/** Quick credential check used by the login screen. */
export async function verifyKey(key) {
  const { data } = await axios.get(`${import.meta.env.VITE_API_URL || ""}/api/admin/stats`, {
    headers: { "x-admin-key": key },
  });
  return data.success === true;
}
