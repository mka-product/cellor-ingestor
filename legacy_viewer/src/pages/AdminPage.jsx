import { useState, useEffect, useRef } from 'react';
import { apiClient } from '../api/client.js';
import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { Toast } from 'primereact/toast';
import { MultiSelect } from 'primereact/multiselect';
import { ConfirmDialog, confirmDialog } from 'primereact/confirmdialog';
import { PrivilegesDialog } from '../components/admin/PrivilegesDialog.jsx';
import '../styles.css';

export function AdminPage() {
  const [activeTab, setActiveTab] = useState(0);
  const [users, setUsers] = useState([]);
  const [groups, setGroups] = useState([]);
  const [roles, setRoles] = useState([]);
  const [privileges, setPrivileges] = useState({});
  const [loading, setLoading] = useState(false);
  const [userDialogVisible, setUserDialogVisible] = useState(false);
  const [groupDialogVisible, setGroupDialogVisible] = useState(false);
  const [roleDialogVisible, setRoleDialogVisible] = useState(false);
  const [privilegesDialogVisible, setPrivilegesDialogVisible] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [editingGroup, setEditingGroup] = useState(null);
  const [editingRole, setEditingRole] = useState(null);
  const [userFilter, setUserFilter] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [currentUser, setCurrentUser] = useState(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const toast = useRef(null);

  // User form state
  const [userForm, setUserForm] = useState({
    username: '',
    email: '',
    firstName: '',
    lastName: '',
    enabled: true,
    password: '',
    realmRoles: [],
    groupIds: [],
  });

  // Group form state
  const [groupForm, setGroupForm] = useState({
    name: '',
    path: '',
  });

  // Role form state
  const [roleForm, setRoleForm] = useState({
    name: '',
    description: '',
  });

  useEffect(() => {
    // Fetch current user info to determine admin status
    apiClient.get('/auth/me')
      .then(data => {
        setCurrentUser(data);
        setIsSuperAdmin(data.is_admin || (data.realm_roles && data.realm_roles.includes('admin')));
      })
      .catch(err => {
        console.warn('Failed to fetch current user:', err);
      });
  }, []);

  useEffect(() => {
    if (activeTab === 0) {
      fetchUsers();
    } else if (activeTab === 1) {
      fetchGroups();
    } else if (activeTab === 2) {
      fetchRoles();
      fetchPrivileges();
    }
  }, [activeTab, isSuperAdmin]);

  // Fetch roles and groups on mount and when needed for user assignment
  useEffect(() => {
    if (roles.length === 0) {
      fetchRoles();
    }
    if (groups.length === 0) {
      fetchGroups();
    }
  }, []);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      // Super admins see all users, tenant admins see only their tenant
      if (isSuperAdmin) {
        const data = await apiClient.get('/admin/users');
        setUsers(data);
      } else {
        // For tenant admins, fetch users from their tenant only
        const data = await apiClient.get('/auth/tenant/users');
        // Transform to match admin users format
        setUsers(data.map(u => ({
          id: u.id,
          username: u.username,
          email: u.email,
          firstName: u.firstName,
          lastName: u.lastName,
          enabled: true, // Assume enabled if not provided
          realmRoles: [],
          groupIds: [],
        })));
      }
    } catch (error) {
      showError('Failed to fetch users', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchGroups = async () => {
    setLoading(true);
    try {
      const data = await apiClient.get('/admin/groups');
      // Filter groups by tenant for non-super-admins
      if (!isSuperAdmin && currentUser) {
        const tenantGroups = data.filter(g => g.name === currentUser.tenant_id);
        setGroups(tenantGroups);
      } else {
        setGroups(data);
      }
    } catch (error) {
      showError('Failed to fetch groups', error);
    } finally {
      setLoading(false);
    }
  };

  // Technical roles that should be hidden from the UI
  const TECHNICAL_ROLES = ['admin', 'user', 'offline_access', 'uma_authorization', 'default-roles-cellor'];

  const fetchRoles = async () => {
    setLoading(true);
    try {
      const data = await apiClient.get('/admin/roles');
      // Filter out technical roles - only show functional roles
      const functionalRoles = data.filter(role => !TECHNICAL_ROLES.includes(role.name));
      setRoles(functionalRoles);
    } catch (error) {
      showError('Failed to fetch roles', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchPrivileges = async () => {
    try {
      const data = await apiClient.get('/admin/privileges');
      setPrivileges(data);
    } catch (error) {
      showError('Failed to fetch privileges', error);
    }
  };

  const showError = (message, error) => {
    let errorMessage = message;
    
    // Parse API error response
    if (error?.response?.data?.detail) {
      errorMessage = error.response.data.detail;
    } else if (error?.response?.data?.message) {
      errorMessage = error.response.data.message;
    } else if (error?.message) {
      errorMessage = error.message;
    }
    
    console.error('Error:', error); // Debug
    
    toast.current?.show({
      severity: 'error',
      summary: 'Error',
      detail: errorMessage,
      life: 5000,
    });
  };

  const showSuccess = (message) => {
    toast.current?.show({
      severity: 'success',
      summary: 'Success',
      detail: message,
      life: 3000,
    });
  };

  const openUserDialog = (user = null) => {
    if (user) {
      setEditingUser(user);
      setUserForm({
        username: user.username,
        email: user.email || '',
        firstName: user.firstName || '',
        lastName: user.lastName || '',
        enabled: user.enabled,
        password: '',
        realmRoles: user.realmRoles || [],
        groupIds: user.groupIds || [],
      });
    } else {
      setEditingUser(null);
      setUserForm({
        username: '',
        email: '',
        firstName: '',
        lastName: '',
        enabled: true,
        password: '',
        realmRoles: [],
        groupIds: [],
      });
    }
    setUserDialogVisible(true);
  };

  const saveUser = async () => {
    try {
      const payload = {
        username: userForm.username,
        email: userForm.email || null,
        firstName: userForm.firstName || null,
        lastName: userForm.lastName || null,
        enabled: userForm.enabled,
        realmRoles: userForm.realmRoles,
        groupIds: userForm.groupIds || [],
      };

      if (userForm.password) {
        payload.credentials = [
          {
            type: 'password',
            value: userForm.password,
            temporary: false,
          },
        ];
      }

      if (!payload.username || payload.username.trim() === '') {
        showError('Username is required');
        return;
      }

      if (editingUser) {
        await apiClient.patch(`/admin/users/${editingUser.id}`, payload);
        showSuccess('User updated successfully');
      } else {
        await apiClient.post('/admin/users', payload);
        showSuccess('User created successfully');
      }
      setUserDialogVisible(false);
      fetchUsers();
    } catch (error) {
      showError('Failed to save user', error);
    }
  };

  const deactivateUser = async (user) => {
    confirmDialog({
      message: `Deactivate user ${user.username}?`,
      header: 'Confirm Deactivation',
      icon: 'pi pi-exclamation-triangle',
      accept: async () => {
        try {
          await apiClient.delete(`/admin/users/${user.id}`);
          showSuccess('User deactivated');
          fetchUsers();
        } catch (error) {
          showError('Failed to deactivate user', error);
        }
      },
    });
  };

  const openGroupDialog = (group = null) => {
    if (group) {
      setEditingGroup(group);
      setGroupForm({
        name: group.name,
        path: group.path || '',
      });
    } else {
      setEditingGroup(null);
      setGroupForm({
        name: '',
        path: '',
      });
    }
    setGroupDialogVisible(true);
  };

  const saveGroup = async () => {
    try {
      console.log('saveGroup called with groupForm:', groupForm); // Debug
      
      // Validate name is not empty
      if (!groupForm.name || !groupForm.name.trim()) {
        showError('Group name is required');
        return;
      }
      
      const payload = {
        name: groupForm.name.trim(),
        path: groupForm.path?.trim() || null,
      };
      
      console.log('Sending payload:', payload); // Debug
      
      if (editingGroup) {
        await apiClient.patch(`/admin/groups/${editingGroup.id}`, payload);
        showSuccess('Group updated successfully');
      } else {
        await apiClient.post('/admin/groups', payload);
        showSuccess('Group created successfully');
      }
      setGroupDialogVisible(false);
      fetchGroups();
    } catch (error) {
      showError('Failed to save group', error);
    }
  };

  const deleteGroup = async (group) => {
    confirmDialog({
      message: `Delete group ${group.name}? This cannot be undone!`,
      header: 'Confirm Deletion',
      icon: 'pi pi-exclamation-triangle',
      acceptClassName: 'p-button-danger',
      accept: async () => {
        try {
          await apiClient.delete(`/admin/groups/${group.id}`);
          showSuccess('Group deleted');
          fetchGroups();
        } catch (error) {
          showError('Failed to delete group', error);
        }
      },
    });
  };

  const openRoleDialog = (role = null) => {
    if (role) {
      setEditingRole(role);
      setRoleForm({
        name: role.name,
        description: role.description || '',
      });
    } else {
      setEditingRole(null);
      setRoleForm({
        name: '',
        description: '',
      });
    }
    setRoleDialogVisible(true);
  };

  const saveRole = async () => {
    try {
      if (editingRole) {
        await apiClient.patch(`/admin/roles/${editingRole.name}`, {
          description: roleForm.description || null,
        });
        showSuccess('Role updated successfully');
      } else {
        await apiClient.post('/admin/roles', roleForm);
        showSuccess('Role created successfully');
      }
      setRoleDialogVisible(false);
      fetchRoles();
    } catch (error) {
      showError('Failed to save role', error);
    }
  };

  const deleteRole = async (role) => {
    confirmDialog({
      message: `Delete role ${role.name}?`,
      header: 'Confirm Deletion',
      icon: 'pi pi-exclamation-triangle',
      acceptClassName: 'p-button-danger',
      accept: async () => {
        try {
          await apiClient.delete(`/admin/roles/${role.name}`);
          showSuccess('Role deleted');
          fetchRoles();
        } catch (error) {
          showError('Failed to delete role', error);
        }
      },
    });
  };

  const openPrivilegesDialog = () => {
    setPrivilegesDialogVisible(true);
  };

  const savePrivileges = async (updatedPrivileges) => {
    try {
      await apiClient.put('/admin/privileges', updatedPrivileges);
      setPrivileges(updatedPrivileges);
      showSuccess('Privileges updated successfully');
      setPrivilegesDialogVisible(false);
    } catch (error) {
      showError('Failed to save privileges', error);
    }
  };

  const userActions = (rowData) => {
    return (
      <div className="admin-table-actions">
        <button
          className="admin-action-button"
          onClick={() => openUserDialog(rowData)}
          title="Edit"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
          </svg>
        </button>
        <button
          className="admin-action-button admin-action-button--danger"
          onClick={() => deactivateUser(rowData)}
          title="Deactivate"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </div>
    );
  };

  const groupActions = (rowData) => {
    return (
      <div className="admin-table-actions">
        <button
          className="admin-action-button"
          onClick={() => openGroupDialog(rowData)}
          title="Edit"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
          </svg>
        </button>
        <button
          className="admin-action-button admin-action-button--danger"
          onClick={() => deleteGroup(rowData)}
          title="Delete"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </div>
    );
  };

  const roleActions = (rowData) => {
    return (
      <div className="admin-table-actions">
        <button
          className="admin-action-button"
          onClick={() => openRoleDialog(rowData)}
          title="Edit"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
          </svg>
        </button>
        <button
          className="admin-action-button admin-action-button--danger"
          onClick={() => deleteRole(rowData)}
          title="Delete"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </div>
    );
  };

  const tabs = [
    { label: 'Users', index: 0 },
    { label: 'Groups', index: 1 },
    { label: 'Roles & Privileges', index: 2 },
  ];

  return (
    <section className="celnight-section celnight-section--flat">
      <Toast ref={toast} />
      <ConfirmDialog />
      <div className="section-header">
        <h1 className="section-title">Administration</h1>
      </div>

      {/* Custom Tabs */}
      <div className="admin-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.index}
            className={`admin-tab ${activeTab === tab.index ? 'admin-tab--active' : ''}`}
            onClick={() => setActiveTab(tab.index)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="admin-tab-content">
        {/* Users Tab */}
        {activeTab === 0 && (
          <div>
            <div className="projects-page-header">
              <h1 className="projects-page-title">Users</h1>
              <div className="projects-page-controls">
                <div className="projects-search-wrapper">
                  <svg
                    className="projects-search-icon"
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10zM13 13l-3-3"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </svg>
                  <input
                    type="text"
                    className="projects-search-input"
                    placeholder="Search..."
                    value={userFilter}
                    onChange={(e) => setUserFilter(e.target.value)}
                  />
                </div>
                <button className="projects-create-button" onClick={() => openUserDialog()}>
                  Create User
                </button>
              </div>
            </div>
            <div className="projects-table-container">
              <DataTable
                value={users}
                loading={loading}
                globalFilter={userFilter}
                paginator
                rows={10}
                emptyMessage={userFilter ? 'No users found matching your search' : 'No users found'}
                className="celnight-datatable"
                paginatorTemplate="FirstPageLink PrevPageLink PageLinks NextPageLink LastPageLink CurrentPageReport"
                currentPageReportTemplate="Users {first}-{last} of {totalRecords}"
              >
                <Column field="username" header="USERNAME" sortable />
                <Column field="email" header="EMAIL" sortable />
                <Column field="firstName" header="FIRST NAME" />
                <Column field="lastName" header="LAST NAME" />
                <Column
                  field="enabled"
                  header="ENABLED"
                  body={(rowData) => (rowData.enabled ? 'Yes' : 'No')}
                />
                <Column
                  field="realmRoles"
                  header="ROLES"
                  body={(rowData) => (rowData.realmRoles || []).join(', ') || '-'}
                />
                <Column body={userActions} header="ACTIONS" style={{ width: '120px' }} />
              </DataTable>
            </div>
          </div>
        )}

        {/* Groups Tab */}
        {activeTab === 1 && (
          <div>
            <div className="projects-page-header">
              <h1 className="projects-page-title">Tenants</h1>
              <div className="projects-page-controls">
                <div className="projects-search-wrapper">
                  <svg
                    className="projects-search-icon"
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10zM13 13l-3-3"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </svg>
                  <input
                    type="text"
                    className="projects-search-input"
                    placeholder="Search..."
                    value={groupFilter}
                    onChange={(e) => setGroupFilter(e.target.value)}
                  />
                </div>
                <button className="projects-create-button" onClick={() => openGroupDialog()}>
                  Create Group
                </button>
              </div>
            </div>
            <div className="projects-table-container">
              <DataTable
                value={groups}
                loading={loading}
                globalFilter={groupFilter}
                paginator
                rows={10}
                emptyMessage={groupFilter ? 'No groups found matching your search' : 'No groups found'}
                className="celnight-datatable"
                paginatorTemplate="FirstPageLink PrevPageLink PageLinks NextPageLink LastPageLink CurrentPageReport"
                currentPageReportTemplate="Groups {first}-{last} of {totalRecords}"
              >
                <Column field="name" header="GROUP NAME" sortable />
                <Column field="path" header="PATH" />
                <Column body={groupActions} header="ACTIONS" style={{ width: '120px' }} />
              </DataTable>
            </div>
          </div>
        )}

        {/* Roles & Privileges Tab */}
        {activeTab === 2 && (
          <div>
            <div className="projects-page-header">
              <h1 className="projects-page-title">Roles & Privileges</h1>
              <div className="projects-page-controls">
                <div className="projects-search-wrapper">
                  <svg
                    className="projects-search-icon"
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10zM13 13l-3-3"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </svg>
                  <input
                    type="text"
                    className="projects-search-input"
                    placeholder="Search..."
                    value={roleFilter}
                    onChange={(e) => setRoleFilter(e.target.value)}
                  />
                </div>
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <button className="projects-create-button" style={{ background: 'transparent', border: '1px solid var(--celnight-border)', color: 'var(--celnight-text)' }} onClick={openPrivilegesDialog}>
                    Manage Privileges
                  </button>
                  <button className="projects-create-button" onClick={() => openRoleDialog()}>
                    Create Role
                  </button>
                </div>
              </div>
            </div>
            <div className="projects-table-container">
              <DataTable
                value={roles}
                loading={loading}
                globalFilter={roleFilter}
                paginator
                rows={10}
                emptyMessage={roleFilter ? 'No roles found matching your search' : 'No roles found'}
                className="celnight-datatable"
                paginatorTemplate="FirstPageLink PrevPageLink PageLinks NextPageLink LastPageLink CurrentPageReport"
                currentPageReportTemplate="Roles {first}-{last} of {totalRecords}"
              >
                <Column field="name" header="ROLE NAME" sortable />
                <Column field="description" header="DESCRIPTION" />
                <Column body={roleActions} header="ACTIONS" style={{ width: '120px' }} />
              </DataTable>
            </div>
          </div>
        )}
      </div>

      {/* User Dialog */}
      {userDialogVisible && (
        <div className="admin-dialog-overlay" onClick={() => setUserDialogVisible(false)}>
          <div className="admin-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="admin-dialog-header">
              <h2 className="admin-dialog-title">{editingUser ? 'Edit User' : 'Create User'}</h2>
              <button className="admin-dialog-close" onClick={() => setUserDialogVisible(false)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            <div className="admin-dialog-body">
              <div className="annotation-form-group">
                <label>Username *</label>
                <input
                  type="text"
                  className="celnight-input"
                  value={userForm.username}
                  onChange={(e) => setUserForm({ ...userForm, username: e.target.value })}
                  disabled={!!editingUser}
                />
              </div>
              <div className="annotation-form-group">
                <label>Email</label>
                <input
                  type="email"
                  className="celnight-input"
                  value={userForm.email}
                  onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
                />
              </div>
              <div className="annotation-form-group">
                <label>First Name</label>
                <input
                  type="text"
                  className="celnight-input"
                  value={userForm.firstName}
                  onChange={(e) => setUserForm({ ...userForm, firstName: e.target.value })}
                />
              </div>
              <div className="annotation-form-group">
                <label>Last Name</label>
                <input
                  type="text"
                  className="celnight-input"
                  value={userForm.lastName}
                  onChange={(e) => setUserForm({ ...userForm, lastName: e.target.value })}
                />
              </div>
              {!editingUser && (
                <div className="annotation-form-group">
                  <label>Password *</label>
                  <input
                    type="password"
                    className="celnight-input"
                    value={userForm.password}
                    onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
                  />
                </div>
              )}
              <div className="annotation-form-group">
                <label>Roles</label>
                <MultiSelect
                  value={userForm.realmRoles}
                  options={roles
                    .filter((role) => !TECHNICAL_ROLES.includes(role.name))
                    .map((role) => ({ label: role.name, value: role.name }))}
                  onChange={(e) => setUserForm({ ...userForm, realmRoles: e.value })}
                  placeholder="Select roles"
                  display="chip"
                  className="celnight-input"
                  appendTo={typeof document !== 'undefined' ? document.body : null}
                />
              </div>
              <div className="annotation-form-group">
                <label>Groups</label>
                <MultiSelect
                  value={userForm.groupIds}
                  options={groups.map((group) => ({ label: group.name, value: group.id }))}
                  onChange={(e) => setUserForm({ ...userForm, groupIds: e.value })}
                  placeholder="Select groups"
                  display="chip"
                  className="celnight-input"
                  appendTo={typeof document !== 'undefined' ? document.body : null}
                />
              </div>
              <div className="annotation-form-group" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input
                  type="checkbox"
                  id="enabled"
                  checked={userForm.enabled}
                  onChange={(e) => setUserForm({ ...userForm, enabled: e.target.checked })}
                />
                <label htmlFor="enabled" style={{ margin: 0 }}>Enabled</label>
              </div>
            </div>
            <div className="admin-dialog-footer">
              <button className="celnight-button celnight-button--ghost" onClick={() => setUserDialogVisible(false)}>
                Cancel
              </button>
              <button className="celnight-button" onClick={saveUser}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Group Dialog */}
      {groupDialogVisible && (
        <div className="admin-dialog-overlay" onClick={() => setRealmDialogVisible(false)}>
          <div className="admin-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="admin-dialog-header">
              <h2 className="admin-dialog-title">{editingGroup ? 'Edit Group' : 'Create Group'}</h2>
              <button className="admin-dialog-close" onClick={() => setGroupDialogVisible(false)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            <div className="admin-dialog-body">
              <div className="annotation-form-group">
                <label>Group Name *</label>
                <input
                  type="text"
                  className="celnight-input"
                  value={groupForm.name}
                  onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })}
                  disabled={!!editingGroup}
                />
              </div>
              <div className="annotation-form-group">
                <label>Path</label>
                <input
                  type="text"
                  className="celnight-input"
                  value={groupForm.path || ''}
                  onChange={(e) => {
                    const newPath = e.target.value;
                    console.log('Path field changed:', newPath); // Debug
                    setGroupForm({ ...groupForm, path: newPath });
                  }}
                  placeholder="/group-name"
                />
              </div>
            </div>
            <div className="admin-dialog-footer">
              <button className="celnight-button celnight-button--ghost" onClick={() => setGroupDialogVisible(false)}>
                Cancel
              </button>
              <button className="celnight-button" onClick={saveGroup}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Role Dialog */}
      {roleDialogVisible && (
        <div className="admin-dialog-overlay" onClick={() => setRoleDialogVisible(false)}>
          <div className="admin-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="admin-dialog-header">
              <h2 className="admin-dialog-title">{editingRole ? 'Edit Role' : 'Create Role'}</h2>
              <button className="admin-dialog-close" onClick={() => setRoleDialogVisible(false)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            <div className="admin-dialog-body">
              <div className="annotation-form-group">
                <label>Role Name *</label>
                <input
                  type="text"
                  className="celnight-input"
                  value={roleForm.name}
                  onChange={(e) => setRoleForm({ ...roleForm, name: e.target.value })}
                  disabled={!!editingRole}
                />
              </div>
              <div className="annotation-form-group">
                <label>Description</label>
                <textarea
                  className="celnight-input"
                  value={roleForm.description}
                  onChange={(e) => setRoleForm({ ...roleForm, description: e.target.value })}
                  rows={3}
                />
              </div>
            </div>
            <div className="admin-dialog-footer">
              <button className="celnight-button celnight-button--ghost" onClick={() => setRoleDialogVisible(false)}>
                Cancel
              </button>
              <button className="celnight-button" onClick={saveRole}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Privileges Dialog */}
      <PrivilegesDialog
        visible={privilegesDialogVisible}
        onClose={() => setPrivilegesDialogVisible(false)}
        privileges={privileges}
        onSave={savePrivileges}
        roles={roles}
      />
    </section>
  );
}
