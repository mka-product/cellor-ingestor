import { useState, useEffect } from 'react';
import { MultiSelect } from 'primereact/multiselect';

// Domain definitions with their available actions
const DOMAINS = [
  {
    id: 'project',
    label: 'Project',
    actions: [
      { id: 'create', label: 'Create' },
      { id: 'read', label: 'Read' },
      { id: 'update', label: 'Update' },
      { id: 'delete', label: 'Delete' },
      { id: 'history', label: 'History' },
    ],
  },
  {
    id: 'dataset',
    label: 'Dataset',
    actions: [
      { id: 'create', label: 'Create' },
      { id: 'read', label: 'Read' },
      { id: 'update', label: 'Update' },
      { id: 'delete', label: 'Delete' },
      { id: 'history', label: 'History' },
    ],
  },
  {
    id: 'slide',
    label: 'Slide',
    actions: [
      { id: 'create', label: 'Create' },
      { id: 'read', label: 'Read' },
      { id: 'update', label: 'Update' },
      { id: 'delete', label: 'Delete' },
      { id: 'upload', label: 'Upload' },
      { id: 'history', label: 'History' },
    ],
  },
  {
    id: 'layer',
    label: 'Layer',
    actions: [
      { id: 'create', label: 'Create' },
      { id: 'read', label: 'Read' },
      { id: 'update', label: 'Update' },
      { id: 'delete', label: 'Delete' },
      { id: 'history', label: 'History' },
    ],
  },
  {
    id: 'annotation',
    label: 'Annotation',
    actions: [
      { id: 'create', label: 'Create' },
      { id: 'read', label: 'Read' },
      { id: 'update', label: 'Update' },
      { id: 'delete', label: 'Delete' },
      { id: 'history', label: 'History' },
    ],
  },
  {
    id: 'membership',
    label: 'Membership',
    actions: [
      { id: 'create', label: 'Create' },
      { id: 'read', label: 'Read' },
      { id: 'update', label: 'Update' },
      { id: 'delete', label: 'Delete' },
    ],
  },
  {
    id: 'comment',
    label: 'Comment',
    actions: [
      { id: 'create', label: 'Create' },
      { id: 'read', label: 'Read' },
      { id: 'update', label: 'Update' },
      { id: 'delete', label: 'Delete' },
      { id: 'history', label: 'History' },
    ],
  },
  {
    id: 'notification',
    label: 'Notification',
    actions: [
      { id: 'create', label: 'Create' },
      { id: 'read', label: 'Read' },
      { id: 'update', label: 'Update' },
      { id: 'delete', label: 'Delete' },
    ],
  },
  {
    id: 'global',
    label: 'Global',
    actions: [
      { id: 'run_ai', label: 'Run AI' },
    ],
  },
];

