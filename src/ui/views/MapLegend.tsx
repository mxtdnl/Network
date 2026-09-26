import { forwardRef, useId } from 'react';
import { mapCopy } from '../copy/map';
import { legendSections, type LegendSection } from '../map/legend';
import type { MapModel } from '../map/model';
import type { MapTheme } from '../map/theme';

const VAL_CLASS: Record<number, string> = {
  [-3]: 'n3',
  [-2]: 'n2',
  [-1]: 'n1',
  0: '0',
  1: 'p1',
  2: 'p2',
  3: 'p3',
};

function Sample({ section, theme }: { section: LegendSection; theme: MapTheme }) {
  const box = theme.nodeMax * 2 + theme.line * 2;
  // Line samples are one text line tall.
  const lineH = theme.labelSize + theme.labelGap;
  const lineW = box * 1.5;
  switch (section.kind) {
    case 'size':
      return (
        <ul className="legend__samples">
          {section.samples.map((s) => (
            <li key={s.label} className="legend__sample">
              <svg
                className="legend__svg"
                width={s.radius * 2 + theme.line * 2}
                height={box}
                aria-hidden="true"
              >
                <circle
                  className="legend__node"
                  cx={s.radius + theme.line}
                  cy={box / 2}
                  r={s.radius}
                />
              </svg>
              <span className="num">{s.label}</span>
            </li>
          ))}
          {section.notDefined && (
            <li className="legend__sample">
              <svg className="legend__svg" width={box} height={box} aria-hidden="true">
                <circle
                  className="legend__node"
                  cx={box / 2}
                  cy={box / 2}
                  r={section.notDefined.radius}
                />
              </svg>
              <span>{section.notDefined.label}</span>
            </li>
          )}
        </ul>
      );
    case 'fill':
      return (
        <ul className="legend__samples legend__samples--list">
          {section.items.map((item) => (
            <li key={item.label} className="legend__sample">
              <span
                className={`legend__dot ${item.hue >= 0 ? `legend__dot--cat-${String(item.hue + 1)}` : 'legend__dot--other'}`}
                aria-hidden="true"
              />
              <span>{item.label}</span>
            </li>
          ))}
        </ul>
      );
    case 'width':
      return (
        <ul className="legend__samples">
          {section.samples.map((s) => (
            <li key={s.label} className="legend__sample">
              <svg className="legend__svg" width={theme.swatch} height={lineH} aria-hidden="true">
                <line
                  className="legend__edge"
                  x1={0}
                  y1={lineH / 2}
                  x2={theme.swatch}
                  y2={lineH / 2}
                  strokeWidth={s.width}
                />
              </svg>
              <span className="num">{s.label}</span>
            </li>
          ))}
        </ul>
      );
    case 'colour':
      if (section.steps.length === 0) return null;
      return (
        <ul className="legend__samples">
          <li className="legend__sample legend__sample--ramp">
            <span className="legend__ramp" aria-hidden="true">
              {section.steps.map((s) => (
                <span
                  key={s.step}
                  className={`legend__step legend__step--${VAL_CLASS[s.step] ?? '0'}`}
                />
              ))}
            </span>
            <span className="legend__ramp-labels num" aria-hidden="true">
              <span>{section.steps[0]?.label}</span>
              <span>0</span>
              <span>{section.steps[section.steps.length - 1]?.label}</span>
            </span>
          </li>
          {section.notRated && (
            <li className="legend__sample">
              <svg className="legend__svg" width={box} height={lineH} aria-hidden="true">
                <line
                  className="legend__edge legend__edge--not-rated"
                  x1={0}
                  y1={lineH / 2}
                  x2={box}
                  y2={lineH / 2}
                  strokeWidth={theme.edgeMax / 2}
                />
              </svg>
              <span>{section.notRated}</span>
            </li>
          )}
        </ul>
      );
    case 'style':
      return (
        <ul className="legend__samples legend__samples--list">
          {section.items.map((item) => {
            const w = theme.edgeMax / 2;
            const y = lineH / 2;
            const dash =
              item.style === 'informal'
                ? `${String(theme.dash)} ${String(theme.gap)}`
                : item.style === 'neither'
                  ? `${String(theme.dot)} ${String(theme.gap)}`
                  : undefined;
            const o = (w + theme.gap / 2) / 2;
            return (
              <li key={item.style} className="legend__sample">
                <svg
                  className="legend__svg legend__svg--wide"
                  width={lineW}
                  height={lineH}
                  aria-hidden="true"
                >
                  {item.style === 'both' ? (
                    <>
                      <line
                        className="legend__edge"
                        x1={0}
                        y1={y - o}
                        x2={lineW}
                        y2={y - o}
                        strokeWidth={w}
                      />
                      <line
                        className="legend__edge"
                        x1={0}
                        y1={y + o}
                        x2={lineW}
                        y2={y + o}
                        strokeWidth={w}
                        strokeDasharray={`${String(theme.dash)} ${String(theme.gap)}`}
                      />
                    </>
                  ) : (
                    <line
                      className="legend__edge"
                      x1={0}
                      y1={y}
                      x2={lineW}
                      y2={y}
                      strokeWidth={w}
                      strokeDasharray={dash}
                    />
                  )}
                </svg>
                <span>{item.label}</span>
              </li>
            );
          })}
        </ul>
      );
    case 'arrows': {
      const w = lineW;
      const y = lineH / 2;
      const head = theme.arrow + theme.edgeMax / 2;
      return (
        <ul className="legend__samples">
          <li className="legend__sample">
            <svg className="legend__svg" width={w} height={lineH} aria-hidden="true">
              <line
                className="legend__edge"
                x1={0}
                y1={y}
                x2={w - head}
                y2={y}
                strokeWidth={theme.edgeMax / 2}
              />
              <polygon
                className="legend__arrow"
                points={`${String(w)},${String(y)} ${String(w - head)},${String(y - head / 2)} ${String(w - head)},${String(y + head / 2)}`}
              />
            </svg>
          </li>
        </ul>
      );
    }
  }
}

// Persistent legend, overlaid at the lower left of the map (design-system
// §5.1): one entry per encoding in use, rebuilt from the same model as the map.
export const MapLegend = forwardRef<HTMLElement, { model: MapModel; theme: MapTheme }>(
  function MapLegend({ model, theme }, ref) {
    const headingId = useId();
    const sections = legendSections(model, theme);
    return (
      <section ref={ref} className="legend" aria-labelledby={headingId}>
        <h2 id={headingId} className="visually-hidden">
          {mapCopy.legend.heading}
        </h2>
        {sections.map((section) => (
          <div key={section.kind} className="legend__section">
            <p className="legend__heading">
              <span className="legend__title">{section.title}</span>{' '}
              <span className="legend__variable">{section.variable}</span>
            </p>
            <Sample section={section} theme={theme} />
            {section.kind === 'width' &&
              section.notes.map((note) => (
                <p key={note} className="legend__note num">
                  {note}
                </p>
              ))}
          </div>
        ))}
      </section>
    );
  },
);
