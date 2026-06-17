import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { apiClient } from '../../api/client.js';

export function DatasetsOverview({ project, datasets, selectedDatasetId, onSelectDataset }) {
  const navigate = useNavigate();
  const [globalFilter, setGlobalFilter] = useState('');
  const [members, setMembers] = useState([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const getInitials = (name) => {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) {
      return parts[0].slice(0, 2).toUpperCase();
    }
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  const handleRowClick = (event) => {
    const datasetId = event.data.id;
    onSelectDataset(datasetId);
    navigate(`/projects/${project.id}/datasets/${datasetId}`);
  };

  const formatDate = (dateString) => {
    if (!dateString) return '—';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
  };

  const nameBodyTemplate = (rowData) => {
    return (
      <div className="projects-table__name-wrapper">
        <svg
          className="projects-table__bookmark-icon"
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M4 2h8v12l-4-3-4 3V2z"
            stroke="currentColor"
            strokeWidth="1.5"
            fill="none"
            strokeLinecap="round"
          />
        </svg>
        <div>
          <div className="projects-table__project-name">{rowData.name}</div>
          <div className="projects-table__project-role">Contributor</div>
        </div>
      </div>
    );
  };

  const dateBodyTemplate = (rowData) => {
    return (
      <div className="projects-table__date-wrapper">
        <svg
          className="projects-table__icon"
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1" />
          <path d="M7 3v4l3 2" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
        </svg>
        <span>Updated on {formatDate(rowData.updated_at || rowData.created_at)}</span>
      </div>
    );
  };

  const slidesBodyTemplate = (rowData) => {
    return (
      <div className="projects-table__stats">
        <div className="projects-table__stat-item">
          <svg
            className="projects-table__icon"
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <rect x="2" y="4" width="10" height="8" rx="1" stroke="currentColor" strokeWidth="1" />
            <path d="M4 4V2a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" stroke="currentColor" strokeWidth="1" />
          </svg>
          <span>{rowData.slides_count || 0} slides</span>
        </div>
      </div>
    );
  };

  const actionBodyTemplate = (rowData) => {
    return (
      <button
        className="projects-table__action-button"
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          handleRowClick({ data: rowData });
        }}
      >
        Access dataset
      </button>
    );
  };

  const dateSortFunction = (event) => {
    return new Date(event.updated_at || event.created_at || 0).getTime();
  };

  const rowClassName = (rowData) => {
    return selectedDatasetId === rowData.id ? 'projects-table__row--active' : '';
  };

  useEffect(() => {
    const fetchMembers = async () => {
      if (!project?.id) return;
      try {
        setLoadingMembers(true);
        const data = await apiClient.get(`/projects/${project.id}/members`);
        setMembers(Array.isArray(data) ? data : []);
      } catch (err) {
        console.warn('Failed to load project members', err);
      } finally {
        setLoadingMembers(false);
      }
    };
    fetchMembers();
  }, [project?.id]);

  const owners = members.filter((m) => m.role?.toLowerCase() === 'owner');
  const annotators = members.filter((m) => m.role?.toLowerCase() === 'annotator');
  const others = members.filter(
    (m) => m.role && m.role.toLowerCase() !== 'owner' && m.role.toLowerCase() !== 'annotator',
  );

  if (!project) {
    return (
      <section className="celnight-section celnight-section--flat">
        <div className="section-empty">Select a project to view datasets.</div>
      </section>
    );
  }

  return (
    <section className="celnight-section celnight-section--flat">
      {/* Header controls - moved to the right */}
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
            placeholder="Search..."
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
          />
        </div>
        <Link to={`/projects/${project.id}/datasets/new`} className="projects-create-button">
          Create dataset
        </Link>
      </div>

      <div className="datasets-split-container">
        <div className="datasets-table-section">
          <div className="projects-table-container">
            <DataTable
              value={datasets}
              globalFilter={globalFilter}
              sortMode="multiple"
              onRowClick={handleRowClick}
              rowClassName={rowClassName}
              className="celnight-datatable"
              emptyMessage={globalFilter ? 'No datasets found matching your search' : 'No datasets to display'}
              paginator
              rows={10}
              paginatorTemplate="FirstPageLink PrevPageLink PageLinks NextPageLink LastPageLink CurrentPageReport"
              currentPageReportTemplate="Datasets {first}-{last} of {totalRecords}"
            >
              <Column
                field="name"
                header="NAME"
                sortable
                body={nameBodyTemplate}
                style={{ width: '35%' }}
              />
              <Column
                field="updated_at"
                header="DATE"
                sortable
                sortFunction={dateSortFunction}
                body={dateBodyTemplate}
                style={{ width: '25%' }}
              />
              <Column
                field="slides_count"
                header="SLIDES"
                sortable
                body={slidesBodyTemplate}
                style={{ width: '30%' }}
              />
              <Column
                header="ACTION"
                body={actionBodyTemplate}
                style={{ width: '10%' }}
              />
            </DataTable>
          </div>
        </div>
        <div className="datasets-sidebar-section">
          <div className="datasets-sidebar-content">
            <h3>Project Team</h3>
            {loadingMembers && <p className="section-subtitle">Loading members…</p>}
            {!loadingMembers && members.length === 0 && (
              <p className="section-subtitle">No members found for this project.</p>
            )}
            {!loadingMembers && members.length > 0 && (
              <div className="project-team-list">
                {owners.length > 0 && (
                  <div className="project-team-group">
                    <div className="project-team-group__title">Owner</div>
                    <ul>
                      {owners.map((m) => (
                        <li key={m.keycloak_id || m.id}>
                          <span className="project-team-avatar">{getInitials(m.username || m.keycloak_id || 'U')}</span>
                          <span className="project-team-name">{m.username || m.keycloak_id || 'Unknown'}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {annotators.length > 0 && (
                  <div className="project-team-group">
                    <div className="project-team-group__title">Annotators</div>
                    <ul>
                      {annotators.map((m) => (
                        <li key={m.keycloak_id || m.id}>
                          <span className="project-team-avatar">{getInitials(m.username || m.keycloak_id || 'U')}</span>
                          <span className="project-team-name">{m.username || m.keycloak_id || 'Unknown'}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {others.length > 0 && (
                  <div className="project-team-group">
                    <div className="project-team-group__title">Other</div>
                    <ul>
                      {others.map((m) => (
                        <li key={m.keycloak_id || m.id}>
                          <span className="project-team-avatar">{getInitials(m.username || m.keycloak_id || 'U')}</span>
                          <span className="project-team-name">{m.username || m.keycloak_id || 'Unknown'}</span>
                          <span className="project-team-role">{m.role}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