// Preset definitions
const PRESETS = {
  admin: {
    name: 'Administrator',
    description: 'Full access to everything',
    permissions: {
      project: ['create', 'read', 'update', 'delete', 'history'],
      dataset: ['create', 'read', 'update', 'delete', 'history'],
      slide: ['create', 'read', 'update', 'delete', 'upload', 'history'],
      layer: ['create', 'read', 'update', 'delete', 'history'],
      annotation: ['create', 'read', 'update', 'delete', 'history'],
      membership: ['create', 'read', 'update', 'delete'],
      comment: ['create', 'read', 'update', 'delete', 'history'],
      notification: ['create', 'read', 'update', 'delete'],
      global: ['run_ai'],
    },
  },
  Owner: {
    name: 'Owner',
    description: 'Full control over projects',
    permissions: {
      project: ['create', 'read', 'update', 'delete', 'history'],
      dataset: ['create', 'read', 'update', 'delete', 'history'],
      slide: ['create', 'read', 'update', 'delete', 'upload', 'history'],
      layer: ['create', 'read', 'update', 'delete', 'history'],
      annotation: ['create', 'read', 'update', 'delete', 'history'],
      membership: ['create', 'read', 'update', 'delete'],
      comment: ['create', 'read', 'update', 'delete', 'history'],
      notification: ['create', 'read', 'update', 'delete'],
      global: ['run_ai'],
    },
  },
  Manager: {
    name: 'Manager',
    description: 'Data and workflow management',
    permissions: {
      project: ['read', 'history'],
      dataset: ['create', 'read', 'update', 'delete', 'history'],
      slide: ['create', 'read', 'update', 'delete', 'upload', 'history'],
      layer: ['create', 'read', 'update', 'delete', 'history'],
      annotation: ['create', 'read', 'update', 'delete', 'history'],
      membership: ['read'],
      comment: ['create', 'read', 'update', 'delete', 'history'],
      notification: ['create', 'read', 'update', 'delete'],
      global: ['run_ai'],
    },
  },
  Annotator: {
    name: 'Annotator',
    description: 'Create and edit annotations',
    permissions: {
      project: ['read'],
      dataset: ['read'],
      slide: ['read'],
      layer: ['create', 'read', 'update', 'delete'],
      annotation: ['create', 'read', 'update', 'delete'],
      membership: ['read'],
      comment: ['create', 'read', 'update'],
      notification: ['read', 'update', 'delete'],
      global: [],
    },
  },
  Reviewer: {
    name: 'Reviewer',
    description: 'Review and approve annotations',
    permissions: {
      project: ['read', 'history'],
      dataset: ['read', 'history'],
      slide: ['read', 'history'],
      layer: ['read', 'history'],
      annotation: ['read', 'history'],
      membership: ['read'],
      comment: ['create', 'read', 'history'],
      notification: ['read', 'update', 'delete'],
      global: [],
    },
  },
  Viewer: {
    name: 'Viewer',
    description: 'Read-only access',
    permissions: {
      project: ['read', 'history'],
      dataset: ['read', 'history'],
      slide: ['read', 'history'],
      layer: ['read', 'history'],
      annotation: ['read', 'history'],
      membership: ['read'],
      comment: ['create', 'read', 'history'],
      notification: ['read', 'update', 'delete'],
      global: [],
    },
  },
  TenantAdmin: {
    name: 'Tenant Admin',
    description: 'Full control within tenant',
    permissions: {
      project: ['create', 'read', 'update', 'delete', 'history'],
      dataset: ['create', 'read', 'update', 'delete', 'history'],
      slide: ['create', 'read', 'update', 'delete', 'upload', 'history'],
      layer: ['create', 'read', 'update', 'delete', 'history'],
      annotation: ['create', 'read', 'update', 'delete', 'history'],
      membership: ['create', 'read', 'update', 'delete'],
      comment: ['create', 'read', 'update', 'delete', 'history'],
      notification: ['create', 'read', 'update', 'delete'],
      global: ['run_ai'],
    },
  },
  TenantViewer: {
    name: 'Tenant Viewer',
    description: 'Read-only access with history',
    permissions: {
      project: ['read', 'history'],
      dataset: ['read', 'history'],
      slide: ['read', 'history'],
      layer: ['read', 'history'],
      annotation: ['read', 'history'],
      membership: ['read'],
      comment: ['create', 'read', 'update', 'delete', 'history'],
      notification: ['read', 'update', 'delete'],
      global: [],
    },
  },
  TenantMember: {
    name: 'Tenant Member',
    description: 'Annotator-level access',
    permissions: {
      project: ['read'],
      dataset: ['read'],
      slide: ['read'],
      layer: ['create', 'read', 'update', 'delete'],
      annotation: ['create', 'read', 'update', 'delete'],
      membership: ['read'],
      comment: ['create', 'read', 'update'],
      notification: ['read', 'update', 'delete'],
      global: [],
    },
  },
};

/**
 * Convert API format to UI format
 * API: { "role": { "domain:action": true/false } }
 * UI: { "role": { "domain": ["action1", "action2"] } }
 */
export function parseApiToUi(apiFormat) {
  const uiFormat = {};
  
  for (const [roleName, permissions] of Object.entries(apiFormat)) {
    uiFormat[roleName] = {};
    
    // Parse domain:action format
    for (const [permission, enabled] of Object.entries(permissions)) {
      if (!enabled) continue;
      
      const [domain, action] = permission.split(':');
      if (!domain || !action) {
        // Handle legacy permissions like "run_ai"
        if (permission === 'run_ai') {
          if (!uiFormat[roleName].global) {
            uiFormat[roleName].global = [];
          }
          uiFormat[roleName].global.push('run_ai');
        }
        continue;
      }
      
      if (!uiFormat[roleName][domain]) {
        uiFormat[roleName][domain] = [];
      }
      uiFormat[roleName][domain].push(action);
    }
    
    // Initialize empty arrays for domains that have no permissions
    for (const domain of DOMAINS) {
      if (!uiFormat[roleName][domain.id]) {
        uiFormat[roleName][domain.id] = [];
      }
    }
  }
  
  return uiFormat;
}

/**
 * Convert UI format to API format
 * UI: { "role": { "domain": ["action1", "action2"] } }
 * API: { "role": { "domain:action": true/false } }
 */
export function parseUiToApi(uiFormat) {
  const apiFormat = {};
  
  for (const [roleName, domains] of Object.entries(uiFormat)) {
    apiFormat[roleName] = {};
    
    // First, set all permissions to false
    for (const domain of DOMAINS) {
      for (const action of domain.actions) {
        const key = domain.id === 'global' ? action.id : `${domain.id}:${action.id}`;
        apiFormat[roleName][key] = false;
      }
    }
    
    // Then, set enabled permissions to true
    for (const [domain, actions] of Object.entries(domains)) {
      if (!Array.isArray(actions)) continue;
      
      for (const action of actions) {
        if (domain === 'global') {
          // Handle legacy permissions
          apiFormat[roleName][action] = true;
        } else {
          apiFormat[roleName][`${domain}:${action}`] = true;
        }
      }
    }
  }
  
  return apiFormat;
}

