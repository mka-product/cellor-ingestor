import { useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { Editor } from 'primereact/editor';

export function CreateDatasetPage() {
  const navigate = useNavigate();
  const { projectId } = useParams();
  const { selectedProject, datasetForm, onCreateDataset } = useOutletContext();

  const handleSubmit = async () => {
    await onCreateDataset();
    navigate(`/projects/${projectId}`);
  };

  const handleCancel = () => {
    navigate(`/projects/${projectId}`);
  };

  if (!selectedProject) {
    return (
      <section className="celnight-section">
        <div className="section-empty">Select a project first to create a dataset.</div>
      </section>
    );
  }

  return (
    <section className="celnight-section">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 'var(--celnight-space-xl)',
        }}
      >
        <h1 className="section-title">Create dataset</h1>
        <button type="button" className="celnight-chip" onClick={handleCancel}>
          Cancel
        </button>
      </div>
      <div className="celnight-form">
        <p className="celnight-form__description">
          Attach a new dataset to project <strong>{selectedProject.name}</strong>.
        </p>
        <div className="celnight-form__fields">
          <input
            type="text"
            className="celnight-input"
            placeholder="Dataset name"
            value={datasetForm.fields.name}
            onChange={datasetForm.handleChange('name')}
          />
          <div className="celnight-editor-wrapper">
            <label className="celnight-editor-label">Description (optional)</label>
            <Editor
              value={datasetForm.fields.description}
              onTextChange={(e) =>
                datasetForm.handleChange('description')({
                  target: { value: e.htmlValue || '' },
                })
              }
              style={{ height: '200px' }}
              className="celnight-editor"
            />
          </div>
        </div>
        <button
          className="celnight-button"
          type="button"
          onClick={handleSubmit}
          disabled={!datasetForm.fields.name.trim()}
        >
          Create dataset
        </button>
      </div>
    </section>
  );
}


