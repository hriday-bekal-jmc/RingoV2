const BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

interface RequestOptions extends Omit<RequestInit, 'body'> {
  timeout?: number;
  data?: any;
}

async function fetchClient(endpoint: string, options: RequestOptions = {}) {
  const { timeout = 30000, data, headers, ...customConfig } = options;

  // タイムアウトの設定
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  const config: RequestInit = {
    ...customConfig,
    credentials: 'include', // Cookie（JWT）を送信するため
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    signal: controller.signal,
  };

  if (data) {
    config.body = JSON.stringify(data);
  }

  try {
    const response = await fetch(`${BASE_URL}${endpoint}`, config);
    clearTimeout(id);

    // 401未認証エラーの場合はログイン画面へ
    if (response.status === 401 && window.location.pathname !== '/login') {
      window.location.href = '/login';
      throw new Error('Unauthorized');
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP Error: ${response.status}`);
    }

    // Axiosの { data: ... } というレスポンス形式を再現して後方互換性を保つ
    const responseData = await response.json();
    return { data: responseData };
    
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

export default {
  get:    (endpoint: string, options?: RequestOptions) =>
    fetchClient(endpoint, { ...options, method: 'GET' }),
  post:   (endpoint: string, data?: any, options?: RequestOptions) =>
    fetchClient(endpoint, { ...options, method: 'POST', data }),
  put:    (endpoint: string, data?: any, options?: RequestOptions) =>
    fetchClient(endpoint, { ...options, method: 'PUT', data }),
  patch:  (endpoint: string, data?: any, options?: RequestOptions) =>
    fetchClient(endpoint, { ...options, method: 'PATCH', data }),
  delete: (endpoint: string, options?: RequestOptions) =>
    fetchClient(endpoint, { ...options, method: 'DELETE' }),
};