import { Navigate, useLocation } from 'react-router';

/** Old /schedule/catalog/... URLs. */
export function LegacyCatalogRedirect() {
  const { pathname, search, hash } = useLocation();
  const rest = pathname.replace(/^\/schedule\/catalog\/?/, '');
  if (rest.startsWith('inventory')) {
    const after = rest.replace(/^inventory\/?/, '') || 'items';
    return <Navigate to={{ pathname: `/schedule/inventory/${after}`, search, hash }} replace />;
  }
  if (rest.startsWith('procedures')) {
    return (
      <Navigate
        to={{ pathname: '/schedule/inventory/items', search: '?type=procedure', hash }}
        replace
      />
    );
  }
  if (rest.startsWith('labs')) {
    return (
      <Navigate
        to={{ pathname: '/schedule/inventory/items', search: '?type=lab', hash }}
        replace
      />
    );
  }
  return <Navigate to={{ pathname: '/schedule/inventory/items', search, hash }} replace />;
}

export default LegacyCatalogRedirect;
