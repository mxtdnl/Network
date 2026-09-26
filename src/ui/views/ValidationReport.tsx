import { useId, useState } from 'react';
import type { FileReport } from '../../data/import/validate';
import { Icon } from '../components/Icon';
import { importCopy } from '../copy/import';

// Problems shown before "Show all", so a large file does not produce a huge table.
const INITIAL_ROWS = 50;

// One file's section of the validation report (spec §5): counts, then every
// problem with its row number, then notes on what was read without rejection.
export function FileReportSection({ report }: { report: FileReport }) {
  const headingId = useId();
  const [showAll, setShowAll] = useState(false);
  const errors = report.issues.filter((i) => i.severity === 'error');
  const notes = report.issues.filter((i) => i.severity === 'note');
  const shown = showAll ? errors : errors.slice(0, INITIAL_ROWS);

  return (
    <section className="report__file" aria-labelledby={headingId}>
      <h3 id={headingId} className="report__file-heading">
        {importCopy.file[report.file]}
        <span className="report__file-name">{report.fileName}</span>
      </h3>
      {report.blocked ? (
        <p className="report__line">
          <Icon name="warning" />
          {importCopy.blocked}
        </p>
      ) : (
        <>
          <p className="report__line num">
            {importCopy.fileSummary(report.validRows, report.totalRows)}
          </p>
          <p className="report__line num">
            {report.skippedRows > 0 ? <Icon name="warning" /> : <Icon name="check" />}
            {importCopy.skipped(report.skippedRows)}
          </p>
        </>
      )}

      {errors.length === 0 ? (
        <p className="report__none">{importCopy.noProblems}</p>
      ) : (
        <>
          <h4 className="report__subheading num">{importCopy.problemsHeading(errors.length)}</h4>
          <table className="report__table">
            <thead>
              <tr>
                <th scope="col" className="report__col-row">
                  {importCopy.columns.row}
                </th>
                <th scope="col" className="report__col-column">
                  {importCopy.columns.column}
                </th>
                <th scope="col">{importCopy.columns.problem}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((issue, i) => (
                <tr key={`${String(issue.row)}-${issue.code}-${issue.column ?? ''}-${String(i)}`}>
                  <td className="report__col-row">{issue.row ?? ''}</td>
                  <td className="report__col-column">{issue.column ?? ''}</td>
                  <td>{importCopy.problem(issue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {errors.length > shown.length && (
            <button
              type="button"
              className="button button--text report__more"
              onClick={() => {
                setShowAll(true);
              }}
            >
              {importCopy.showAll(errors.length)}
            </button>
          )}
        </>
      )}

      {notes.length > 0 && (
        <>
          <h4 className="report__subheading">{importCopy.notesHeading}</h4>
          <ul className="report__notes">
            {notes.map((note, i) => (
              <li key={`${note.code}-${String(i)}`} className="report__line">
                <Icon name="info" />
                {importCopy.problem(note)}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
