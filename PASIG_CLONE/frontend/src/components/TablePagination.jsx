const PAGE_SIZES = [10, 20, 50, 100];

function pageItems(page, totalPages) {
  const visible = new Set([1, totalPages, page - 1, page, page + 1]);
  const pages = [...visible].filter(n => n >= 1 && n <= totalPages).sort((a, b) => a - b);
  const items = [];
  pages.forEach((number, index) => {
    if (index > 0 && number - pages[index - 1] > 1) {
      if (number - pages[index - 1] === 2) items.push(pages[index - 1] + 1);
      else items.push(`gap-${number}`);
    }
    items.push(number);
  });
  return items;
}

export default function TablePagination({ page, pageSize, total, itemName, onPageChange, onPageSizeChange }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const start = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, total);
  const buttonClass = 'inline-flex h-8 min-w-8 items-center justify-center rounded border text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" style={{ borderTop: '1px solid #E2E8F0', background: '#ffffff' }}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs font-semibold" style={{ color: '#94A3B8' }}>
        <span>Showing {start}–{end} of {total} {itemName}</span>
        <label className="inline-flex items-center gap-1.5 whitespace-nowrap">
          Per page:
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            aria-label={`${itemName} per page`}
            className="h-7 rounded border bg-white px-2 text-xs font-semibold cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            style={{ borderColor: '#E2E8F0', color: '#0F2D52' }}
          >
            {PAGE_SIZES.map(size => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
      </div>
      <nav className="flex items-center gap-1.5" aria-label={`${itemName} pagination`}>
        <button type="button" className={buttonClass} style={{ borderColor: '#E2E8F0', color: '#0F2D52', background: '#F8FAFC' }} onClick={() => onPageChange(currentPage - 1)} disabled={currentPage === 1} aria-label="Previous page">
          <i className="ri-arrow-left-s-line" aria-hidden="true" />
        </button>
        {pageItems(currentPage, totalPages).map(item => typeof item === 'number' ? (
          <button
            key={item}
            type="button"
            className={buttonClass}
            style={{ borderColor: item === currentPage ? '#0F2D52' : '#CBD5E1', background: item === currentPage ? '#0F2D52' : '#F8FAFC', color: item === currentPage ? '#ffffff' : '#0F2D52' }}
            onClick={() => onPageChange(item)}
            aria-label={`Page ${item}`}
            aria-current={item === currentPage ? 'page' : undefined}
          >
            {item}
          </button>
        ) : <span key={item} className="px-1 text-xs" style={{ color: '#94A3B8' }} aria-hidden="true">...</span>)}
        <button type="button" className={buttonClass} style={{ borderColor: '#CBD5E1', color: '#0F2D52', background: '#F8FAFC' }} onClick={() => onPageChange(currentPage + 1)} disabled={currentPage === totalPages} aria-label="Next page">
          <i className="ri-arrow-right-s-line" aria-hidden="true" />
        </button>
      </nav>
    </div>
  );
}
