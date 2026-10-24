// Requests for files: this SharePoint only (nothing is sent elsewhere); dates from the file's own response

export const OUTSIDE = 'Not opened: the link points outside this SharePoint';

/** @param {string} url relative or absolute @returns {boolean} on this SharePoint */
export const sameOrigin = (url) => new URL(url, location.href).origin === location.origin;

// Dates from file's own response headers
/** @param {Response} response @param {string} cd Content-Disposition @returns {{ modified: string|null, created: string|null }} */
export function responseDates(response, cd) {
  /** @param {string} [v] */
  const iso = (v) => {
    const d = v ? new Date(v.replace(/^"|"$/g, '')) : null;
    // "2026-10-24 08:35:13 UTC" (list dates are local time, so UTC is named)
    return d && !Number.isNaN(d.getTime()) ? `${d.toISOString().slice(0, 19).replace('T', ' ')} UTC` : null;
  };
  return {
    modified: iso(response.headers.get('last-modified') || (cd.match(/modification-date="?([^";]+)/i) || [])[1]),
    created: iso((cd.match(/creation-date="?([^";]+)/i) || [])[1]),
  };
}
