import React from 'react';
export function Field(props: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <label>
      <div className="label">
        {props.label}
        {props.required ? (
          <>
            {' '}
            <span aria-hidden="true">*</span>
          </>
        ) : null}
      </div>
      {props.children}
    </label>
  );
}
