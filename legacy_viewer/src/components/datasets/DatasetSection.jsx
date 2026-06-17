import { useNavigate } from 'react-router-dom';
import { CreationForm } from '../shared/CreationForm.jsx';
import { DatasetCard } from './DatasetCard.jsx';

export function DatasetSection({
  project,
  datasets,
  selectedDatasetId,
  onSelectDataset,
  datasetForm,
  onCreateDataset,
}) {
  const navigate = useNavigate();

  if (!project) {
    return (
      <section className="celnight-section">
        <div className="section-header">
          <div className="celnight-breadcrumb">
            <button
              type="button"
              className="celnight-breadcrumb__link"
              onClick={() => navigate('/projects')}
            >
              Projects
            </button>
            <span> / —</span>
          </div>
          <h2 className="section-title">Dataset overview</h2>
        </div>
        <div className="section-empty">Select a project to view datasets.</div>
      </section>
    );
  }

  return (
    <section className="celnight-section">
      <div className="section-header">
        <div>
          <div className="celnight-breadcrumb">
            <button
              type="button"
              className="celnight-breadcrumb__link"
              onClick={() => navigate('/projects')}
            >
              Projects
            </button>
            <span> / </span>
            <button
              type="button"
              className="celnight-breadcrumb__link"
              onClick={() => navigate(`/projects/${project.id}`)}
            >
              {project.name}
            </button>
          </div>
          <h2 className="section-title">{project.name}</h2>
          {project.description ? (
            <p
              className="section-subtitle"
              dangerouslySetInnerHTML={{ __html: project.description }}
            />
          ) : (
            <p className="section-subtitle">No description yet</p>
          )}
        </div>
        <div className="project-stats">
          <span className="project-stats__pill">Datasets: {datasets.length}</span>
          <span className="project-stats__pill">
            Created: {project.created_at ? new Date(project.created_at).toLocaleDateString() : '—'}
          </span>
        </div>
      </div>

      <div className="dataset-grid">
        {datasets.map((dataset) => (
          <DatasetCard
            key={dataset.id}
            dataset={dataset}
            active={selectedDatasetId === dataset.id}
            onSelect={onSelectDataset}
          />
        ))}
        {datasets.length === 0 && <div className="section-empty">No datasets yet</div>}
      </div>

      <CreationForm
        title="Create dataset"
        description="Attach a dataset to this project."
        fields={[
          {
            name: 'dataset-name',
            placeholder: 'Dataset name',
            value: datasetForm.fields.name,
            onChange: datasetForm.handleChange('name'),
          },
          {
            name: 'dataset-description',
            placeholder: 'Description (optional)',
            value: datasetForm.fields.description,
            onChange: datasetForm.handleChange('description'),
          },
        ]}
        submitLabel="Create dataset"
        onSubmit={onCreateDataset}
        disabled={!datasetForm.fields.name.trim()}
      />
    </section>
  );
}
