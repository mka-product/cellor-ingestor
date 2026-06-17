import { CreationForm } from './shared/CreationForm.jsx';

export function Sidebar({
  projects,
  selectedProjectId,
  onSelectProject,
  projectForm,
  onCreateProject,
}) {
  return (
    <aside className="celnight-sidebar">
      <div className="celnight-logo">Celloris</div>
      <div className="celnight-nav">
        <span className="celnight-nav-item celnight-nav-item--active">Projects</span>
        <span className="celnight-nav-item">Datasets</span>
        <span className="celnight-nav-item">Slides</span>
      </div>

      <div className="sidebar-block">
        <div className="sidebar-block__header">
          <span>Active projects</span>
          <span className="sidebar-count">{projects.length}</span>
        </div>
        <div className="sidebar-projects">
          {projects.map((project) => (
            <button
              key={project.id}
              type="button"
              className={`sidebar-project ${selectedProjectId === project.id ? 'is-active' : ''}`}
              onClick={() => onSelectProject(project.id)}
            >
              <strong>{project.name}</strong>
              <small>{project.description || 'No description yet'}</small>
            </button>
          ))}
          {projects.length === 0 && <div className="sidebar-empty">No projects yet</div>}
        </div>
      </div>

      <CreationForm
        title="Create project"
        description="Spin up a new Celloris workspace."
        fields={[
          {
            name: 'project-name',
            placeholder: 'Project name',
            value: projectForm.fields.name,
            onChange: projectForm.handleChange('name'),
          },
          {
            name: 'project-description',
            placeholder: 'Description (optional)',
            value: projectForm.fields.description,
            onChange: projectForm.handleChange('description'),
          },
        ]}
        submitLabel="Create project"
        onSubmit={onCreateProject}
        disabled={!projectForm.fields.name.trim()}
      />
    </aside>
  );
}

