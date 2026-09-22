import type { ChangeEvent, ReactNode } from 'react';
import { Icon } from './Icon.js';

/**
 * Native file input kept focusable (visually replaced by its label button). Files are only ever
 * handed to the caller; nothing is previewed or rendered.
 */
export function FileSlot({ id, label, accept, multiple, summary, filled, disabled, onFiles, buttonLabel }: {
  readonly id: string;
  readonly label: string;
  readonly accept: string;
  readonly multiple?: boolean;
  readonly summary: ReactNode;
  readonly filled: boolean;
  readonly disabled?: boolean;
  readonly onFiles: (files: readonly File[]) => void;
  readonly buttonLabel?: string;
}) {
  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    // Reset so choosing the same file again still fires a change event.
    event.target.value = '';
    if (files.length > 0) onFiles(files);
  };
  return (
    <div className="file-slot" data-filled={filled}>
      <Icon name={filled ? 'fileCheck' : 'file'} size={22} />
      <div className="file-slot-text">
        <span className="file-slot-label" id={`${id}-label`}>{label}</span>
        <span className="file-slot-value" id={`${id}-status`}>{summary}</span>
      </div>
      <input
        id={id}
        className="file-input"
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-status`}
        onChange={onChange}
      />
      <label htmlFor={id} className="button-secondary" aria-hidden="true">
        {buttonLabel ?? (filled ? 'Ganti' : 'Pilih')}
      </label>
    </div>
  );
}
