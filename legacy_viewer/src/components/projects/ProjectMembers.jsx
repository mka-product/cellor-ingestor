import { useState, useEffect } from 'react';
import { apiClient } from '../../api/client.js';
import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { Dropdown } from 'primereact/dropdown';
import { ConfirmDialog, confirmDialog } from 'primereact/confirmdialog';
import { Toast } from 'primereact/toast';
import { useRef } from 'react';

const ROLES = [
  { label: 'Owner', value: 'Owner' },
  { label: 'Manager', value: 'Manager' },
  { label: 'Annotator', value: 'Annotator' },
  { label: 'Reviewer', value: 'Reviewer' },
  { label: 'Viewer', value: 'Viewer' },
];

export function ProjectMembers({ projectId, currentUserId }) {
  const [members, setMembers] = useState([]);
  const [availableUsers, setAvailableUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [selectedRole, setSelectedRole] = useState('Viewer');
  const [searchFilter, setSearchFilter] = useState('');
  const toast = useRef(null);

  useEffect(() => {
    if (projectId) {
      fetchMembers();
      fetchAvailableUsers();
    }
  }, [projectId]);

  const fetchMembers = async () => {
    try {
      setLoading(true);
      const data = await apiClient.get(`/projects/${projectId}/members`);
      setMembers(data);
    } catch (error) {
      showError('Failed to load members', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchAvailableUsers = async () => {
    try {
      // Fetch all users from the current tenant
      const data = await apiClient.get('/auth/tenant/users');
      setAvailableUsers(data);
    } catch (error) {
      console.warn('Failed to fetch available users:', error);
      // If endpoint fails, we'll still allow manual keycloak_id entry
    }
  };

  const showError = (message, error) => {
    toast.current?.show({
      severity: 'error',
      summary: 'Error',
      detail: error?.message || message,
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

  const handleAddMember = async () => {
    if (!selectedUserId) {
      showError('Please select a user');
      return;
    }

    try {
      await apiClient.post(`/projects/${projectId}/members`, {
        keycloak_id: selectedUserId,
        role: selectedRole,
      });
      showSuccess('Member added successfully');
      setShowAddDialog(false);
      setSelectedUserId(null);
      setSelectedRole('Viewer');
      fetchMembers();
    } catch (error) {
      showError('Failed to add member', error);
    }
  };

  const handleUpdateRole = async (keycloakId, newRole) => {
    try {
      await apiClient.patch(`/projects/${projectId}/members/${keycloakId}`, {
        keycloak_id: keycloakId,
        role: newRole,
      });
      showSuccess('Role updated successfully');
      fetchMembers();
    } catch (error) {
      showError('Failed to update role', error);
    }
  };

  const handleRemoveMember = (member) => {
    if (member.keycloak_id === currentUserId) {
      showError('You cannot remove yourself from the project');
      return;
    }

    confirmDialog({
      message: `Remove ${member.keycloak_id} from this project?`,
      header: 'Confirm Removal',
      icon: 'pi pi-exclamation-triangle',
      acceptClassName: 'p-button-danger',
      accept: async () => {
        try {
          await apiClient.delete(`/projects/${projectId}/members/${member.keycloak_id}`);
          showSuccess('Member removed successfully');
          fetchMembers();
        } catch (error) {
          showError('Failed to remove member', error);
        }
      },
    });
  };

  const roleBodyTemplate = (rowData) => {
    const isCurrentUser = rowData.keycloak_id === currentUserId;
    return (
      <Dropdown
        value={rowData.role}
        options={ROLES}
        onChange={(e) => handleUpdateRole(rowData.keycloak_id, e.value)}
        disabled={isCurrentUser}
        className="celnight-input"
        style={{ minWidth: '120px' }}
      />
    );
  };

  const actionsBodyTemplate = (rowData) => {
    const isCurrentUser = rowData.keycloak_id === currentUserId;
    return (
      <button
        className="admin-action-button admin-action-button--danger"
        onClick={() => handleRemoveMember(rowData)}
        disabled={isCurrentUser}
        title={isCurrentUser ? 'Cannot remove yourself' : 'Remove member'}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
      </button>
    );
  };

  // Filter users that are not already members
  const memberKeycloakIds = new Set(members.map(m => m.keycloak_id));
  const filteredAvailableUsers = availableUsers.filter(u => !memberKeycloakIds.has(u.id));

  return (
    <div className="project-members-section">
      <Toast ref={toast} />
      <ConfirmDialog />
      
      {/* Header controls - searchbar and button moved to the right */}
      <div className="projects-page-controls" style={{ marginBottom: 'var(--celnight-space-lg)', justifyContent: 'flex-end' }}>
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
            placeholder="Search members..."
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
          />
        </div>
        <button className="projects-create-button" onClick={() => setShowAddDialog(true)}>
          Add Member
        </button>
      </div>

      <div className="projects-table-container">
        <DataTable
          value={members}
          loading={loading}
          globalFilter={searchFilter}
          paginator
          rows={10}
          emptyMessage="No members found"
          className="celnight-datatable"
        >
          <Column 
            field="username" 
            header="USERNAME" 
            sortable 
            body={(rowData) => rowData.username || rowData.keycloak_id}
          />
          <Column field="role" header="ROLE" body={roleBodyTemplate} />
          <Column field="created_at" header="ADDED" sortable />
          <Column body={actionsBodyTemplate} header="ACTIONS" style={{ width: '100px' }} />
        </DataTable>
      </div>

      {/* Add Member Dialog */}
      {showAddDialog && (
        <div className="admin-dialog-overlay" onClick={() => setShowAddDialog(false)}>
          <div className="admin-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="admin-dialog-header">
              <h2 className="admin-dialog-title">Add Member</h2>
              <button className="admin-dialog-close" onClick={() => setShowAddDialog(false)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            <div className="admin-dialog-body">
              <div className="annotation-form-group">
                <label>User</label>
                <Dropdown
                  value={selectedUserId}
                  options={filteredAvailableUsers.map(u => ({
                    label: `${u.username}${u.email ? ` (${u.email})` : ''}`,
                    value: u.id,
                  }))}
                  onChange={(e) => setSelectedUserId(e.value)}
                  placeholder="Select a user"
                  filter
                  className="celnight-input"
                  appendTo="self"
                  panelClassName="admin-dropdown-panel"
                />
              </div>
              <div className="annotation-form-group">
                <label>Role</label>
                <Dropdown
                  value={selectedRole}
                  options={ROLES}
                  onChange={(e) => setSelectedRole(e.value)}
                  className="celnight-input"
                />
              </div>
            </div>
            <div className="admin-dialog-footer">
              <button className="celnight-button celnight-button--ghost" onClick={() => setShowAddDialog(false)}>
                Cancel
              </button>
              <button className="celnight-button" onClick={handleAddMember}>
                Add
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
