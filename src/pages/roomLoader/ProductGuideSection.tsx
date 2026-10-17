// src/pages/roomLoader/ProductGuideSection.tsx
// The collapsible prevention guide on the summary page. Informational only: it explains
// what the practice stocks so the owner can search for a product in the store box above.
import type {
  RoomLoaderProductGuideConfig,
  RoomLoaderSpecies,
} from '../../utils/roomLoaderConfigTypes';
import { speciesMatches } from '../../utils/roomLoaderOfferEngine';
import RoomLoaderHtml from './RoomLoaderHtml';
import './ProductGuideSection.css';

type Props = {
  config: RoomLoaderProductGuideConfig;
  /** Species of the pets on this form, so a cat-only household skips the dog table. */
  speciesOnForm: RoomLoaderSpecies[];
};

export default function ProductGuideSection({ config, speciesOnForm }: Props) {
  if (!config?.enabled) return null;

  const tables = (config.tables ?? [])
    .filter((table) => speciesOnForm.some((species) => speciesMatches(table.species, species)))
    .filter((table) => (table.rows ?? []).length > 0)
    .slice()
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  if (tables.length === 0) return null;

  return (
    <details className="rl-guide">
      <summary className="rl-guide__summary">{config.summaryLabel}</summary>
      <div className="rl-guide__body">
        {tables.map((table) => (
          <section key={table.id} className="rl-guide__table-block">
            {table.heading ? <h4 className="rl-guide__heading">{table.heading}</h4> : null}
            <RoomLoaderHtml html={table.noteHtml} className="rl-guide__note" />
            <div className="rl-guide__scroll">
              <table className="rl-guide__table">
                <thead>
                  <tr>
                    <th scope="col">Approach</th>
                    <th scope="col">Medication</th>
                    <th scope="col">Schedule</th>
                    <th scope="col">Covers</th>
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row) => (
                    <tr key={row.id}>
                      <th scope="row">{row.approach}</th>
                      <td>{row.medication}</td>
                      <td>{row.schedule}</td>
                      <td>
                        <RoomLoaderHtml html={row.coversHtml} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <RoomLoaderHtml html={table.footerHtml} className="rl-guide__footer" />
          </section>
        ))}
      </div>
    </details>
  );
}
