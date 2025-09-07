import axios from 'axios'

const baseURL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'

let token: string | null = null
export function setToken(t: string | null) { token = t }
export function getToken() { return token }

export const http = axios.create({
  baseURL,
  withCredentials: false,
})

http.interceptors.request.use((config) => {
  // Only attach Authorization if not already provided (allows token override)
  const hasAuthHeader = !!config.headers && ('Authorization' in config.headers)
  if (!hasAuthHeader && token) {
    config.headers = config.headers ?? {}
    config.headers['Authorization'] = `Bearer ${token}`
  }
  return config
})

http.interceptors.response.use(
  (res) => res,
  (error) => Promise.reject(error)
)

// Helper to POST with a one-off token (e.g., temporary reset token)
export function postWithToken<T=any>(path: string, data: any, tokenOverride: string) {
  return http.post<T>(path, data, {
    headers: { Authorization: `Bearer ${tokenOverride}` }
  })
}
