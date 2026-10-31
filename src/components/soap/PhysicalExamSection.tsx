import { ChevronDown, ChevronRight } from 'lucide-react';
import { PE_SYSTEMS, type PeExamState, type PeSystemStatus } from './peTemplate';

type Props = {
  value: PeExamState;
  disabled?: boolean;
  onChange: (next: PeExamState) => void;
};

/**
 * PE template, normal by default (spec §5.1). Every system's finding text is
 * editable regardless of status — normal systems start pre-filled with the
 * standard `normalText` boilerplate (editable, not just a static label) so
 * the doctor can customize it without first flagging the system abnormal.
 */
export default function PhysicalExamSection({ value, disabled, onChange }: Props) {
  const setStatus = (key: string, status: PeSystemStatus) => {
    onChange({ ...value, [key]: { status, note: value[key]?.note } });
  };
  const setNote = (key: string, status: PeSystemStatus, note: string) => {
    onChange({ ...value, [key]: { status, note } });
  };

  return (
    <div className="soap-pe">
      {PE_SYSTEMS.map((sys) => {
        const finding = value[sys.key] ?? { status: 'normal' as PeSystemStatus };
        const abnormal = finding.status === 'abnormal';
        const notExamined = finding.status === 'not_examined';
        const noteValue = finding.note ?? (finding.status === 'normal' ? sys.normalText : '');
        return (
          <div key={sys.key} className={`soap-pe-row${abnormal ? ' is-abnormal' : ''}`}>
            <div className="soap-pe-row-head">
              <span className="soap-pe-label">
                {abnormal ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                {sys.label}
              </span>
              <div className="soap-pe-toggle" role="group" aria-label={`${sys.label} status`}>
                {(['normal', 'abnormal', 'not_examined'] as PeSystemStatus[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={disabled}
                    className={`soap-pe-chip${finding.status === s ? ' active' : ''}${
                      s === 'abnormal' ? ' abnormal' : ''
                    }`}
                    onClick={() => setStatus(sys.key, s)}
                  >
                    {s === 'normal' ? 'Normal' : s === 'abnormal' ? 'Abnormal' : 'N/E'}
                  </button>
                ))}
              </div>
            </div>
            <textarea
              className={`soap-pe-note${abnormal ? ' is-abnormal' : ''}`}
              placeholder={
                notExamined
                  ? `Reason ${sys.label.toLowerCase()} wasn't examined (optional)…`
                  : `Describe ${sys.label.toLowerCase()} findings…`
              }
              value={noteValue}
              disabled={disabled}
              onChange={(e) => setNote(sys.key, finding.status, e.target.value)}
              rows={abnormal ? 2 : 1}
            />
          </div>
        );
      })}
    </div>
  );
}
