import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  PE_SYSTEMS,
  type PeExamState,
  type PeSystemStatus,
} from './peTemplate';

type Props = {
  value: PeExamState;
  disabled?: boolean;
  onChange: (next: PeExamState) => void;
};

/**
 * PE template, normal by default with tap-to-expand on abnormal (spec §5.1).
 * Only flagged (abnormal) systems open a note field.
 */
export default function PhysicalExamSection({ value, disabled, onChange }: Props) {
  const setStatus = (key: string, status: PeSystemStatus) => {
    onChange({
      ...value,
      [key]: { status, note: status === 'abnormal' ? value[key]?.note ?? '' : undefined },
    });
  };
  const setNote = (key: string, note: string) => {
    onChange({ ...value, [key]: { status: 'abnormal', note } });
  };

  return (
    <div className="soap-pe">
      {PE_SYSTEMS.map((sys) => {
        const finding = value[sys.key] ?? { status: 'normal' as PeSystemStatus };
        const abnormal = finding.status === 'abnormal';
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
            {finding.status === 'normal' && (
              <div className="soap-pe-normal-text">{sys.normalText}</div>
            )}
            {abnormal && (
              <textarea
                className="soap-pe-note"
                placeholder={`Describe ${sys.label.toLowerCase()} findings…`}
                value={finding.note ?? ''}
                disabled={disabled}
                onChange={(e) => setNote(sys.key, e.target.value)}
                rows={2}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
