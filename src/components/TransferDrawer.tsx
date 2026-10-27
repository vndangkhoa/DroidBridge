import React, { useState } from 'react';
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  PackageCheck,
  XCircle,
} from 'lucide-react';
import type { TransferJob } from '../types';

interface TransferDrawerProps {
  jobs: TransferJob[];
  onRefreshJobs: () => void;
}

export const TransferDrawer: React.FC<TransferDrawerProps> = ({
  jobs,
  onRefreshJobs,
}) => {
  const [expanded, setExpanded] = useState(true);

  const runningCount = jobs.filter((j) => j.status === 'running').length;
  const completedCount = jobs.filter((j) => j.status === 'completed').length;
  const failedCount = jobs.filter((j) => j.status === 'failed').length;

  const formatJobTime = (ms: number) => {
    const d = new Date(ms);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  return (
    <section className="transfer-drawer" aria-label="Transfer Queue and Activity">
      <div
        className="transfer-drawer-header"
        onClick={() => setExpanded((prev) => !prev)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Activity size={14} color="var(--accent-bridge)" />
          <span style={{ fontWeight: 700, fontSize: 12 }}>
            Transfer Queue & ADB Activity
          </span>
          <span className="meta-badge">
            {jobs.length} {jobs.length === 1 ? 'job' : 'jobs'}
          </span>
          {runningCount > 0 && (
            <span className="job-status-pill running">
              <Loader2 size={11} className="spin" />
              <span>{runningCount} active</span>
            </span>
          )}
          {completedCount > 0 && (
            <span className="job-status-pill completed">
              <CheckCircle2 size={11} />
              <span>{completedCount} done</span>
            </span>
          )}
          {failedCount > 0 && (
            <span className="job-status-pill failed">
              <XCircle size={11} />
              <span>{failedCount} failed</span>
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            className="btn btn-xs"
            onClick={(e) => {
              e.stopPropagation();
              onRefreshJobs();
            }}
          >
            Refresh Queue
          </button>
          {expanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </div>
      </div>

      {expanded && (
        <div className="transfer-drawer-list">
          {jobs.length === 0 ? (
            <div
              style={{
                padding: '8px 4px',
                color: 'var(--text-muted)',
                fontSize: 12,
                textAlign: 'center',
              }}
            >
              No ADB transfers in queue yet. Select files in either pane and click Push or
              Pull, or drag rows across panes.
            </div>
          ) : (
            jobs.slice(0, 12).map((job) => (
              <div key={job.id} className="transfer-job-row">
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    minWidth: 0,
                  }}
                >
                  <span className={`job-status-pill ${job.status}`}>
                    {job.status === 'running' && (
                      <Loader2 size={11} className="spin" />
                    )}
                    {job.status === 'completed' && <CheckCircle2 size={11} />}
                    {job.status === 'failed' && <XCircle size={11} />}
                    <span>{job.status}</span>
                  </span>

                  <span
                    className="meta-badge"
                    style={{ textTransform: 'uppercase' }}
                  >
                    {job.direction === 'push' && <ArrowRight size={11} />}
                    {job.direction === 'pull' && <ArrowLeft size={11} />}
                    {job.direction === 'apk-install' && (
                      <PackageCheck size={11} />
                    )}
                    <span>{job.direction}</span>
                  </span>

                  <span
                    style={{
                      fontWeight: 500,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={job.summary}
                  >
                    {job.summary}
                  </span>

                  {job.error && (
                    <span
                      style={{
                        color: 'var(--accent-danger)',
                        fontSize: 11.5,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={job.error}
                    >
                      ({job.error})
                    </span>
                  )}
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    flexShrink: 0,
                  }}
                >
                  <span
                    className="mono-num"
                    style={{ fontSize: 11, color: 'var(--text-secondary)' }}
                  >
                    → {job.targetPath}
                  </span>
                  <span
                    className="mono-num"
                    style={{ fontSize: 11, color: 'var(--text-muted)' }}
                  >
                    {formatJobTime(job.completedAt || job.startedAt)}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
};
