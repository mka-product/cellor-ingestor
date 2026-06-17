import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';

export function ProjectsOverview({ projects, selectedProjectId, onSelectProject }) {
  const navigate = useNavigate();
  const [globalFilter, setGlobalFilter] = useState('');

  const handleRowClick = (event) => {
    const projectId = event.data.id;
    onSelectProject(projectId);
    navigate(`/projects/${projectId}`);
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

  const datasetsBodyTemplate = (rowData) => {
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
          <span>{rowData.datasets_count || 0} datasets</span>
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
        Access project
      </button>
    );
  };

  const dateSortFunction = (event) => {
    return new Date(event.updated_at || event.created_at || 0).getTime();
  };

  const rowClassName = (rowData) => {
    return selectedProjectId === rowData.id ? 'projects-table__row--active' : '';
  };

  return (
    <section className="celnight-section celnight-section--flat">
      <div className="projects-header-container">
        <div className="projects-page-header">
          <h1 className="projects-page-title">My projects</h1>
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
                value={globalFilter}
                onChange={(e) => setGlobalFilter(e.target.value)}
              />
            </div>
            <Link to="/projects/new" className="projects-create-button">
              Create project
            </Link>
          </div>
        </div>
      </div>

      <div className="projects-table-container projects-table-container--centered">
        <DataTable
          value={projects}
          globalFilter={globalFilter}
          sortMode="multiple"
          onRowClick={handleRowClick}
          rowClassName={rowClassName}
          className="celnight-datatable"
          emptyMessage={globalFilter ? 'No projects found matching your search' : 'No projects to display'}
          paginator
          rows={10}
          paginatorTemplate="FirstPageLink PrevPageLink PageLinks NextPageLink LastPageLink CurrentPageReport"
          currentPageReportTemplate="Projects {first}-{last} of {totalRecords}"
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
            field="datasets_count"
            header="DATASETS"
            sortable
            body={datasetsBodyTemplate}
            style={{ width: '30%' }}
          />
          <Column
            header="ACTION"
            body={actionBodyTemplate}
            style={{ width: '12%' }}
          />
        </DataTable>
      </div>
    </section>
  );
}
