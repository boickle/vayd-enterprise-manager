import React from 'react';
export function Field(props: { label: string; children: React.ReactNode }) {
  return (
    <label>
      <div className="label">{props.label}</div>
      {props.children}
    </label>
  );
}
