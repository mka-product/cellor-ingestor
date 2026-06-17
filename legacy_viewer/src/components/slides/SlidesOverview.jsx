import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { ProgressBar } from 'primereact/progressbar';

export function SlidesOverview({ project, dataset, slides, onUploadComplete }) {
  const navigate = useNavigate();
  const [globalFilter, setGlobalFilter] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef(null);
  const [selectedFile, setSelectedFile] = useState(null);

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
          <div className="projects-table__project-role">{rowData.file_path || 'No file path'}</div>
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

  const statusBodyTemplate = (rowData) => {
    const statusKey = typeof rowData.status === 'string' ? rowData.status.toLowerCase() : '';
    const statusClassMap = {
      pending: 'slide-status--pending',
      processed: 'slide-status--processed',
      error: 'slide-status--error',
    };
    return (
      <span className={`slide-status-badge ${statusClassMap[statusKey] || ''}`}>
        {rowData.status || 'pending'}
      </span>
    );
  };

  const actionBodyTemplate = (rowData) => (
    <button
      className="projects-table__action-button"
      type="button"
      disabled={!rowData.file_path || !project || !dataset}
      onClick={(e) => {
        e.stopPropagation();
        if (rowData.file_path && project && dataset) {
          navigate(`/projects/${project.id}/datasets/${dataset.id}/slides/${rowData.id}/viewer`);
        }
      }}
    >
      View slide
    </button>
  );

  const dateSortFunction = (event) => {
    return new Date(event.updated_at || event.created_at || 0).getTime();
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile || !dataset) return;

    setIsUploading(true);
    setUploadProgress(0);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('dataset_id', dataset.id);
      if (selectedFile.name) {
        formData.append('name', selectedFile.name);
      }

      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const percentComplete = (e.loaded / e.total) * 100;
          setUploadProgress(percentComplete);
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status === 200 || xhr.status === 201) {
          setUploadProgress(100);
          setTimeout(() => {
            setIsUploading(false);
            setUploadProgress(0);
            setSelectedFile(null);
            if (fileInputRef.current) {
              fileInputRef.current.value = '';
            }
            if (onUploadComplete) {
              onUploadComplete();
            }
          }, 500);
        } else {
          setIsUploading(false);
          setUploadProgress(0);
          alert('Upload failed: ' + (xhr.responseText || 'Unknown error'));
        }
      });

      xhr.addEventListener('error', () => {
        setIsUploading(false);
        setUploadProgress(0);
        alert('Upload error');
      });

      const baseURL = window.location.origin;
      xhr.open('POST', `${baseURL}/api/slides-meta/upload`);
      xhr.send(formData);
    } catch (error) {
      setIsUploading(false);
      setUploadProgress(0);
      alert('Upload failed: ' + error.message);
    }
  };

  if (!dataset) {
    return (
      <section className="celnight-section celnight-section--flat">
        <div className="section-empty">Select a dataset to view slides.</div>
      </section>
    );
  }

  return (
    <section className="celnight-section celnight-section--flat">
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
          onClick={() => project && navigate(`/projects/${project.id}`)}
          disabled={!project}
        >
          {project?.name || '—'}
        </button>
        <span> / </span>
        <button
          type="button"
          className="celnight-breadcrumb__link"
          onClick={() => project && dataset && navigate(`/projects/${project.id}/datasets/${dataset.id}`)}
          disabled={!project || !dataset}
        >
          {dataset.name}
        </button>
      </div>
      <div className="datasets-page-header">
        <div>
          <h1 className="projects-page-title">{dataset.name}</h1>
          {dataset.description ? (
            <p
              className="section-subtitle"
              dangerouslySetInnerHTML={{ __html: dataset.description }}
            />
          ) : (
            <p className="section-subtitle">No description yet</p>
          )}
        </div>
        <div className="projects-page-controls">
          <div className="upload-controls">
            <input
              ref={fileInputRef}
              type="file"
              accept=".svs,.tif,.tiff,.ndpi,.vms,.vmu,.scn,.mrxs,.bif,.svslide"
              onChange={handleFileSelect}
              disabled={isUploading}
              style={{ display: 'none' }}
              id="slide-file-input"
            />
            <label htmlFor="slide-file-input" className="celnight-button celnight-button--ghost" style={{ marginRight: 'var(--celnight-space-sm)', cursor: isUploading ? 'not-allowed' : 'pointer' }}>
              Select file
            </label>
            {selectedFile && (
              <span className="selected-file-name" style={{ marginRight: 'var(--celnight-space-sm)', fontSize: 'var(--celnight-text-sm)', color: 'var(--celnight-text-secondary)' }}>
                {selectedFile.name}
              </span>
            )}
            <button
              className="celnight-button"
              type="button"
              onClick={handleUpload}
              disabled={!selectedFile || isUploading}
            >
              Upload
            </button>
          </div>
        </div>
      </div>

      {isUploading && (
        <div className="upload-progress-container">
          <ProgressBar value={uploadProgress} showValue={false} />
          <span className="upload-progress-text">Uploading... {Math.round(uploadProgress)}%</span>
        </div>
      )}

      <div className="projects-table-container">
        <DataTable
          value={slides}
          globalFilter={globalFilter}
          sortMode="multiple"
          rowClassName={() => ''}
          className="celnight-datatable"
          emptyMessage={globalFilter ? 'No slides found matching your search' : 'No slides to display'}
          paginator
          rows={10}
          paginatorTemplate="FirstPageLink PrevPageLink PageLinks NextPageLink LastPageLink CurrentPageReport"
          currentPageReportTemplate="Slides {first}-{last} of {totalRecords}"
        >
          <Column
            field="name"
            header="NAME"
            sortable
            body={nameBodyTemplate}
            style={{ width: '40%' }}
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
            field="status"
            header="STATUS"
            sortable
            body={statusBodyTemplate}
            style={{ width: '25%' }}
          />
          <Column
            header="ACTION"
            body={actionBodyTemplate}
            style={{ width: '10%' }}
          />
        </DataTable>
      </div>
    </section>
  );
}