export function PrivilegesDialog({ visible, onClose, privileges, onSave, roles }) {
  const [selectedRole, setSelectedRole] = useState(null);
  const [uiFormat, setUiFormat] = useState({});
  const [originalFormat, setOriginalFormat] = useState({});

  // Technical roles that should be hidden from the UI
  const TECHNICAL_ROLES = ['admin', 'user', 'offline_access', 'uma_authorization', 'default-roles-cellor'];

  useEffect(() => {
    if (visible && privileges) {
      const parsed = parseApiToUi(privileges);
      // Filter out technical roles - only show functional roles
      const filtered = {};
      for (const [roleName, permissions] of Object.entries(parsed)) {
        if (!TECHNICAL_ROLES.includes(roleName)) {
          filtered[roleName] = permissions;
        }
      }
      setUiFormat(filtered);
      setOriginalFormat(JSON.parse(JSON.stringify(filtered))); // Deep copy
      // Select first functional role by default
      const firstRole = Object.keys(filtered)[0];
      if (firstRole) {
        setSelectedRole(firstRole);
      }
    }
  }, [visible, privileges]);

  const handleRoleChange = (roleName) => {
    setSelectedRole(roleName);
  };

  const handlePermissionChange = (domainId, selectedActionIds) => {
    if (!selectedRole) return;
    
    setUiFormat((prev) => {
      const updated = JSON.parse(JSON.stringify(prev));
      if (!updated[selectedRole]) {
        updated[selectedRole] = {};
      }
      updated[selectedRole][domainId] = selectedActionIds;
      return updated;
    });
  };

  const handlePresetApply = (presetKey) => {
    if (!selectedRole) return;
    
    const preset = PRESETS[presetKey];
    if (!preset) return;
    
    setUiFormat((prev) => {
      const updated = JSON.parse(JSON.stringify(prev));
      if (!updated[selectedRole]) {
        updated[selectedRole] = {};
      }
      updated[selectedRole] = JSON.parse(JSON.stringify(preset.permissions));
      return updated;
    });
  };

  const handleSave = () => {
    const apiFormat = parseUiToApi(uiFormat);
    onSave(apiFormat);
  };

  const handleCancel = () => {
    setUiFormat(originalFormat);
    onClose();
  };

  if (!visible) return null;

  const currentPermissions = selectedRole ? (uiFormat[selectedRole] || {}) : {};
  const availableRoles = Object.keys(uiFormat);

  return (
    <div className="admin-dialog-overlay" onClick={handleCancel}>
      <div className="admin-dialog admin-dialog--large" onClick={(e) => e.stopPropagation()}>
        <div className="admin-dialog-header">
          <h2 className="admin-dialog-title">Manage Privileges</h2>
          <button className="admin-dialog-close" onClick={handleCancel}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        
        <div className="admin-dialog-body">
          {/* Role Selector */}
          <div className="privileges-role-selector">
            <label className="privileges-label">Select Role:</label>
            <select
              className="celnight-input"
              value={selectedRole || ''}
              onChange={(e) => handleRoleChange(e.target.value)}
            >
              <option value="">-- Select a role --</option>
              {availableRoles.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </div>

          {/* Presets */}
          {selectedRole && (
            <div className="privileges-presets">
              <label className="privileges-label">Apply Preset:</label>
              <div className="privileges-preset-buttons">
                {Object.entries(PRESETS).map(([key, preset]) => (
                  <button
                    key={key}
                    type="button"
                    className="celnight-chip"
                    onClick={() => handlePresetApply(key)}
                    title={preset.description}
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Domain-based Permission Editor */}
          {selectedRole && (
            <div className="privileges-editor">
              <h3 className="privileges-section-title">Permissions by Domain</h3>
              {DOMAINS.map((domain) => {
                const domainActions = currentPermissions[domain.id] || [];
                return (
                  <div key={domain.id} className="privileges-domain-group">
                    <div className="privileges-domain-header">
                      <label className="privileges-domain-label">{domain.label}</label>
                    </div>
                    <MultiSelect
                      options={domain.actions.map((action) => ({ label: action.label, value: action.id }))}
                      value={domainActions}
                      onChange={(e) => handlePermissionChange(domain.id, e.value)}
                      placeholder={`Select ${domain.label.toLowerCase()} permissions...`}
                      display="chip"
                      className="celnight-input"
                      appendTo={typeof document !== 'undefined' ? document.body : null}
                    />
                  </div>
                );
              })}
            </div>
          )}

          {!selectedRole && (
            <div className="privileges-empty-state">
              <p>Please select a role to edit its permissions.</p>
            </div>
          )}
        </div>

        <div className="admin-dialog-footer">
          <button className="celnight-button celnight-button--ghost" onClick={handleCancel}>
            Cancel
          </button>
          <button className="celnight-button" onClick={handleSave} disabled={!selectedRole}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

