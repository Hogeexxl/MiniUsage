export function SessionTableSkeleton() {
  return (
    <>
      {Array.from({ length: 6 }, (_, index) => (
        <tr key={`session-skeleton-${index}`} aria-hidden="true" className="session-skeleton-row">
          {Array.from({ length: 8 }, (_, cell) => (
            <td key={cell}>
              <span className="session-skeleton-cell" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
