const getBaseUrl = () => {
  // CRITICAL: Always use relative URLs in browser context (for proxy routing)
  // This ensures the Vite dev server or Nginx proxy handles routing correctly
  // Never use Docker internal service names (like http://api:8001) in browser code
  // The browser cannot resolve Docker service names - they only work inside Docker network
  
  // Explicitly check for browser environment
  if (typeof window !== 'undefined' && typeof window.location !== 'undefined') {
    // In browser: always use relative path so proxy handles routing
    // This will be '/api' which gets proxied by Vite (dev) or Nginx (prod)
    return '/api';
  }
  
  // Fallback (shouldn't happen in browser, but safe default)
  return '/api';
};

// Compute base URL dynamically on each request to avoid module-level caching issues
// This function is called fresh on every request to prevent stale values
const getApiBase = () => {
  const base = getBaseUrl();
  // Safety check: ensure we never return a Docker service name
  if (base.includes('://') && (base.includes('api:') || base.includes('backend:'))) {
    console.error('[API Client] ERROR: Detected Docker service name in API base URL:', base);
    console.error('[API Client] Falling back to relative URL /api');
    return '/api';
  }
  return base;
};

async function request(path, options = {}) {
  // Get active tenant from localStorage
  const activeTenantId = localStorage.getItem('cellor_active_tenant_id');
  
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  
  // Add X-Tenant-Id header if tenant is selected
  if (activeTenantId) {
    headers['X-Tenant-Id'] = activeTenantId;
  }

  // Get base URL dynamically to ensure we always use relative URLs in browser
  // This MUST be '/api' in browser context - never use Docker service names
  const apiBase = getApiBase();
  
  // Ensure path starts with /
  let normalizedPath = path.startsWith('/') ? path : `/${path}`;
  
  // Add trailing slash for GET requests to list endpoints (to avoid FastAPI redirects)
  // BUT don't add trailing slash to paths with UUIDs (FastAPI removes them anyway)
  if ((options.method === 'GET' || !options.method) && !normalizedPath.includes('?')) {
    // UUID pattern: 8-4-4-4-12 hex digits
    const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const hasUuid = uuidPattern.test(normalizedPath);
    
    // Only add trailing slash if it's a list endpoint (no UUID) and doesn't already have one
    if (!hasUuid && !normalizedPath.endsWith('/')) {
      normalizedPath = `${normalizedPath}/`;
    }
  }
  
  const fullUrl = `${apiBase}${normalizedPath}`;
  
  // Use redirect: 'manual' to prevent browser from following redirects that might expose backend URLs
  // Then manually handle redirects to ensure they stay relative
  const response = await fetch(fullUrl, {
    ...options,
    headers,
    credentials: 'include', // Include cookies for authentication (OAuth2 proxy)
    redirect: 'follow', // Follow redirects but ensure they're handled correctly
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || 'Request failed');
  }

  if (response.status === 204) {
    return null;
  }
  return response.json();
}

export const apiClient = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) }),
  put: (path, body) => request(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: (path, body) => request(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (path) => request(path, { method: 'DELETE' }),
};

