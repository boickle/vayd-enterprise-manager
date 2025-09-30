// src/api/users.ts
import { http } from './http';

// Issue a password reset link to the given email
export async function requestPasswordReset(email: string) {
  return http.post('/users/reset-password/request', { email });
}

// Complete a password reset using the token from the email link
export async function completePasswordReset(token: string, newPassword: string) {
  return http.post('/users/reset-password/complete', { token, newPassword });
}

// Admin-only create user (your controller protects this with AuthGuard)
export async function createUser(email: string, password?: string) {
  return http.post('/users/create', { email, password });
}

// ✅ New: Client self-serve create user
// This endpoint will only succeed if the email is in the clients table
export async function createClientUser(email: string, password?: string) {
  return http.post('/users/create-client', { email, password });
}

// Optional helpers
export async function loginUser(email: string, password: string) {
  return http.post('/users/login', { email, password });
}

export async function getCurrentUser() {
  return http.get('/users');
}
