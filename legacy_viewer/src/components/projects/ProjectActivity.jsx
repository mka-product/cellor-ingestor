import { useState, useEffect } from 'react';
import { Timeline } from 'primereact/timeline';
import { apiClient } from '../../api/client.js';

export function ProjectActivity({ projectId }) {
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');

  useEffect(() => {
    if (projectId) {
      fetchActivity();
    }
  }, [projectId]);

  const fetchActivity = async () => {
    try {
      setLoading(true);
      const data = await apiClient.get(`/projects/${projectId}/activity`);
      setActivities(data);
    } catch (error) {
      console.error('Failed to fetch activity:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return '—';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    
    return date.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getActionLabel = (activity) => {
    const { entity_type, action, entity_name, snapshot_after, role } = activity;
    const entityName = entity_name || entity_type;
    
    switch (action) {
      case 'insert':
        if (entity_type === 'project') {
          return `Project created`;
        } else if (entity_type === 'dataset') {
          return `Dataset "${entityName}" created`;
        } else if (entity_type === 'slide') {
          return `Slide "${entityName}" uploaded`;
        }
        return `${entity_type} created`;
      
      case 'update':
        if (entity_type === 'project') {
          return `Project updated`;
        } else if (entity_type === 'dataset') {
          return `Dataset "${entityName}" updated`;
        } else if (entity_type === 'slide') {
          return `Slide "${entityName}" updated`;
        }
        return `${entity_type} updated`;
      
      case 'delete':
        if (entity_type === 'project') {
          return `Project deleted`;
        } else if (entity_type === 'dataset') {
          return `Dataset "${entityName}" deleted`;
        } else if (entity_type === 'slide') {
          return `Slide "${entityName}" deleted`;
        }
        return `${entity_type} deleted`;
      
      case 'added':
        if (entity_type === 'membership' && snapshot_after) {
          const userId = snapshot_after.keycloak_id || 'user';
          return `Member added: ${userId} (${role || snapshot_after.role})`;
        }
        return 'Member added';
      
      case 'updated':
        if (entity_type === 'membership' && snapshot_after) {
          const userId = snapshot_after.keycloak_id || 'user';
          return `Member role updated: ${userId} → ${role || snapshot_after.role}`;
        }
        return 'Member updated';
      
      default:
        return `${action} ${entity_type}`;
    }
  };

  const getActionIcon = (action) => {
    switch (action) {
      case 'insert':
      case 'added':
        return 'pi pi-plus-circle';
      case 'update':
      case 'updated':
        return 'pi pi-pencil';
      case 'delete':
        return 'pi pi-trash';
      default:
        return 'pi pi-circle';
    }
  };

  const getActionColor = (action) => {
    switch (action) {
      case 'insert':
      case 'added':
        return 'var(--celnight-accent)';
      case 'update':
      case 'updated':
        return '#ffc107';
      case 'delete':
        return '#dc3545';
      default:
        return 'var(--celnight-text-muted)';
    }
  };

  // Filter activities based on search
  const filteredActivities = activities.filter(activity => {
    if (!searchFilter) return true;
    const searchLower = searchFilter.toLowerCase();
    const label = getActionLabel(activity).toLowerCase();
    const actor = (activity.actor_username || activity.actor_keycloak_id || '').toLowerCase();
    const entityName = (activity.entity_name || '').toLowerCase();
    return label.includes(searchLower) || actor.includes(searchLower) || entityName.includes(searchLower);
  });

  // Transform activities for Timeline component
  const timelineEvents = filteredActivities.map((activity) => ({
    status: getActionLabel(activity),
    date: formatDate(activity.timestamp),
    icon: getActionIcon(activity.action),
    color: getActionColor(activity.action),
    actor: activity.actor_username || activity.actor_keycloak_id || 'System',
    entityType: activity.entity_type,
    action: activity.action,
    data: activity,
  }));

  const customMarker = (item) => {
    return (
      <span
        className="custom-marker p-shadow"
        style={{
          backgroundColor: item.color,
          borderRadius: '50%',
          width: '2rem',
          height: '2rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'white',
        }}
      >
        <i className={item.icon}></i>
      </span>
    );
  };

  const customContent = (item) => {
    return (
      <div className="activity-item" style={{ padding: '1rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
          <div>
            <div style={{ fontWeight: 600, color: 'var(--celnight-text-primary)', marginBottom: '0.25rem' }}>
              {item.status}
            </div>
            <div style={{ fontSize: 'var(--celnight-text-xs)', color: 'var(--celnight-text-muted)' }}>
              by {item.actor}
            </div>
          </div>
          <div style={{ fontSize: 'var(--celnight-text-xs)', color: 'var(--celnight-text-muted)' }}>
            {item.date}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="project-activity-section">
      {/* Header controls - searchbar moved to the right */}
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
            placeholder="Search activity..."
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--celnight-text-muted)' }}>
          Loading activity...
        </div>
      ) : timelineEvents.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--celnight-text-muted)' }}>
          {searchFilter ? 'No activity found matching your search' : 'No activity recorded yet'}
        </div>
      ) : (
        <div style={{ padding: '1rem 0' }}>
          <Timeline
            value={timelineEvents}
            align="left"
            marker={customMarker}
            content={customContent}
          />
        </div>
      )}
    </div>
  );
}

