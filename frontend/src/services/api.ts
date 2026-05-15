import axios from 'axios';
import { useAuthStore } from '../store/authStore';

/** Do not treat failed login/register 401 as “session expired”. */
function isPublicAuthRequest(url: string | undefined): boolean {
  if (!url) return false;
  return url.includes('/auth/login') || url.includes('/auth/register');
}

const createApiClient = (baseURL: string) => {
  const api = axios.create({
    baseURL,
    headers: {
      'Content-Type': 'application/json',
    },
  });

  api.interceptors.request.use(
    (config) => {
      const url = config.url || '';
      const isPublicAuth =
        url.includes('/auth/login') || url.includes('/auth/register');
      if (!isPublicAuth) {
        const token = useAuthStore.getState().token;
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
      }
      return config;
    },
    (error) => Promise.reject(error)
  );

  api.interceptors.response.use(
    (response) => response,
    (error) => {
      if (
        error.response?.status === 401 &&
        !isPublicAuthRequest(error.config?.url)
      ) {
        const currentPath = window.location.pathname;

        if (currentPath !== '/login') {
          useAuthStore.getState().logout();
          window.location.href = '/login';
        }
      }

      return Promise.reject(error);
    }
  );

  return api;
};

export const authApi = createApiClient('http://localhost:3001/api');
export const projectApi = createApiClient('http://localhost:3002/api');
export const aiApi = createApiClient('http://localhost:8001/api');
export const recommendationApi = createApiClient('http://localhost:8002/api');
