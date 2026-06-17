import { useState, useEffect } from 'react';
import { Dropdown } from 'primereact/dropdown';
import { apiClient } from '../api/client.js';

const TENANT_STORAGE_KEY = 'cellor_active_tenant_id';

export function TenantSwitcher() {
  const [tenants, setTenants] = useState([]);
  const [selectedTenant, setSelectedTenant] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Load user info to get tenant list
    const loadTenants = async () => {
      try {
        const userInfo = await apiClient.get('/auth/me');
        
        // Map tenant_ids to dropdown options
        const tenantOptions = userInfo.tenant_ids.map(tid => ({
          label: tid,
          value: tid,
        }));
        
        setTenants(tenantOptions);
        
        // Get saved tenant from localStorage or use current_tenant_id
        const savedTenant = localStorage.getItem(TENANT_STORAGE_KEY);
        const activeTenant = savedTenant || userInfo.current_tenant_id;
        
        // Validate that saved tenant is still in user's tenant list
        if (userInfo.tenant_ids.includes(activeTenant)) {
          setSelectedTenant(activeTenant);
          // Update localStorage if it was from userInfo
          if (!savedTenant) {
            localStorage.setItem(TENANT_STORAGE_KEY, activeTenant);
          }
        } else if (tenantOptions.length > 0) {
          // Fallback to first tenant if saved tenant is no longer valid
          setSelectedTenant(tenantOptions[0].value);
          localStorage.setItem(TENANT_STORAGE_KEY, tenantOptions[0].value);
        }
      } catch (error) {
        console.error('Failed to load tenant information:', error);
      } finally {
        setLoading(false);
      }
    };
    
    loadTenants();
  }, []);

  const handleTenantChange = (e) => {
    const newTenant = e.value;
    setSelectedTenant(newTenant);
    localStorage.setItem(TENANT_STORAGE_KEY, newTenant);
    
    // Trigger a page reload to ensure all API calls use the new tenant
    // Alternatively, we could use a context/state management solution
    window.location.reload();
  };

  // Don't show switcher if user only has one tenant (unless admin)
  if (loading) {
    return null;
  }

  if (tenants.length <= 1) {
    return null;
  }

  return (
    <div className="tenant-switcher" style={{ marginRight: '1rem' }}>
      <Dropdown
        value={selectedTenant}
        options={tenants}
        onChange={handleTenantChange}
        placeholder="Select Tenant"
        className="celnight-input"
        style={{ minWidth: '150px' }}
      />
    </div>
  );
}

