import type { CatalogCategory } from '../../api/catalogCategories';

type Props = {
  categories: CatalogCategory[];
  /** eVet Category_Id as string, or '' for none */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  label?: string;
  className?: string;
  loading?: boolean;
};

/** Named category dropdown for catalog items (inventory / lab / procedure). */
export default function CategorySelect({
  categories,
  value,
  onChange,
  disabled,
  label = 'Category',
  className = 'settings-input',
  loading,
}: Props) {
  const options = [...categories].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  );
  const valueInList =
    value === '' || options.some((c) => String(c.pimsId) === value);

  return (
    <label className="settings-label">
      {label}
      <select
        className={className}
        value={value}
        disabled={disabled || loading}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{loading ? 'Loading…' : 'None'}</option>
        {!valueInList && value !== '' && (
          <option value={value}>Category {value} (not in list)</option>
        )}
        {options.map((c) => (
          <option key={c.id} value={String(c.pimsId ?? '')}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  );
}
